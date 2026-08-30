import React, { useEffect, useRef } from 'react';
import { impactColor, windArrowDivIcon } from '../lib/windMap';

const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILES_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

/**
 * Carte interactive du planificateur de parcours (components/RoutePlanner.js) — deux rôles
 * combinés sur une seule carte persistante, demande explicite de l'athlète ("mettre une
 * carte pour positionner le point de départ" + "visualiser le parcours ensuite") :
 *   1. AVANT génération : un clic sur la carte place/déplace le marqueur de départ
 *      (déplaçable à la souris aussi) — `onSetStart(lat, lon)` est appelé à chaque
 *      changement, RoutePlanner.js se charge du géocodage inverse (lib/weather.js) pour
 *      afficher un nom de lieu lisible.
 *   2. APRÈS génération : le tracé du parcours (`routePoints`) est dessiné par-dessus, le
 *      marqueur de départ devenant aussi le marqueur départ/arrivée de la boucle, avec les
 *      flèches de vent (orientation + force, `windSamples`) le long du tracé — même rendu
 *      que pour un GPX importé dans l'onglet Météo (voir lib/windMap.js:windArrowDivIcon,
 *      factorisée entre les deux cartes pour un rendu identique).
 * Chargée en dynamic(ssr:false) par RoutePlanner.js — accès direct à `window`/DOM Leaflet,
 * incompatible avec le rendu serveur Next.js (même raison que WeatherRadarMap.js).
 */
export default function RoutePlannerMap({ start, onSetStart, routePoints, windSamples }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const LRef = useRef(null);
  const startMarkerRef = useRef(null);
  const routeLayerRef = useRef(null);
  const windLayerRef = useRef(null);
  const onSetStartRef = useRef(onSetStart);
  onSetStartRef.current = onSetStart; // évite de ré-attacher les listeners à chaque rendu

  // Initialisation carte — une seule fois.
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
      routeLayerRef.current = L.layerGroup().addTo(map);
      windLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;

      // Un clic place/déplace le départ — c'est le point d'entrée principal demandé par
      // l'athlète pour choisir le point de départ visuellement plutôt qu'en tapant une ville.
      map.on('click', (e) => {
        onSetStartRef.current?.(e.latlng.lat, e.latlng.lng);
      });
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Marqueur de départ — déplaçable à la souris (drag), synchronisé avec `start` fourni par
  // le parent (recherche de ville, géolocalisation, ou clic carte gèrent tous le même state).
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    if (!start) {
      if (startMarkerRef.current) {
        startMarkerRef.current.remove();
        startMarkerRef.current = null;
      }
      return;
    }

    if (!startMarkerRef.current) {
      const icon = L.divIcon({
        html: '<div style="width:16px;height:16px;border-radius:50%;background:#34D399;border:2px solid rgba(8,6,20,0.9);box-shadow:0 0 6px rgba(52,211,153,0.8);"></div>',
        className: '',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      const marker = L.marker([start.lat, start.lon], { icon, draggable: true }).addTo(map);
      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        onSetStartRef.current?.(pos.lat, pos.lng);
      });
      startMarkerRef.current = marker;
      map.setView([start.lat, start.lon], 12);
    } else {
      startMarkerRef.current.setLatLng([start.lat, start.lon]);
    }
  }, [start?.lat, start?.lon]);

  // Tracé du parcours généré — dessiné par-dessus le marqueur de départ.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const layer = routeLayerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    if (!routePoints?.length) return;

    const latlngs = routePoints.map((p) => [p.lat, p.lon]);
    L.polyline(latlngs, { color: '#83E040', weight: 4, opacity: 0.9 }).addTo(layer);
    const bounds = L.latLngBounds(latlngs);
    map.fitBounds(bounds, { padding: [24, 24] });
  }, [routePoints]);

  // Flèches vent (orientation + force) le long du parcours — demande explicite de
  // l'athlète, même principe que le vent affiché pour un GPX importé (onglet Météo) :
  // une flèche par échantillon vent déjà calculé côté serveur (lib/routePlanning.js:
  // scoreRouteWind), tournée vers où le vent SOUFFLE et colorée selon dos/face/travers.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const layer = windLayerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    if (!windSamples?.length) return;

    windSamples.forEach((s) => {
      if (!Number.isFinite(s.windDir) || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return;
      const towards = (s.windDir + 180) % 360;
      const icon = windArrowDivIcon(L, { angleTowards: towards, color: impactColor(s.impactType), size: 22, ring: true });
      const marker = L.marker([s.lat, s.lon], { icon });
      const etaLabel = s.eta
        ? new Date(s.eta).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        : null;
      marker.bindTooltip(
        `${s.windSpeed != null ? `${s.windSpeed} km/h` : 'Vent'} · km ${s.distKm}${etaLabel ? `<br/>ETA ${etaLabel}` : ''}`,
        { direction: 'top' }
      );
      marker.addTo(layer);
    });
  }, [windSamples]);

  return <div ref={mapElRef} className="w-full h-full" />;
}
