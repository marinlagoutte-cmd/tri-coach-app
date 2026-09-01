// lib/mapTiles.js
// Fond de carte partagé (Leaflet, tuiles sombres CARTO) — utilisé par
// components/RoutePlannerMap.js, components/ActivityDetail.js et
// components/WeatherRadarMap.js.
//
// CARTO exige désormais une clé API (gratuite jusqu'à 5M requêtes/mois) pour
// ses tuiles raster basemaps.cartocdn.com — sans clé, chaque tuile est servie
// avec un filigrane "API KEY REQUIRED" par-dessus la carte. Voir CARTO_SETUP.md
// pour créer la clé gratuite (2 minutes, aucune carte bancaire requise).
//
// NEXT_PUBLIC_ obligatoire : cette clé part dans le bundle client (Leaflet
// charge les tuiles depuis le navigateur), donc pas de variable "secrète"
// possible ici — c'est le fonctionnement normal/attendu de ce type de clé
// (limitée par quota et par domaine référent côté CARTO, pas par secret).
const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY || '';

export const CARTO_KEY_CONFIGURED = Boolean(CARTO_API_KEY);

const BASE_DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

export const DARK_TILES = CARTO_KEY_CONFIGURED
  ? `${BASE_DARK_TILES}?key=${CARTO_API_KEY}`
  : BASE_DARK_TILES;

export const TILES_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
