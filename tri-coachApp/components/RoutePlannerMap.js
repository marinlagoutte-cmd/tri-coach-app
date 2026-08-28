import React, { useEffect, useRef } from 'react';

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
 *      marqueur de départ devenant aussi le marqueur départ/arrivée de la boucle.
 * Chargée en dynamic(ssr:false) par RoutePlanner.js — accès direct à `window`/DOM Leaflet,
 * incompatible avec le rendu serveur Next.js (même raison que WeatherRadarMap.js).
 */
export default function RoutePlannerMap({ start, onSetStart, routePoints }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const LRef = useRef(null);
  const startMarkerRef = useRef(null);
  const routeLayerRef = useRef(null);
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

  return <div ref={mapElRef} className="w-full h-full" />;
}
