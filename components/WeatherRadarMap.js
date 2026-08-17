import React, { useEffect, useRef, useState, useCallback } from 'react';
import { parseGPX, sampleRoute } from '../lib/gpx';
import { fetchWindForPoints, classifyWindImpact, nearestHourIndex, speedColor, impactColor, IMPACT_LABEL } from '../lib/windMap';

const RAINVIEWER_META = 'https://api.rainviewer.com/public/weather-maps.json';
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
  const radarLayerRef = useRef(null);
  const windLayerGroupRef = useRef(null);
  const rainForecastLayerGroupRef = useRef(null);
  const routeLayerGroupRef = useRef(null);
  const moveDebounceRef = useRef(null);
  const radarPlayRef = useRef(null);

  const [mapReady, setMapReady] = useState(false);
  const [geoError, setGeoError] = useState('');

  // --- Radar pluie (RainViewer) ---
  const [radarFrames, setRadarFrames] = useState([]);
  const [radarHost, setRadarHost] = useState('');
  const [radarIndex, setRadarIndex] = useState(0);
  const [radarPlaying, setRadarPlaying] = useState(false);
  const [showRadar, setShowRadar] = useState(true);
  const [radarError, setRadarError] = useState('');

  // --- Vent (grille sur la zone visible) ---
  const [showWind, setShowWind] = useState(true);
  const [windHourIndex, setWindHourIndex] = useState(0);
  const [windHourOptions, setWindHourOptions] = useState([]);
  const [windLoading, setWindLoading] = useState(false);
  const [windError, setWindError] = useState('');

  // --- Prévision pluie (48h, même grille/horaire que le vent) ---
  // BUG CORRIGÉ : le radar RainViewer ci-dessus n'affiche QUE le passé récent (~2h) +
  // un nowcast très court (~30min), par nature (ce n'est pas un modèle de prévision).
  // On ajoute donc ici une vraie prévision horaire de précipitations sur 48h (Open-Meteo,
  // déjà récupérée par point dans `gridWindData` en même temps que le vent), pilotée par
  // le MÊME slider horaire que le vent pour rester cohérent entre les deux couches.
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
      rainForecastLayerGroupRef.current = L.layerGroup().addTo(map);
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
      clearInterval(radarPlayRef.current);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------
  // Radar pluie — métadonnées RainViewer (frames passées + nowcast)
  // ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(RAINVIEWER_META);
        if (!res.ok) throw new Error('bad');
        const data = await res.json();
        if (cancelled) return;
        const past = data.radar?.past || [];
        const nowcast = data.radar?.nowcast || [];
        const frames = [...past, ...nowcast];
        setRadarHost(data.host);
        setRadarFrames(frames);
        setRadarIndex(Math.max(0, past.length - 1)); // frame "maintenant"
      } catch {
        if (!cancelled) setRadarError("Radar pluie temporairement indisponible.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Applique / met à jour la tuile radar affichée quand l'index ou le toggle change
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map || !radarFrames.length) return;

    if (radarLayerRef.current) {
      map.removeLayer(radarLayerRef.current);
      radarLayerRef.current = null;
    }
    if (!showRadar) return;

    const frame = radarFrames[radarIndex];
    if (!frame) return;
    const url = `${radarHost}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
    const layer = L.tileLayer(url, { opacity: 0.55, zIndex: 5 });
    layer.addTo(map);
    radarLayerRef.current = layer;
  }, [radarIndex, radarFrames, radarHost, showRadar, mapReady]);

  // Lecture automatique de l'animation radar (défilement des frames)
  useEffect(() => {
    clearInterval(radarPlayRef.current);
    if (radarPlaying && radarFrames.length) {
      radarPlayRef.current = setInterval(() => {
        setRadarIndex((i) => (i + 1) % radarFrames.length);
      }, 700);
    }
    return () => clearInterval(radarPlayRef.current);
  }, [radarPlaying, radarFrames.length]);

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

  // Couleur/rayon de la prévision pluie selon l'intensité horaire (mm/h) — échelle
  // volontairement différente de `speedColor` (vent) pour rester lisible superposée.
  function rainColor(mm) {
    if (mm < 0.2) return null; // pas de cercle affiché : temps sec à cette heure/ce point
    if (mm < 1) return 'rgba(56,189,248,0.35)'; // sky-400 — bruine
    if (mm < 4) return 'rgba(56,189,248,0.55)';
    return 'rgba(56,189,248,0.8)'; // pluie soutenue
  }

  // Redessine les cercles de prévision pluie à chaque changement de grille/heure/toggle.
  useEffect(() => {
    const L = LRef.current;
    const group = rainForecastLayerGroupRef.current;
    if (!L || !group) return;
    group.clearLayers();
    if (!showRainForecast) return;

    gridWindData.forEach((pt) => {
      const mm = pt.hourly?.precipitation?.[windHourIndex];
      const proba = pt.hourly?.precipitation_probability?.[windHourIndex];
      const color = Number.isFinite(mm) ? rainColor(mm) : null;
      if (!color) return;
      const circle = L.circleMarker([pt.lat, pt.lon], {
        radius: 16,
        color: 'transparent',
        fillColor: color,
        fillOpacity: 1,
        weight: 0,
      });
      circle.bindTooltip(`🌧️ ${mm.toFixed(1)}mm/h${Number.isFinite(proba) ? ` · ${proba}% de proba` : ''}`, { direction: 'top' });
      circle.addTo(group);
    });
  }, [gridWindData, windHourIndex, showRainForecast]);

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

  // Redimensionne le canvas pour qu'il colle exactement au conteneur de la carte
  // (y compris en tenant compte du devicePixelRatio, sinon le rendu est flou).
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
  const currentRadarFrame = radarFrames[radarIndex];
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

      {/* Contrôles radar pluie */}
      <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-black uppercase text-ink-50">🌧️ Radar pluie</span>
          <button
            onClick={() => setShowRadar((v) => !v)}
            className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border ${
              showRadar ? 'text-volt-400 border-volt-500/30 bg-volt-500/10' : 'text-ink-500 border-ink-700 bg-ink-950'
            }`}
          >
            {showRadar ? 'Affiché' : 'Masqué'}
          </button>
        </div>
        {radarError && <p className="text-[10px] text-rose-400">{radarError}</p>}
        {showRadar && radarFrames.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRadarPlaying((v) => !v)}
                className="w-7 h-7 shrink-0 rounded-lg bg-ink-800 text-ink-50 text-xs flex items-center justify-center"
              >
                {radarPlaying ? '⏸' : '▶'}
              </button>
              <input
                type="range"
                min={0}
                max={radarFrames.length - 1}
                value={radarIndex}
                onChange={(e) => {
                  setRadarPlaying(false);
                  setRadarIndex(Number(e.target.value));
                }}
                className="flex-1 accent-volt-500"
              />
            </div>
            <p className="text-[9px] font-mono text-ink-500 text-center">
              {currentRadarFrame ? new Date(currentRadarFrame.time * 1000).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
              {' · '}Passé (2h) + prévision immédiate (~30min)
            </p>
          </div>
        )}
      </div>

      {/* Contrôles vent + prévision pluie (grille sur la zone visible, 48h, même curseur horaire) */}
      <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-black uppercase text-ink-50">💨 Vent &amp; 🌧️ Pluie (prévision 48h)</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowWind((v) => !v)}
            className={`flex-1 text-[10px] font-bold px-2.5 py-1 rounded-lg border ${
              showWind ? 'text-volt-400 border-volt-500/30 bg-volt-500/10' : 'text-ink-500 border-ink-700 bg-ink-950'
            }`}
          >
            💨 Vent {showWind ? 'affiché' : 'masqué'}
          </button>
          <button
            onClick={() => setShowRainForecast((v) => !v)}
            className={`flex-1 text-[10px] font-bold px-2.5 py-1 rounded-lg border ${
              showRainForecast ? 'text-sky-400 border-sky-500/30 bg-sky-500/10' : 'text-ink-500 border-ink-700 bg-ink-950'
            }`}
          >
            🌧️ Pluie {showRainForecast ? 'affichée' : 'masquée'}
          </button>
        </div>
        {windError && <p className="text-[10px] text-rose-400">{windError}</p>}
        {(showWind || showRainForecast) && (
          <div className="space-y-1.5">
            <input
              type="range"
              min={0}
              max={Math.max(0, windHourOptions.length - 1)}
              value={windHourIndex}
              onChange={(e) => setWindHourIndex(Number(e.target.value))}
              className="w-full accent-volt-500"
              disabled={!windHourOptions.length}
            />
            <p className="text-[9px] font-mono text-ink-500 text-center">
              {windLoading ? 'Chargement du vent & de la pluie…' : currentWindHourLabel || 'Déplace la carte pour charger le vent et la pluie de la zone'}
            </p>
            <p className="text-[9px] text-ink-600 text-center">Curseur : prévision heure par heure sur les 48 prochaines heures.</p>
          </div>
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
        Radar pluie observé : RainViewer (temps réel + ~30min). Prévision pluie &amp; vent heure par heure : Open-Meteo (48h à venir).
      </p>
    </div>
  );
}
