import { useState, useEffect, useRef } from 'react';
import WeatherCard from '../components/WeatherCard';
import ForecastChart from '../components/ForecastChart';
import { geocodeCity, fetchCurrentWeather, reverseGeocode } from '../lib/weather';

export default function WeatherPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);

  // Restore last location from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('weather:lastLocation');
      if (raw) {
        const last = JSON.parse(raw);
        if (last?.latitude && last?.longitude) {
          selectLocation(last, { save: false });
        }
      }
    } catch (e) {
      // ignore
    }
  }, []);

  // Debounced city search
  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }
    setSearching(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const locs = await geocodeCity(query);
        setResults(locs);
        setError('');
      } catch (err) {
        console.error(err);
        setError('Erreur lors de la recherche de la ville.');
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Explicit geolocation button
  async function useMyLocation() {
    setError('');
    if (!navigator?.geolocation) {
      setError("Géolocalisation non disponible dans ce navigateur.");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const place = await reverseGeocode(latitude, longitude).catch(() => null);
          const loc = {
            id: `geoloc-${latitude}-${longitude}`,
            name: place?.name ?? 'Position actuelle',
            country: place?.country,
            admin1: place?.admin1,
            latitude,
            longitude,
          };
          await selectLocation(loc, { save: true });
        } catch (err) {
          console.error('Erreur geoloc', err);
          setError("Impossible de récupérer la météo depuis votre position.");
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        console.warn('Geolocation error', err);
        setLoading(false);
        if (err.code === 1) setError('Permission de géolocalisation refusée.');
        else setError('Impossible de récupérer votre position.');
      },
      { maximumAge: 1000 * 60 * 5, timeout: 10_000 }
    );
  }

  // Select a location and fetch weather; use sessionStorage cache keyed by lat_lon_days
  async function selectLocation(loc, opts = { save: true, days: 7 }) {
    setSelected(loc);
    setWeather(null);
    setError('');
    setLoading(true);
    try {
      const cacheKey = `weather:cache:${loc.latitude.toFixed(4)}:${loc.longitude.toFixed(4)}:d${opts.days}`;
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          const age = Date.now() - parsed._ts;
          // use cache if younger than 10 minutes
          if (age < 1000 * 60 * 10) {
            setWeather(parsed.data);
            if (opts.save) localStorage.setItem('weather:lastLocation', JSON.stringify(loc));
            return;
          }
        } catch (e) {
          // ignore parsing error
        }
      }

      const w = await fetchCurrentWeather(loc.latitude, loc.longitude, opts.days);
      setWeather(w);
      // store cache
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ _ts: Date.now(), data: w }));
      } catch (e) {
        // ignore storage errors
      }
      if (opts.save) {
        try { localStorage.setItem('weather:lastLocation', JSON.stringify(loc)); } catch (e) {}
      }
    } catch (err) {
      console.error(err);
      setError('Impossible de récupérer la météo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold mb-4">Weather Dashboard</h1>

        <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:gap-4">
          <div className="flex-1">
            <label className="block text-sm text-slate-600 mb-2">Rechercher une ville</label>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ex: Paris"
                className="flex-1 border rounded px-3 py-2"
              />
              <button
                onClick={() => { setQuery(''); setResults([]); }}
                className="px-4 py-2 bg-gray-200 rounded"
              >
                Effacer
              </button>
            </div>
            {searching && <div className="text-sm text-slate-500 mt-2">Recherche…</div>}
          </div>

          <div className="mt-3 sm:mt-0">
            <label className="block text-sm text-slate-600 mb-2 invisible">Geoloc</label>
            <button
              onClick={useMyLocation}
              className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
              disabled={loading}
            >
              Utiliser ma position
            </button>
          </div>
        </div>

        {error && <div className="text-red-600 mb-3">{error}</div>}

        {results.length > 0 && (
          <div className="mb-4 grid gap-2">
            <div className="text-sm text-slate-600">Résultats :</div>
            {results.map((r) => (
              <button
                key={`${r.id}-${r.latitude}-${r.longitude}`}
                onClick={() => selectLocation(r)}
                className="text-left p-3 border rounded hover:bg-slate-100 flex justify-between items-center"
              >
                <div>
                  <div className="font-medium">
                    {r.name}{r.admin1 ? ` — ${r.admin1}` : ''}{r.country ? `, ${r.country}` : ''}
                  </div>
                  <div className="text-sm text-slate-500">
                    {r.latitude.toFixed(4)}, {r.longitude.toFixed(4)}
                  </div>
                </div>
                <div className="text-sm text-slate-400">Voir</div>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="mb-4">
            <h2 className="text-lg font-semibold mb-2">
              {selected.name}{selected.country ? `, ${selected.country}` : ''}
            </h2>

            {loading && <div>Chargement de la météo…</div>}
            {!loading && weather && (
              <>
                <WeatherCard weather={weather} />
                {weather.daily && <div className="mt-4"><ForecastChart daily={weather.daily} timezone={weather.timezone} /></div>}
              </>
            )}
            {!loading && !weather && <div className="text-sm text-slate-500">Cliquez sur une ville pour afficher la météo.</div>}
          </div>
        )}

        <div className="mt-6 text-xs text-slate-500">
          Données fournies par Open‑Meteo — pas de clé nécessaire. Les prévisions sont mises en cache pendant 10 minutes.
        </div>
      </div>
    </div>
  );
}
