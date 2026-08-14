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

// Fetch current weather + a few hourly variables (humidity...) with timezone auto
export async function fetchCurrentWeather(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current_weather: 'true',
    hourly: 'temperature_2m,relativehumidity_2m,windspeed_10m,precipitation,surface_pressure',
    timezone: 'auto',
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather fetch failed');
  const data = await res.json();
  return data;
}
