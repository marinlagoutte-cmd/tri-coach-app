import React from 'react';

/**
 * Affiche la météo actuelle et quelques indicateurs.
 * Expects the Open-Meteo response shape (current_weather + daily optional)
 */
export default function WeatherCard({ weather }) {
  if (!weather || !weather.current_weather) return null;
  const cw = weather.current_weather;
  const temp = cw.temperature;
  const wind = cw.windspeed;
  const windDir = cw.winddirection;
  const time = cw.time;
  const units = weather.daily_units || {};

  return (
    <div className="p-4 border rounded bg-white shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-3xl font-bold">{Math.round(temp)}°{(units.temperature_2m_max || 'C').replace('°','')}</div>
          <div className="text-sm text-slate-600">Météo actuelle</div>
        </div>
        <div className="text-sm text-slate-500 text-right">
          <div>{time}</div>
          <div>Vent {Math.round(wind)} {weather.hourly_units?.windspeed_10m || 'km/h'} • {Math.round(windDir)}°</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div className="text-center">
          <div className="text-xs text-slate-500">Humidité</div>
          <div className="font-semibold">{getNearestHumidity(weather, cw.time)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-slate-500">Précip.</div>
          <div className="font-semibold">{getDailyValue(weather, 'precipitation_sum')[0] ?? '—'}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-slate-500">Pression</div>
          <div className="font-semibold">{getDailyValue(weather, 'surface_pressure_mean')[0] ?? '—'}</div>
        </div>
      </div>
    </div>
  );
}

function getNearestHumidity(weather, time) {
  if (!weather.hourly || !weather.hourly.relativehumidity_2m || !weather.hourly.time) return '—';
  const idx = weather.hourly.time.indexOf(time);
  const val = idx >= 0 ? weather.hourly.relativehumidity_2m[idx] : weather.hourly.relativehumidity_2m[0];
  return val != null ? `${Math.round(val)}%` : '—';
}

function getDailyValue(weather, key) {
  if (!weather.daily || !weather.daily[key]) return [];
  return weather.daily[key];
}
