import React, { useEffect, useRef } from 'react';

const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILES_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

/**
 * Affiche un tracé simple (liste de {lat, lon}) sur une carte Leaflet — départ/arrivée
 * marqués, pas de flèches de vent ici (le récap chiffré vent/popularité est déjà affiché
 * en dessous par RoutePlanner.js ; la carte reste volontairement lisible/épurée).
 */
export default function RouteResultMap({ points }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapElRef.current) return;

      if (!mapRef.current) {
        const map = L.map(mapElRef.current, { zoomControl: true, attributionControl: true });
        L.tileLayer(DARK_TILES, { attribution: TILES_ATTRIBUTION, maxZoom: 19, subdomains: 'abcd' }).addTo(map);
        mapRef.current = map;
      }

      const map = mapRef.current;
      if (!points?.length) return;

      const latlngs = points.map((p) => [p.lat, p.lon]);
      const layer = L.layerGroup().addTo(map);
      L.polyline(latlngs, { color: '#83E040', weight: 4, opacity: 0.9 }).addTo(layer);
      L.circleMarker(latlngs[0], { radius: 7, color: '#34D399', fillColor: '#34D399', fillOpacity: 1 })
        .bindTooltip('Départ / Arrivée', { permanent: false })
        .addTo(layer);

      const bounds = L.latLngBounds(latlngs);
      map.fitBounds(bounds, { padding: [24, 24] });
    })();
    return () => { cancelled = true; };
  }, [points]);

  useEffect(() => () => {
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
  }, []);

  return <div ref={mapElRef} className="w-full h-full" />;
}
