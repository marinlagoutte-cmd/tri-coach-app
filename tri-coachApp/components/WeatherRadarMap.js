import React, { useEffect, useRef, useState, useCallback } from 'react';
import { parseGPX, sampleRoute } from '../lib/gpx';
import { fetchWindForPoints, classifyWindImpact, nearestHourIndex, speedColor, impactColor, IMPACT_LABEL } from '../lib/windMap';

const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILES_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

// Grille de flèches de vent affichée sur la zone visible de la carte (N x N points).
const WIND_GRID_SIZE = 5;
const MAX_GRID_POINTS = WIND_GRID_SIZE * WIND_GRID_SIZE;

function clampNum(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function hourLabel(iso) {
  return new Date(iso).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

function windArrowDivIcon(L, { angleTowards, color, size = 22, ring = false, rain = false }) {
  // La flèche tourne avec `angleTowards` (direction du vent) : le badge pluie est donc
  // placé dans un conteneur EXTÉRIEUR non tourné, sinon il tournerait avec la flèche et
  // se retrouverait à un endroit différent à chaque point du tracé.
  const dropBadge = rain
    ? `<div style="position:absolute;top:-3px;right:-3px;width:11px;height:11px;border-radius:50%;background:#38BDF8;border:1.5px solid rgba(8,6,20,0.9);display:flex;align-items:center;justify-content:center;font-size:8px;line-height:1;">💧</div>`
    : '';
  const html = `<div style="position:relative;width:${size}px;height:${size}px;">
    <div style="width:${size}px;height:${size}px;transform:rotate(${angleTowards}deg);display:flex;align-items:center;justify-content:center;${
    ring ? 'filter:drop-shadow(0 0 4px rgba(131,88,255,0.9));' : ''
  }">
      <svg width="${size}" height="${size}" viewBox="0 0 24 24">
        <path d="M12 1.5 L19 15 L12 11 L5 15 Z" fill="${color}" stroke="rgba(8,6,20,0.85)" stroke-width="1"/>
      </svg>
    </div>
    ${dropBadge}
  </div>`;
  return L.divIcon({ html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

export default function WeatherRadarMap() {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const LRef = useRef(null);
  const windLayerGroupRef = useRef(null);
  const routeLayerGroupRef = useRef(null);
  const moveDebounceRef = useRef(null);

  const [mapReady, setMapReady] = useState(false);
  const [geoError, setGeoError] = useState('');

  // --- Vent (grille sur la zone visible) ---
  const [showWind, setShowWind] = useState(true);
  const [windHourIndex, setWindHourIndex] = useState(0);
  const [windHourOptions, setWindHourOptions] = useState([]);
  const [windLoading, setWindLoading] = useState(false);
  // Lecture automatique du curseur horaire (façon boucle radar animée) : avance d'une
  // heure à intervalle régulier, revient à 0 en fin de course — même paradigme play/pause
  // que l'ancien radar RainViewer, appliqué ici à la timeline 24h qu'on garde.
  const [hourPlaying, setHourPlaying] = useState(false);
  const hourPlayRef = useRef(null);
  const [windError, setWindError] = useState('');

  // --- Radar pluie (affichage/masquage du calque de tuiles RainViewer, voir plus bas) ---
  const [showRainForecast, setShowRainForecast] = useState(true);

  // --- Parcours GPX ---
  const [route, setRoute] = useState(null); // { name, points, totalDistanceKm, elevationGain }
  const [routeWind, setRouteWind] = useState(null); // samples enrichis avec impact vent
  const [avgSpeed, setAvgSpeed] = useState(28);
  const [departure, setDeparture] = useState(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [gpxError, setGpxError] = useState('');
  const [gpxLoading, setGpxLoading] = useState(false);
  const [routeSummary, setRouteSummary] = useState(null);

  // ---------------------------------------------------------------------
  // Initialisation carte (une seule fois, côté client)
  // ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapElRef.current || mapRef.current) return;
      LRef.current = L;

      const map = L.map(mapElRef.current, {
        center: [46.6, 2.3],
        zoom: 6,
        zoomControl: true,
        attributionControl: true,
      });
      L.tileLayer(DARK_TILES, { attribution: TILES_ATTRIBUTION, maxZoom: 19, subdomains: 'abcd' }).addTo(map);

      windLayerGroupRef.current = L.layerGroup().addTo(map);
      routeLayerGroupRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady(true);

      // Géolocalisation : centre la carte sur l'athlète s'il autorise, sinon on
      // reste sur la vue France par défaut (pas bloquant).
      if (navigator?.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            map.setView([pos.coords.latitude, pos.coords.longitude], 10);
          },
          () => setGeoError("Position non partagée — carte centrée par défaut."),
          { timeout: 8000 }
        );
      }

      map.on('moveend', () => {
        clearTimeout(moveDebounceRef.current);
        moveDebounceRef.current = setTimeout(() => {
          refreshWindGridRef.current?.();
        }, 500);
      });
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------
  // Vent — grille de flèches sur la zone visible de la carte
  // ---------------------------------------------------------------------
  const [gridWindData, setGridWindData] = useState([]); // [{lat, lon, hourly}]

  const refreshWindGrid = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !showWind) return;
    const bounds = map.getBounds();
    const latStep = (bounds.getNorth() - bounds.getSouth()) / (WIND_GRID_SIZE - 1);
    const lonStep = (bounds.getEast() - bounds.getWest()) / (WIND_GRID_SIZE - 1);
    const gridPoints = [];
    for (let i = 0; i < WIND_GRID_SIZE; i++) {
      for (let j = 0; j < WIND_GRID_SIZE; j++) {
        gridPoints.push({
          lat: bounds.getSouth() + latStep * i,
          lon: bounds.getWest() + lonStep * j,
        });
      }
    }
    setWindLoading(true);
    setWindError('');
    try {
      const results = await fetchWindForPoints(gridPoints.slice(0, MAX_GRID_POINTS));
      const merged = results.map((r, idx) => ({ lat: gridPoints[idx].lat, lon: gridPoints[idx].lon, hourly: r.hourly }));
      setGridWindData(merged);
      if (merged[0]?.hourly?.time?.length) {
        setWindHourOptions(merged[0].hourly.time);
      }
    } catch (e) {
      setWindError("Impossible de récupérer le vent pour cette zone.");
    } finally {
      setWindLoading(false);
    }
  }, [showWind]);

  // Légende pluie affichée à côté du radar (échelle standard d'intensité, cohérente avec
  // la palette du calque radar réel ci-dessous).
  const RAIN_LEGEND = [
    { label: 'Légère', range: '< 1mm/h', color: '#34D399' },
    { label: 'Faible/mod.', range: '1-2.5mm/h', color: '#A3E635' },
    { label: 'Modérée', range: '2.5-5mm/h', color: '#FACC15' },
    { label: 'Forte', range: '5-10mm/h', color: '#FB923C' },
    { label: 'Très forte', range: '> 10mm/h', color: '#E11D48' },
  ];

  // Légende vent affichée à côté de la carte particules — mêmes paliers et mêmes couleurs
  // que speedColor() dans lib/windMap.js (celle qui colore réellement les particules/le
  // trajet), pour rester cohérente avec ce qui est dessiné sur la carte.
  const WIND_LEGEND = [
    { label: 'Légère', range: '< 10km/h', color: '#67E8F9' },
    { label: 'Modéré', range: '10-20km/h', color: '#9A78FF' },
    { label: 'Soutenu', range: '20-35km/h', color: '#FBBF24' },
    { label: 'Fort', range: '> 35km/h', color: '#FF4D80' },
  ];

  // ---------------------------------------------------------------------
  // Pluie — VRAI RADAR MÉTÉO ANIMÉ (RainViewer), plus une nappe recalculée à la main.
  // Demande explicite : copier l'animation d'un vrai site radar (RainViewer). On charge
  // donc directement les tuiles radar publiques de RainViewer (mêmes images que sur
  // rainviewer.com : observations passées ~1h par pas de 10 min + quelques minutes de
  // "nowcast"/prévision immédiate) et on les pose comme calque de tuiles Leaflet, aligné
  // pixel pour pixel sur le fond de carte — ça règle en même temps :
  //  - le "ça ne bouge pas" (vraie boucle d'images, lecture auto par défaut),
  //  - le "mal positionné" (tuiles géoréférencées comme le fond de carte, donc jamais
  //    décalées quand on déplace/zoome la carte, contrairement à l'ancienne nappe canvas
  //    qui restait figée en pixels écran pendant un pan),
  //  - le "ne représente pas où il pleut vraiment" (ce sont les vraies données radar
  //    RainViewer, plus une interpolation grossière sur 25 points),
  //  - le style visuel (couleurs et rendu du radar RainViewer lui-même).
  // ---------------------------------------------------------------------
  const RAINVIEWER_HOST_FALLBACK = 'https://tilecache.rainviewer.com';
  const RADAR_COLOR_SCHEME = 2; // palette "TITAN" de RainViewer — rendu vert→jaune→rouge classique façon radar météo
  const RADAR_TILE_SIZE = 256;
  const RADAR_TILE_OPTIONS = '1_1'; // lissage activé, neige distinguée de la pluie

  const radarLayerARef = useRef(null);
  const radarLayerBRef = useRef(null);
  const radarActiveRef = useRef('A');
  const radarPlayRef = useRef(null);
  const [radarFrames, setRadarFrames] = useState([]); // [{time, path, host, isNowcast}]
  const [radarFrameIndex, setRadarFrameIndex] = useState(0);
  const [radarPlaying, setRadarPlaying] = useState(true); // lecture auto par défaut, comme un vrai radar
  const [radarLoading, setRadarLoading] = useState(true);
  const [radarError, setRadarError] = useState('');

  function radarTileUrl(host, frame) {
    return `${host}${frame.path}/${RADAR_TILE_SIZE}/{z}/{x}/{y}/${RADAR_COLOR_SCHEME}/${RADAR_TILE_OPTIONS}.png`;
  }

  function radarFrameLabel(frame) {
    if (!frame) return '';
    const d = new Date(frame.time * 1000);
    const diffMin = Math.round((frame.time * 1000 - Date.now()) / 60000);
    const clock = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (frame.isNowcast) return `${clock} · prévision +${diffMin}min`;
    if (diffMin >= -4) return `${clock} · maintenant`;
    return `${clock} · il y a ${Math.abs(diffMin)}min`;
  }

  // Récupère la liste des frames radar réelles (mêmes données que rainviewer.com).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        if (!res.ok) throw new Error('bad status');
        const data = await res.json();
        if (cancelled) return;
        const host = data.host || RAINVIEWER_HOST_FALLBACK;
        const past = (data.radar?.past || []).map((f) => ({ ...f, host, isNowcast: false }));
        const nowcast = (data.radar?.nowcast || []).map((f) => ({ ...f, host, isNowcast: true }));
        const frames = [...past, ...nowcast];
        setRadarFrames(frames);
        // Démarre sur la dernière image PASSÉE (= "maintenant"), pas sur la plus ancienne.
        setRadarFrameIndex(Math.max(0, past.length - 1));
        setRadarError('');
      } catch (e) {
        setRadarError('Radar pluie indisponible pour le moment (réseau ou API RainViewer).');
      } finally {
        if (!cancelled) setRadarLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Crée les deux calques de tuiles radar (double-buffer, pour un fondu enchaîné entre
  // deux images, comme un vrai lecteur de boucle radar) une fois la carte prête.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map || !mapReady || radarLayerARef.current) return;
    radarLayerARef.current = L.tileLayer('', { opacity: 0, zIndex: 5 }).addTo(map);
    radarLayerBRef.current = L.tileLayer('', { opacity: 0, zIndex: 5 }).addTo(map);
    [radarLayerARef.current, radarLayerBRef.current].forEach((layer) => {
      const el = layer.getContainer?.();
      if (el) el.style.transition = 'opacity 500ms linear';
    });
  }, [mapReady]);

  // Charge la frame courante dans le calque INACTIF puis bascule l'opacité (fondu enchaîné).
  // Les tuiles sont géoréférencées comme le fond de carte : aucune dérive possible pendant
  // un pan/zoom, contrairement à l'ancienne nappe peinte en coordonnées écran.
  useEffect(() => {
    const layerA = radarLayerARef.current;
    const layerB = radarLayerBRef.current;
    const frame = radarFrames[radarFrameIndex];
    if (!layerA || !layerB || !frame) return;

    const activeIsA = radarActiveRef.current === 'A';
    const showLayer = activeIsA ? layerB : layerA;
    const hideLayer = activeIsA ? layerA : layerB;

    showLayer.setUrl(radarTileUrl(frame.host, frame));
    const t = setTimeout(() => {
      if (!showRainForecast) return;
      showLayer.setOpacity(0.75);
      hideLayer.setOpacity(0);
    }, 60);
    radarActiveRef.current = activeIsA ? 'B' : 'A';
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radarFrameIndex, radarFrames]);

  // Affiche/masque le radar (juste l'opacité, sans recharger les tuiles).
  useEffect(() => {
    const layerA = radarLayerARef.current;
    const layerB = radarLayerBRef.current;
    if (!layerA || !layerB) return;
    if (!showRainForecast) {
      layerA.setOpacity(0);
      layerB.setOpacity(0);
    } else {
      const visible = radarActiveRef.current === 'A' ? layerB : layerA;
      visible.setOpacity(0.75);
    }
  }, [showRainForecast]);

  // Lecture automatique de la boucle radar (comme sur un vrai site radar) : avance d'une
  // frame toutes les ~700ms, boucle en continu sur passé + nowcast.
  useEffect(() => {
    clearInterval(radarPlayRef.current);
    if (radarPlaying && radarFrames.length > 1) {
      radarPlayRef.current = setInterval(() => {
        setRadarFrameIndex((i) => (i + 1) % radarFrames.length);
      }, 700);
    }
    return () => clearInterval(radarPlayRef.current);
  }, [radarPlaying, radarFrames.length]);

  const refreshWindGridRef = useRef(refreshWindGrid);
  useEffect(() => {
    refreshWindGridRef.current = refreshWindGrid;
  }, [refreshWindGrid]);

  // Premier chargement de la grille dès que la carte est prête
  useEffect(() => {
    if (mapReady) refreshWindGrid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, showWind]);

  // ---------------------------------------------------------------------
  // Vent (zone générale) — PARTICULES ANIMÉES au lieu de flèches statiques.
  // On garde des flèches uniquement pour le tracé GPX (glued au parcours,
  // c'est l'info exploitable pour la course) ; sur la carte générale, un champ
  // de petites particules mobiles suivant le vecteur vent local donne un rendu
  // beaucoup plus lisible du "comportement réel" du vent (façon carte météo pro).
  // ---------------------------------------------------------------------
  const windCanvasRef = useRef(null);
  const particlesRef = useRef([]);
  const animRef = useRef(null);
  const lastFrameRef = useRef(0);
  // Refs "miroir" des états utilisés dans la boucle d'animation : la boucle rAF est
  // démarrée une seule fois (perf), donc elle doit lire l'état le plus récent via ref
  // plutôt que via une closure figée au moment du premier rendu.
  const gridWindDataRef = useRef([]);
  const windHourIndexRef = useRef(0);
  const showWindRef = useRef(true);
  useEffect(() => { gridWindDataRef.current = gridWindData; }, [gridWindData]);
  useEffect(() => { windHourIndexRef.current = windHourIndex; }, [windHourIndex]);

  // Avance automatique de la timeline (voir hourPlaying ci-dessus) : boucle sur les
  // heures disponibles, 900ms/heure — assez lent pour suivre le fondu enchaîné de la
  // nappe pluie (550ms), assez rapide pour que ça se sente comme une vraie boucle radar.
  useEffect(() => {
    clearInterval(hourPlayRef.current);
    if (hourPlaying && windHourOptions.length > 1) {
      hourPlayRef.current = setInterval(() => {
        setWindHourIndex((i) => (i + 1) % windHourOptions.length);
      }, 900);
    }
    return () => clearInterval(hourPlayRef.current);
  }, [hourPlaying, windHourOptions.length]);
  useEffect(() => { showWindRef.current = showWind; }, [showWind]);

  const PARTICLE_COUNT = 260;

  // Interpolation (pondérée par l'inverse de la distance²) de vitesse/direction du
  // vent à un point lat/lon quelconque, à partir des points de la grille chargée.
  const sampleWindAt = useCallback((lat, lon) => {
    const grid = gridWindDataRef.current;
    const hIdx = windHourIndexRef.current;
    if (!grid.length) return null;
    let wSum = 0;
    let sxSum = 0;
    let sySum = 0;
    for (const pt of grid) {
      const speed = pt.hourly?.wind_speed_10m?.[hIdx];
      const dir = pt.hourly?.wind_direction_10m?.[hIdx];
      if (!Number.isFinite(speed) || !Number.isFinite(dir)) continue;
      const dLat = pt.lat - lat;
      const dLon = pt.lon - lon;
      const distSq = Math.max(1e-6, dLat * dLat + dLon * dLon);
      const w = 1 / distSq;
      const towardsRad = ((dir + 180) % 360) * (Math.PI / 180);
      wSum += w;
      sxSum += w * speed * Math.sin(towardsRad);
      sySum += w * speed * Math.cos(towardsRad);
    }
    if (wSum === 0) return null;
    const vx = sxSum / wSum; // composante Est (km/h)
    const vy = sySum / wSum; // composante Nord (km/h)
    return { speed: Math.hypot(vx, vy), vx, vy };
  }, []);

  const spawnParticle = useCallback((w, h, p) => {
    const particle = p || {};
    particle.x = Math.random() * w;
    particle.y = Math.random() * h;
    particle.age = 0;
    particle.life = 60 + Math.random() * 80;
    particle.trail = [];
    return particle;
  }, []);

  // Initialise le champ de particules à la taille courante du canvas.
  useEffect(() => {
    const canvas = windCanvasRef.current;
    if (!canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return;
    particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => spawnParticle(w, h));
  }, [mapReady, spawnParticle]);

  // Redimensionne le canvas (vent) pour qu'il colle exactement au conteneur de la carte
  // (y compris en tenant compte du devicePixelRatio, sinon le rendu est flou). Le radar
  // pluie n'a plus de canvas à redimensionner : ce sont de vraies tuiles Leaflet, gérées
  // nativement par la carte.
  useEffect(() => {
    const container = mapElRef.current;
    const canvas = windCanvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => spawnParticle(rect.width, rect.height));
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [spawnParticle]);

  // Boucle d'animation — démarrée une seule fois, tourne tant que le composant est monté.
  useEffect(() => {
    const canvas = windCanvasRef.current;
    const map = mapRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const TRAIL_LEN = 6;
    const FRAME_INTERVAL = 1000 / 30; // ~30fps, largement suffisant pour ce rendu

    const tick = (ts) => {
      animRef.current = requestAnimationFrame(tick);
      if (ts - lastFrameRef.current < FRAME_INTERVAL) return;
      lastFrameRef.current = ts;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);
      if (!showWindRef.current || !mapRef.current || !gridWindDataRef.current.length) return;

      const m = mapRef.current;
      const particles = particlesRef.current;

      for (const p of particles) {
        const latlng = m.containerPointToLatLng([p.x, p.y]);
        const wind = sampleWindAt(latlng.lat, latlng.lng);
        if (!wind || wind.speed < 0.5) {
          p.age += 1;
        } else {
          // Échelle purement visuelle (pas une conversion physique exacte) : vitesse
          // du vent -> déplacement en pixels/frame, calée pour rester lisible à tous
          // les niveaux de zoom raisonnables (France entière -> zoom ville).
          const zoom = m.getZoom();
          const px = clampNum(0.35 + wind.speed / 22, 0.35, 3.2) * clampNum(zoom / 7, 0.6, 2.2);
          const norm = Math.max(0.001, Math.hypot(wind.vx, wind.vy));
          const dx = (wind.vx / norm) * px;
          const dy = -(wind.vy / norm) * px; // écran : Nord = y qui diminue

          p.trail.push({ x: p.x, y: p.y, speed: wind.speed });
          if (p.trail.length > TRAIL_LEN) p.trail.shift();
          p.x += dx;
          p.y += dy;
          p.age += 1;
        }

        const offscreen = p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20;
        if (p.age > p.life || offscreen) {
          spawnParticle(w, h, p);
          continue;
        }

        // Traînée courte façon "comète" : segments successifs, alpha décroissant vers la queue.
        if (p.trail.length > 1) {
          for (let i = 1; i < p.trail.length; i++) {
            const a = p.trail[i - 1];
            const b = p.trail[i];
            const alpha = (i / p.trail.length) * 0.85;
            ctx.strokeStyle = speedColor(b.speed);
            ctx.globalAlpha = alpha;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
          const last = p.trail[p.trail.length - 1];
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = speedColor(last.speed);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [sampleWindAt, spawnParticle]);

  // ---------------------------------------------------------------------
  // GPX — import, tracé, et vecteurs de vent le long du parcours
  // ---------------------------------------------------------------------
  // Calcule les échantillons du tracé + le vent/l'impact à chaque point, pour la
  // vitesse et l'heure de départ actuellement réglées. Réutilisé à l'import initial
  // et à chaque recalcul manuel (bouton "Recalculer le vent").
  const computeRouteWind = useCallback(async (parsed) => {
    // Échantillonnage plus dense (viser ~35 flèches sur tout le tracé, jamais moins de
    // une tous les 300m) pour que les flèches de vent restent "collées" au tracé au lieu
    // de sauter de gros segments sans info entre deux points.
    const stepKm = Math.max(0.3, parsed.totalDistanceKm / 35);
    const samples = sampleRoute(parsed.points, stepKm);
    const windResults = await fetchWindForPoints(samples.map((s) => ({ lat: s.lat, lon: s.lon })));
    const depDate = new Date(departure);

    let distTail = 0;
    let distHead = 0;
    let distCross = 0;
    // BUG CORRIGÉ : `precip` était déjà récupéré par point (Open-Meteo) mais jamais
    // exploité — le vent "évoluait" visuellement le long du tracé (flèches colorées)
    // alors que la pluie restait invisible. On calcule maintenant, comme pour le vent,
    // un cumul exploitable (distance sous la pluie + cumul mm) et on l'affiche au
    // survol de chaque flèche.
    let distRain = 0;
    let maxPrecip = 0;
    const RAIN_THRESHOLD_MM = 0.1;
    const enriched = samples.map((s, i) => {
      const hourly = windResults[i]?.hourly;
      const etaHours = s.distKm / Math.max(5, avgSpeed);
      const etaDate = new Date(depDate.getTime() + etaHours * 3600 * 1000);
      const hIdx = hourly?.time ? nearestHourIndex(hourly.time, etaDate) : 0;
      const windSpeed = hourly?.wind_speed_10m?.[hIdx];
      const windDir = hourly?.wind_direction_10m?.[hIdx];
      const precip = hourly?.precipitation?.[hIdx];
      const precipProbability = hourly?.precipitation_probability?.[hIdx];
      const impact = Number.isFinite(windSpeed) && Number.isFinite(windDir)
        ? classifyWindImpact(windDir, windSpeed, s.heading)
        : null;

      // Distance représentée par ce segment (jusqu'au point suivant), pour le récap.
      const next = samples[i + 1];
      const segKm = next ? next.distKm - s.distKm : 0;
      if (impact) {
        if (impact.type === 'tail') distTail += segKm;
        else if (impact.type === 'head') distHead += segKm;
        else distCross += segKm;
      }
      if (Number.isFinite(precip) && precip >= RAIN_THRESHOLD_MM) {
        distRain += segKm;
        maxPrecip = Math.max(maxPrecip, precip);
      }

      return { ...s, eta: etaDate, windSpeed, windDir, precip, precipProbability, impact };
    });

    setRouteWind(enriched);
    setRouteSummary({ distTail, distHead, distCross, distRain, maxPrecip, totalKm: parsed.totalDistanceKm });
  }, [avgSpeed, departure]);

  const handleGpxFile = useCallback(async (file) => {
    if (!file) return;
    setGpxError('');
    setGpxLoading(true);
    try {
      const text = await file.text();
      const parsed = parseGPX(text);
      setRoute(parsed);
      await computeRouteWind(parsed);

      // Centre la carte sur le tracé
      const L = LRef.current;
      const map = mapRef.current;
      if (L && map) {
        const bounds = L.latLngBounds(parsed.points.map((p) => [p.lat, p.lon]));
        map.fitBounds(bounds, { padding: [24, 24] });
      }
    } catch (e) {
      setGpxError(e.message || 'Erreur lors de la lecture du fichier GPX.');
      setRoute(null);
      setRouteWind(null);
      setRouteSummary(null);
    } finally {
      setGpxLoading(false);
    }
  }, [computeRouteWind]);

  // Redessine le tracé + les flèches de vent du parcours
  useEffect(() => {
    const L = LRef.current;
    const group = routeLayerGroupRef.current;
    if (!L || !group) return;
    group.clearLayers();
    if (!route) return;

    const latlngs = route.points.map((p) => [p.lat, p.lon]);
    L.polyline(latlngs, { color: '#FC4C02', weight: 4, opacity: 0.85 }).addTo(group);

    if (routeWind?.length) {
      const start = routeWind[0];
      const end = routeWind[routeWind.length - 1];
      L.circleMarker([start.lat, start.lon], { radius: 6, color: '#34D399', fillColor: '#34D399', fillOpacity: 1 })
        .bindTooltip('Départ', { permanent: false })
        .addTo(group);
      L.circleMarker([end.lat, end.lon], { radius: 6, color: '#FF4D80', fillColor: '#FF4D80', fillOpacity: 1 })
        .bindTooltip('Arrivée', { permanent: false })
        .addTo(group);

      routeWind.forEach((s) => {
        if (!s.impact) return;
        const towards = (s.windDir + 180) % 360;
        const hasRain = Number.isFinite(s.precip) && s.precip >= 0.1;
        const icon = windArrowDivIcon(L, { angleTowards: towards, color: impactColor(s.impact.type), size: 24, ring: true, rain: hasRain });
        const marker = L.marker([s.lat, s.lon], { icon });
        const rainLine = Number.isFinite(s.precip) && s.precip >= 0.1
          ? `<br/>🌧️ ${s.precip.toFixed(1)}mm/h${Number.isFinite(s.precipProbability) ? ` (${s.precipProbability}%)` : ''}`
          : '';
        marker.bindTooltip(
          `${IMPACT_LABEL[s.impact.type]} · ${Math.round(s.windSpeed)} km/h · km ${s.distKm.toFixed(1)}<br/>ETA ${s.eta.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}${rainLine}`,
          { direction: 'top' }
        );
        marker.addTo(group);
      });
    }
  }, [route, routeWind]);

  // ---------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------
  const currentWindHourLabel = windHourOptions[windHourIndex] ? hourLabel(windHourOptions[windHourIndex]) : '';

  return (
    <div className="space-y-3">
      {geoError && <p className="text-[10px] text-ink-500">{geoError}</p>}

      {/* Carte */}
      <div className="relative rounded-2xl overflow-hidden border border-ink-800" style={{ height: '380px' }}>
        <div ref={mapElRef} className="absolute inset-0 z-0" />
        <canvas ref={windCanvasRef} className="absolute inset-0 z-[10] pointer-events-none" />
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-950 text-xs text-ink-500 animate-pulse">
            Chargement de la carte…
          </div>
        )}
      </div>

      {/* Contrôles vent (prévision Open-Meteo, 24h à venir) */}
      <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-black uppercase text-ink-50">💨 Vent (prévision 24h)</span>
          <button
            onClick={() => setShowWind((v) => !v)}
            className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border ${
              showWind ? 'text-volt-400 border-volt-500/30 bg-volt-500/10' : 'text-ink-500 border-ink-700 bg-ink-950'
            }`}
          >
            {showWind ? 'affiché' : 'masqué'}
          </button>
        </div>
        {windError && <p className="text-[10px] text-rose-400">{windError}</p>}
        {showWind && (
          <>
            <div className="flex items-center justify-center gap-3 py-1 flex-wrap">
              {WIND_LEGEND.map((item) => (
                <div key={item.label} className="flex items-center gap-1">
                  <span className="w-4 h-0.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="text-[8px] font-bold text-ink-400">{item.label} ({item.range})</span>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setHourPlaying((v) => !v)}
                  disabled={!windHourOptions.length}
                  className="w-7 h-7 shrink-0 rounded-lg bg-ink-800 text-ink-50 text-xs flex items-center justify-center disabled:opacity-40"
                >
                  {hourPlaying ? '⏸' : '▶'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, windHourOptions.length - 1)}
                  value={windHourIndex}
                  onChange={(e) => {
                    setHourPlaying(false);
                    setWindHourIndex(Number(e.target.value));
                  }}
                  className="flex-1 accent-volt-500"
                  disabled={!windHourOptions.length}
                />
              </div>
              <p className="text-[9px] font-mono text-ink-500 text-center">
                {windLoading ? 'Chargement du vent…' : currentWindHourLabel || 'Déplace la carte pour charger le vent de la zone'}
              </p>
              <p className="text-[9px] text-ink-600 text-center">▶ pour lancer la boucle, ou déplace le curseur : prévision heure par heure sur les 24 prochaines heures.</p>
            </div>
          </>
        )}
      </div>

      {/* Radar pluie temps réel (RainViewer) — vraies tuiles radar, animées, alignées sur la carte */}
      <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-black uppercase text-ink-50">🌧️ Radar pluie (temps réel)</span>
          <button
            onClick={() => setShowRainForecast((v) => !v)}
            className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border ${
              showRainForecast ? 'text-sky-400 border-sky-500/30 bg-sky-500/10' : 'text-ink-500 border-ink-700 bg-ink-950'
            }`}
          >
            {showRainForecast ? 'affiché' : 'masqué'}
          </button>
        </div>
        {radarError && <p className="text-[10px] text-rose-400">{radarError}</p>}
        {showRainForecast && (
          <>
            <div className="flex items-center justify-center gap-3 py-1 flex-wrap">
              {RAIN_LEGEND.map((item) => (
                <div key={item.label} className="flex items-center gap-1">
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-ink-950/60 shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-[8px] font-bold text-ink-400">{item.label} ({item.range})</span>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRadarPlaying((v) => !v)}
                  disabled={!radarFrames.length}
                  className="w-7 h-7 shrink-0 rounded-lg bg-ink-800 text-ink-50 text-xs flex items-center justify-center disabled:opacity-40"
                >
                  {radarPlaying ? '⏸' : '▶'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, radarFrames.length - 1)}
                  value={radarFrameIndex}
                  onChange={(e) => {
                    setRadarPlaying(false);
                    setRadarFrameIndex(Number(e.target.value));
                  }}
                  className="flex-1 accent-sky-500"
                  disabled={!radarFrames.length}
                />
              </div>
              <p className="text-[9px] font-mono text-ink-500 text-center">
                {radarLoading ? 'Chargement du radar…' : radarFrameLabel(radarFrames[radarFrameIndex]) || 'Radar indisponible'}
              </p>
              <p className="text-[9px] text-ink-600 text-center">▶ pour lancer la boucle radar (comme sur un site radar météo) : dernière heure observée + prévision immédiate.</p>
            </div>
          </>
        )}
      </div>

      {/* Import GPX */}
      <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3 space-y-3">
        <span className="text-[11px] font-black uppercase text-ink-50 block">🚴 Sortie vélo — impact du vent sur ton parcours</span>

        <div className="flex flex-wrap gap-2 items-end">
          <label className="flex-1 min-w-[140px]">
            <span className="text-[9px] font-mono text-ink-500 uppercase block mb-1">Fichier GPX</span>
            <input
              type="file"
              accept=".gpx"
              onChange={(e) => handleGpxFile(e.target.files?.[0])}
              className="text-[10px] text-ink-300 file:mr-2 file:py-1.5 file:px-2.5 file:rounded-lg file:border-0 file:bg-volt-500/20 file:text-volt-400 file:text-[10px] file:font-bold w-full"
            />
          </label>
          <label className="w-24">
            <span className="text-[9px] font-mono text-ink-500 uppercase block mb-1">Vitesse km/h</span>
            <input
              type="number"
              min={5}
              max={60}
              value={avgSpeed}
              onChange={(e) => setAvgSpeed(Number(e.target.value) || 28)}
              className="w-full bg-ink-950 border border-ink-800 rounded-lg px-2 py-1.5 text-xs text-ink-50 font-mono"
            />
          </label>
          <label className="w-36">
            <span className="text-[9px] font-mono text-ink-500 uppercase block mb-1">Départ</span>
            <input
              type="datetime-local"
              value={departure}
              onChange={(e) => setDeparture(e.target.value)}
              className="w-full bg-ink-950 border border-ink-800 rounded-lg px-2 py-1.5 text-[10px] text-ink-50 font-mono"
            />
          </label>
        </div>
        {route && (
          <button
            onClick={async () => {
              setGpxLoading(true);
              try {
                await computeRouteWind(route);
              } finally {
                setGpxLoading(false);
              }
            }}
            className="text-[10px] font-bold text-volt-400 border border-volt-500/30 bg-volt-500/10 px-2.5 py-1.5 rounded-lg"
          >
            ↻ Recalculer le vent (vitesse/heure)
          </button>
        )}

        {gpxLoading && <p className="text-[10px] text-ink-500 animate-pulse">Analyse du parcours et du vent…</p>}
        {gpxError && <p className="text-[10px] text-rose-400 bg-rose-500/10 border border-rose-500/30 p-2 rounded-lg">{gpxError}</p>}

        {route && routeSummary && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] font-mono text-ink-400">
              <span className="text-ink-50 font-bold truncate max-w-[55%]">{route.name}</span>
              <span>{route.totalDistanceKm.toFixed(1)} km · D+ {route.elevationGain}m</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg py-1.5">
                <div className="text-[9px] text-emerald-400 font-bold">Vent de dos</div>
                <div className="text-xs font-mono text-ink-50">{routeSummary.distTail.toFixed(1)} km</div>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg py-1.5">
                <div className="text-[9px] text-amber-400 font-bold">Travers</div>
                <div className="text-xs font-mono text-ink-50">{routeSummary.distCross.toFixed(1)} km</div>
              </div>
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg py-1.5">
                <div className="text-[9px] text-rose-400 font-bold">Vent de face</div>
                <div className="text-xs font-mono text-ink-50">{routeSummary.distHead.toFixed(1)} km</div>
              </div>
            </div>
            {routeSummary.distRain > 0 ? (
              <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg py-1.5 text-center">
                <div className="text-[9px] text-sky-400 font-bold">🌧️ Sous la pluie (&gt;0.1mm/h prévu)</div>
                <div className="text-xs font-mono text-ink-50">
                  {routeSummary.distRain.toFixed(1)} km · jusqu'à {routeSummary.maxPrecip.toFixed(1)}mm/h
                </div>
              </div>
            ) : (
              <div className="bg-ink-950 border border-ink-800 rounded-lg py-1.5 text-center">
                <div className="text-[9px] text-ink-500">☀️ Aucune pluie prévue sur ce créneau de départ</div>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-[9px] text-ink-600 text-center">
        Prévision pluie &amp; vent heure par heure : Open-Meteo (24h à venir).
      </p>
    </div>
  );
}
