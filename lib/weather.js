// lib/weather.js
// Utilitaires météo — données fournies par Open-Meteo (pas de clé API nécessaire)

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const REVERSE_GEOCODING_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

/**
 * Recherche des villes par nom.
 * @param {string} query
 * @returns {Promise<Array<{id, name, country, admin1, latitude, longitude}>>}
 */
export async function geocodeCity(query) {
  if (!query || !query.trim()) return [];

  const url = `${GEOCODING_URL}?name=${encodeURIComponent(query)}&count=5&language=fr&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Erreur lors de la recherche de la ville.');

  const data = await res.json();
  return (data.results || []).map((r) => ({
    id: r.id,
    name: r.name,
    country: r.country,
    admin1: r.admin1,
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

/**
 * Retrouve le nom d'un lieu à partir de coordonnées GPS.
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<{name, country, admin1}|null>}
 */
export async function reverseGeocode(latitude, longitude) {
  const url = `${REVERSE_GEOCODING_URL}?latitude=${latitude}&longitude=${longitude}&localityLanguage=fr`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (!data) return null;

  return {
    name: data.city || data.locality || data.principalSubdivision || 'Position actuelle',
    country: data.countryName,
    admin1: data.principalSubdivision,
  };
}

/**
 * Récupère la météo actuelle et les prévisions pour une position donnée.
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} days Nombre de jours de prévisions (défaut 7)
 */
export async function fetchCurrentWeather(latitude, longitude, days = 7) {
  const params = new URLSearchParams({
    latitude,
    longitude,
    current_weather: 'true',
    hourly: 'relativehumidity_2m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,surface_pressure_mean,weathercode',
    timezone: 'auto',
    forecast_days: days,
  });

  const url = `${FORECAST_URL}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Impossible de récupérer la météo.');

  return res.json();
}
