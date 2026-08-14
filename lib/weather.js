// Fonctions utilitaires pour interroger l'API Open-Meteo (gratuit, sans clé)

// Geocoding: returns array of { id, name, country, admin1, latitude, longitude }
export async function geocodeCity(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    name
  )}&count=8&language=fr`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding failed');
  const data = await res.json();
  return (data.results || []).map((r) => ({
    id: r.id ?? `${r.latitude}-${r.longitude}-${r.name}`,
    name: r.name,
    country: r.country,
    admin1: r.admin1,
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

// Reverse geocoding: get a readable place from coords (if available)
export async function reverseGeocode(latitude, longitude) {
  const url = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${encodeURIComponent(
    latitude
  )}&longitude=${encodeURIComponent(longitude)}&count=1&language=fr`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Reverse geocoding failed');
  const data = await res.json();
  const r = (data.results && data.results[0]) || null;
  if (!r) return null;
  return {
    id: r.id ?? `${r.latitude}-${r.longitude}-${r.name}`,
    name: r.name,
    country: r.country,
    admin1: r.admin1,
    latitude: r.latitude,
    longitude: r.longitude,
  };
}

// Fetch current weather + a few hourly variables and daily forecast (days param)
export async function fetchCurrentWeather(latitude, longitude, days = 7) {
  // daily fields for multi-day forecast
  const dailyFields = [
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_sum',
    'sunrise',
    'sunset',
  ].join(',');

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current_weather: 'true',
    hourly: 'temperature_2m,relativehumidity_2m,windspeed_10m',
    daily: dailyFields,
    timezone: 'auto',
  });
  // limit days by using start_date/end_date if needed (Open-Meteo returns 7-16 days by default depending on params)
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather fetch failed');
  const data = await res.json();
  return data;
}
