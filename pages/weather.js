import { useState, useEffect, useRef } from 'react';
import WeatherCard from '../components/WeatherCard';
import { geocodeCity, fetchCurrentWeather } from '../lib/weather';

export default function WeatherPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);

  // Try device geolocation on mount to prefill
  useEffect(() => {
    if (!navigator?.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          setLoading(true);
          const w = await fetchCurrentWeather(latitude, longitude);
          setWeather(w);
          setSelected({ name: 'Position actuelle', latitude, longitude });
        } catch (err) {
          console.error('Geoloc weather error', err);
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        // Permission denied or unavailable -> ignore silently
        console.warn('Geolocation unavailable', err.message);
      },
      { maximumAge: 1000 * 60 * 5 }
    );
  }, []);

  // Debounced city search for better UX and fewer requests
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

  // When user selects a location, fetch weather
  async function handleSelect(loc) {
    setSelected(loc);
    setWeather(null);
    setError('');
    setLoading(true);
    try {
      const w = await fetchCurrentWeather(loc.latitude, loc.longitude);
      setWeather(w);
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

        <div className="mb-4">
          <label className="block text-sm text-slate-600 mb-2">Rechercher une ville</label>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ex: Paris"
              className="flex-1 border rounded px-3 py-2"
            />
            <button
              onClick={() => { setQuery(''); setResults([]); setSelected(null); setWeather(null); }}
              className="px-4 py-2 bg-gray-200 rounded"
            >
              Effacer
            </button>
          </div>
          {searching && <div className="text-sm text-slate-500 mt-2">Recherche…</div>}
        </div>

        {error && <div className="text-red-600 mb-3">{error}</div>}

        {results.length > 0 && (
          <div className="mb-4 grid gap-2">
            <div className="text-sm text-slate-600">Résultats :</div>
            {results.map((r) => (
              <button
                key={`${r.id}-${r.latitude}-${r.longitude}`}
                onClick={() => handleSelect(r)}
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
            {!loading && weather && <WeatherCard weather={weather} />}
            {!loading && !weather && <div className="text-sm text-slate-500">Cliquez sur une ville pour afficher la météo.</div>}
          </div>
        )}

        <div className="mt-6 text-xs text-slate-500">
          Données fournies par Open‑Meteo — pas de clé nécessaire.
        </div>
      </div>
    </div>
  );
}
