import React, { useEffect, useState } from 'react';
import { fetchCurrentWeather, reverseGeocode } from '../lib/weather';

const WEATHER_ICON = (code) => {
  if (code === 0) return '☀️';
  if ([1, 2].includes(code)) return '🌤️';
  if (code === 3) return '☁️';
  if ([45, 48].includes(code)) return '🌫️';
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return '🌧️';
  if ([71, 73, 75, 85, 86].includes(code)) return '❄️';
  if ([95, 96, 99].includes(code)) return '⛈️';
  return '🌡️';
};

export default function WeatherPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [weather, setWeather] = useState(null);

  // Rafraîchit systématiquement à chaque montage (= chaque ouverture de l'app / de l'onglet),
  // sans dépendre d'un cache : la météo doit toujours être la plus récente possible.
  const loadWeather = () => {
    setLoading(true);
    setError('');
    if (!navigator?.geolocation) {
      setError("Géolocalisation non disponible sur cet appareil.");
      setLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const [place, data] = await Promise.all([
            reverseGeocode(latitude, longitude).catch(() => null),
            fetchCurrentWeather(latitude, longitude, 7),
          ]);
          setPlaceName(place?.name || 'Ta position');
          setWeather(data);
        } catch (e) {
          setError("Impossible de récupérer la météo pour le moment.");
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        setLoading(false);
        setError(err.code === 1 ? "Autorise la géolocalisation pour voir la météo de ta semaine d'entraînement." : "Impossible de récupérer ta position.");
      },
      { maximumAge: 0, timeout: 10_000 }
    );
  };

  useEffect(() => { loadWeather(); }, []);

  const cw = weather?.current_weather;
  const daily = weather?.daily;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-black uppercase text-white">🌦️ Météo d'entraînement</h2>
        <button
          onClick={loadWeather}
          disabled={loading}
          className="text-[10px] font-bold text-volt-400 border border-volt-500/30 bg-volt-500/10 px-2.5 py-1 rounded-lg disabled:opacity-50"
        >
          ↻ Actualiser
        </button>
      </div>

      {error && <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 p-3 rounded-xl">{error}</p>}
      {loading && !weather && <p className="text-xs text-ink-500 animate-pulse">Localisation et récupération de la météo...</p>}

      {cw && (
        <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">{placeName}</span>
            <span className="text-3xl font-black text-white">{Math.round(cw.temperature)}°C</span>
          </div>
          <div className="text-right text-xs text-ink-400 font-mono">
            <div className="text-3xl">{WEATHER_ICON(cw.weathercode)}</div>
            <div>Vent {Math.round(cw.windspeed)} km/h</div>
          </div>
        </div>
      )}

      {daily && (
        <div className="grid grid-flow-col auto-cols-[minmax(88px,1fr)] gap-2 overflow-x-auto pb-1">
          {daily.time.map((date, i) => (
            <div key={date} className="bg-ink-900 border border-ink-800 rounded-xl p-2.5 text-center flex flex-col items-center gap-1">
              <span className="text-[9px] font-bold uppercase text-ink-500">
                {new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(new Date(date))}
              </span>
              <span className="text-lg">{WEATHER_ICON(daily.weathercode?.[i])}</span>
              <span className="text-[10px] font-mono text-white font-bold">{Math.round(daily.temperature_2m_max[i])}°</span>
              <span className="text-[9px] font-mono text-ink-500">{Math.round(daily.temperature_2m_min[i])}°</span>
              {daily.precipitation_sum?.[i] > 0 && (
                <span className="text-[9px] text-cyan-400">💧{daily.precipitation_sum[i]}mm</span>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-[9px] text-ink-600 text-center">
        Données Open-Meteo, position de l'appareil, actualisées à chaque ouverture de l'onglet.
      </p>
    </div>
  );
}
