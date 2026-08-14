import React from 'react';

/**
 * Affiche la météo actuelle et quelques indicateurs.
 * Expects the Open-Meteo response shape (current_weather + hourly optional)
 */
export default function WeatherCard({ weather }) {
  if (!weather || !weather.current_weather) return null;
  const cw = weather.current_weather;
  const temp = cw.temperature;
  const wind = cw.windspeed;
  const windDir = cw.winddirection;
  const time = cw.time;
  const units = weather.hourly_units || {};

  // try to show humidity if available (nearest hour)
  let humidity = null;
  if (weather.hourly && weather.hourly.relativehumidity_2m && weather.hourly.time) {
    const idx = weather.hourly.time.indexOf(cw.time);
    if (idx >= 0) humidity = weather.hourly.relativehumidity_2m[idx];
    else humidity = weather.hourly.relativehumidity_2m[0];
  }

  return (
    <div className="p-4 border rounded bg-white shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-3xl font-bold">{Math.round(temp)}°{(units.temperature_2m || 'C').replace('°','')}</div>
          <div className="text-sm text-slate-600">Météo actuelle</div>
        </div>
        <div className="text-sm text-slate-500 text-right">
          <div>{time}</div>
          <div>Vent {Math.round(wind)} {units.windspeed_10m || 'km/h'} • {Math.round(windDir)}°</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div className="text-center">
          <div className="text-xs text-slate-500">Humidité</div>
          <div className="font-semibold">{humidity !== null ? `${Math.round(humidity)}%` : '—'}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-slate-500">Précip.</div>
          <div className="font-semibold">{weather.hourly?.precipitation?.[0] ?? '—'}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-slate-500">Pression</div>
          <div className="font-semibold">{weather.hourly?.surface_pressure?.[0] ?? '—'}</div>
        </div>
      </div>
    </div>
  );
}
