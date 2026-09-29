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

/**
 * Récupère température et humidité ACTUELLES pour un point donné, sous une forme
 * compacte réutilisée par l'ajustement météo des séances (voir EnviroAdjustment
 * dans components/WorkoutDetail.js). S'appuie sur fetchCurrentWeather ci-dessus,
 * donc aucun nouvel appel réseau : juste une lecture ciblée dans la même réponse.
 *
 * L'humidité n'est fournie par Open-Meteo qu'en horaire (hourly.relativehumidity_2m),
 * jamais dans current_weather — on prend donc le point horaire le plus proche de
 * l'heure "actuelle" renvoyée par current_weather.time.
 */
export async function fetchCurrentConditions(latitude, longitude) {
  const data = await fetchCurrentWeather(latitude, longitude, 1);
  const tempC = Number.isFinite(data?.current_weather?.temperature) ? data.current_weather.temperature : null;

  let humidityPct = null;
  const hourlyTimes = data?.hourly?.time || [];
  const hourlyHumidity = data?.hourly?.relativehumidity_2m || [];
  const nowIso = data?.current_weather?.time;
  if (nowIso && hourlyTimes.length && hourlyHumidity.length) {
    let idx = hourlyTimes.indexOf(nowIso);
    if (idx === -1) {
      const nowMs = new Date(nowIso).getTime();
      idx = hourlyTimes.reduce((best, t, i) => {
        const diff = Math.abs(new Date(t).getTime() - nowMs);
        const bestDiff = Math.abs(new Date(hourlyTimes[best]).getTime() - nowMs);
        return diff < bestDiff ? i : best;
      }, 0);
    }
    humidityPct = Number.isFinite(hourlyHumidity[idx]) ? hourlyHumidity[idx] : null;
  }

  return { tempC, humidityPct };
}

// Seuil de chaleur à partir duquel on commence à ajuster (aligné sur la même
// convention que lib/nutritionData.js — HEAT_LABELS : cool <15°C, mild 15-25°C,
// hot >25°C — pour que "il fait chaud" veuille dire la même chose dans l'onglet
// Nutrition et ici). L'humidité n'AMPLIFIE l'ajustement que si la chaleur est déjà
// présente (20°C+) — une humidité élevée par temps frais n'a pas le même impact
// sur l'allure soutenable.
const HEAT_PACE_STEPS = [
  { min: 30, pct: 0.08 },
  { min: 25, pct: 0.05 },
  { min: 20, pct: 0.02 },
];

/**
 * Calcule le pourcentage de ralentissement d'allure (course) / réduction de
 * puissance (vélo) à appliquer selon la température et l'humidité actuelles —
 * même principe que l'EnviroNorm de TriDot : au-delà d'un seuil de chaleur/humidité,
 * l'allure prescrite est allongée de quelques %, jamais tenue telle quelle.
 *
 * RÈGLE : ceci est une heuristique de coaching (seuils raisonnables, pas un calcul
 * physiologique individuel) — jamais présentée comme une mesure exacte, toujours
 * affichée avec la température/humidité qui la justifient (voir WorkoutDetail.js).
 */
export function computeHeatPaceAdjustment(tempC, humidityPct) {
  if (!Number.isFinite(tempC)) return { active: false, pct: 0, level: 'none', tempC: null, humidityPct: null };

  const humidity = Number.isFinite(humidityPct) ? humidityPct : null;

  let pct = 0;
  for (const step of HEAT_PACE_STEPS) {
    if (tempC >= step.min) { pct = step.pct; break; }
  }

  if (tempC >= 20 && humidity != null) {
    if (humidity >= 75) pct += 0.02;
    else if (humidity >= 60) pct += 0.01;
  }

  pct = Math.min(pct, 0.10); // plafond de sécurité — jamais plus de 10%
  const active = pct > 0;
  const level = pct >= 0.06 ? 'high' : active ? 'moderate' : 'none';

  return { active, pct: Math.round(pct * 1000) / 1000, level, tempC, humidityPct: humidity };
}

/**
 * Applique un ralentissement à une allure "M:SS /km" ou "M:SS /100m" (chaleur =
 * allure cible plus lente). Renvoie null si `paceStr` ne contient pas d'allure
 * chiffrée reconnaissable (ex: repli RPE "Allure selon ressenti...") — jamais
 * une valeur inventée sur un champ texte libre.
 */
export function applyPaceAdjustment(paceStr, pct) {
  if (!pct || pct <= 0) return null;
  const m = String(paceStr || '').match(/(\d+):(\d{2})/);
  if (!m) return null;
  const totalSec = Number(m[1]) * 60 + Number(m[2]);
  const adjustedSec = Math.round(totalSec * (1 + pct));
  const min = Math.floor(adjustedSec / 60);
  const sec = adjustedSec % 60;
  const adjustedPace = `${min}:${String(sec).padStart(2, '0')}`;
  const suffix = String(paceStr).replace(/\d+:\d{2}/, '').trim();
  return suffix ? `${adjustedPace} ${suffix}` : adjustedPace;
}

/**
 * Applique une réduction à une puissance "NNNW" (chaleur = puissance soutenable
 * plus basse). Renvoie null si `wattsStr` ne contient pas de watts chiffrés
 * reconnaissables (ex: repli RPE "Effort selon ressenti...").
 */
export function applyPowerAdjustment(wattsStr, pct) {
  if (!pct || pct <= 0) return null;
  const m = String(wattsStr || '').match(/(\d+)\s*W/i);
  if (!m) return null;
  const watts = Number(m[1]);
  const adjustedWatts = Math.round(watts * (1 - pct));
  return String(wattsStr).replace(/\d+\s*W/i, `${adjustedWatts}W`);
}
