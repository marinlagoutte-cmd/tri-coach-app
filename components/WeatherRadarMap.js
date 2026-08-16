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

function hourLabel(iso) {
  return new Date(iso).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

function windArrowDivIcon(L, { angleTowards, color, size = 22, ring = false }) {
  const html = `<div style="width:${size}px;height:${size}px;transform:rotate(${angleTowards}deg);display:flex;align-items:center;justify-content:center;${
    ring ? 'filter:drop-shadow(0 0 4px rgba(131,88,255,0.9));' : ''
  }">
    <svg width="${size}" height="${size}" viewBox="0 0 24 24">
      <path d="M12 1.5 L19 15 L12 11 L5 15 Z" fill="${color}" stroke="rgba(8,6,20,0.85)" stroke-width="1"/>
    </svg>
  </div>`;
  return L.divIcon({ html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

export default function WeatherRadarMap() {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const LRef = useRef(null);
  const radarLayerRef = useRef(null);
  const windLayerGroupRef = useRef(null);
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

  const refreshWindGridRef = useRef(refreshWindGrid);
  useEffect(() => {
    refreshWindGridRef.current = refreshWindGrid;
  }, [refreshWindGrid]);

  // Premier chargement de la grille dès que la carte est prête
  useEffect(() => {
    if (mapReady) refreshWindGrid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, showWind]);

  // Redessine les flèches de vent (grille) à chaque changement d'heure / de données
  useEffect(() => {
    const L = LRef.current;
    const group = windLayerGroupRef.current;
    if (!L || !group) return;
    group.clearLayers();
    if (!showWind) return;

    gridWindData.forEach((pt) => {
      const speed = pt.hourly?.wind_speed_10m?.[windHourIndex];
      const dir = pt.hourly?.wind_direction_10m?.[windHourIndex];
      const precip = pt.hourly?.precipitation?.[windHourIndex];
      if (!Number.isFinite(speed) || !Number.isFinite(dir)) return;
      const towards = (dir + 180) % 360;
      const icon = windArrowDivIcon(L, { angleTowards: towards, color: speedColor(speed), size: 20 + Math.min(speed, 40) * 0.3 });
      const marker = L.marker([pt.lat, pt.lon], { icon, interactive: true });
      marker.bindTooltip(
        `💨 ${Math.round(speed)} km/h${precip > 0.2 ? ` · 🌧️ ${precip.toFixed(1)}mm` : ''}`,
        { direction: 'top', opacity: 0.9 }
      );
      marker.addTo(group);
    });
  }, [gridWindData, windHourIndex, showWind]);

  // ---------------------------------------------------------------------
  // GPX — import, tracé, et vecteurs de vent le long du parcours
  // ---------------------------------------------------------------------
  // Calcule les échantillons du tracé + le vent/l'impact à chaque point, pour la
  // vitesse et l'heure de départ actuellement réglées. Réutilisé à l'import initial
  // et à chaque recalcul manuel (bouton "Recalculer le vent").
  const computeRouteWind = useCallback(async (parsed) => {
    const stepKm = Math.max(1, Math.round(parsed.totalDistanceKm / 25));
    const samples = sampleRoute(parsed.points, stepKm);
    const windResults = await fetchWindForPoints(samples.map((s) => ({ lat: s.lat, lon: s.lon })));
    const depDate = new Date(departure);

    let distTail = 0;
    let distHead = 0;
    let distCross = 0;
    const enriched = samples.map((s, i) => {
      const hourly = windResults[i]?.hourly;
      const etaHours = s.distKm / Math.max(5, avgSpeed);
      const etaDate = new Date(depDate.getTime() + etaHours * 3600 * 1000);
      const hIdx = hourly?.time ? nearestHourIndex(hourly.time, etaDate) : 0;
      const windSpeed = hourly?.wind_speed_10m?.[hIdx];
      const windDir = hourly?.wind_direction_10m?.[hIdx];
      const precip = hourly?.precipitation?.[hIdx];
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

      return { ...s, eta: etaDate, windSpeed, windDir, precip, impact };
    });

    setRouteWind(enriched);
    setRouteSummary({ distTail, distHead, distCross, totalKm: parsed.totalDistanceKm });
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
    L.polyline(latlngs, { color: '#8358FF', weight: 4, opacity: 0.85 }).addTo(group);

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
        const icon = windArrowDivIcon(L, { angleTowards: towards, color: impactColor(s.impact.type), size: 24, ring: true });
        const marker = L.marker([s.lat, s.lon], { icon });
        marker.bindTooltip(
          `${IMPACT_LABEL[s.impact.type]} · ${Math.round(s.windSpeed)} km/h · km ${s.distKm.toFixed(1)}<br/>ETA ${s.eta.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
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
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-950 text-xs text-ink-500 animate-pulse">
            Chargement de la carte…
          </div>
        )}
      </div>

      {/* Contrôles radar pluie */}
      <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-black uppercase text-white">🌧️ Radar pluie</span>
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
                className="w-7 h-7 shrink-0 rounded-lg bg-ink-800 text-white text-xs flex items-center justify-center"
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

      {/* Contrôles vent (grille sur la zone visible) */}
      <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-black uppercase text-white">💨 Vent (48h)</span>
          <button
            onClick={() => setShowWind((v) => !v)}
            className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border ${
              showWind ? 'text-volt-400 border-volt-500/30 bg-volt-500/10' : 'text-ink-500 border-ink-700 bg-ink-950'
            }`}
          >
            {showWind ? 'Affiché' : 'Masqué'}
          </button>
        </div>
        {windError && <p className="text-[10px] text-rose-400">{windError}</p>}
        {showWind && (
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
              {windLoading ? 'Chargement du vent…' : currentWindHourLabel || 'Déplace la carte pour charger le vent de la zone'}
            </p>
          </div>
        )}
      </div>

      {/* Import GPX */}
      <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3 space-y-3">
        <span className="text-[11px] font-black uppercase text-white block">🚴 Sortie vélo — impact du vent sur ton parcours</span>

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
              className="w-full bg-ink-950 border border-ink-800 rounded-lg px-2 py-1.5 text-xs text-white font-mono"
            />
          </label>
          <label className="w-36">
            <span className="text-[9px] font-mono text-ink-500 uppercase block mb-1">Départ</span>
            <input
              type="datetime-local"
              value={departure}
              onChange={(e) => setDeparture(e.target.value)}
              className="w-full bg-ink-950 border border-ink-800 rounded-lg px-2 py-1.5 text-[10px] text-white font-mono"
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
              <span className="text-white font-bold truncate max-w-[55%]">{route.name}</span>
              <span>{route.totalDistanceKm.toFixed(1)} km · D+ {route.elevationGain}m</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg py-1.5">
                <div className="text-[9px] text-emerald-400 font-bold">Vent de dos</div>
                <div className="text-xs font-mono text-white">{routeSummary.distTail.toFixed(1)} km</div>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg py-1.5">
                <div className="text-[9px] text-amber-400 font-bold">Travers</div>
                <div className="text-xs font-mono text-white">{routeSummary.distCross.toFixed(1)} km</div>
              </div>
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg py-1.5">
                <div className="text-[9px] text-rose-400 font-bold">Vent de face</div>
                <div className="text-xs font-mono text-white">{routeSummary.distHead.toFixed(1)} km</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="text-[9px] text-ink-600 text-center">
        Radar pluie : RainViewer (temps réel + ~30min). Vent &amp; précipitations horaires : Open-Meteo (48h).
      </p>
    </div>
  );
}
