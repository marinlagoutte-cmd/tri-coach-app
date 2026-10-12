// lib/todayWeather.js — météo et vent DU JOUR en bref (widget de l'écran Aujourd'hui).
// Une seule requête Open-Meteo légère (aucune clé) ; la position est mémorisée après la
// première autorisation pour que le widget se charge ensuite tout seul.

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

export function compassFr(deg) {
  if (!Number.isFinite(deg)) return '';
  return DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

// Codes météo WMO (Open-Meteo) → libellé court.
export function weatherLabel(code) {
  const c = Number(code);
  if (c === 0) return 'Ciel dégagé';
  if (c === 1 || c === 2) return 'Peu nuageux';
  if (c === 3) return 'Couvert';
  if (c === 45 || c === 48) return 'Brouillard';
  if (c >= 51 && c <= 57) return 'Bruine';
  if (c >= 61 && c <= 67) return 'Pluie';
  if (c >= 71 && c <= 77) return 'Neige';
  if (c >= 80 && c <= 82) return 'Averses';
  if (c === 85 || c === 86) return 'Averses de neige';
  if (c >= 95) return 'Orage';
  return '—';
}

export async function fetchTodayWeather(latitude, longitude) {
  const params = new URLSearchParams({
    latitude, longitude, timezone: 'auto', forecast_days: '1',
    current: 'temperature_2m,wind_speed_10m,wind_direction_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant',
  });
  const res = await fetch(`${FORECAST_URL}?${params.toString()}`);
  if (!res.ok) throw new Error('Météo indisponible.');
  const d = await res.json();
  const day = (k) => (Array.isArray(d?.daily?.[k]) ? d.daily[k][0] : null);
  return {
    label: weatherLabel(day('weather_code')),
    tMax: day('temperature_2m_max'),
    tMin: day('temperature_2m_min'),
    tNow: d?.current?.temperature_2m ?? null,
    rainProb: day('precipitation_probability_max'),
    rainMm: day('precipitation_sum'),
    windMax: day('wind_speed_10m_max'),
    gustMax: day('wind_gusts_10m_max'),
    windDir: day('wind_direction_10m_dominant'),
  };
}
