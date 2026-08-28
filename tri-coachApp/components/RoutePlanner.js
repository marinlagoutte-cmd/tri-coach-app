import React, { useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useI18n } from '../lib/i18n';
import { geocodeCity } from '../lib/weather';
import { impactColor, IMPACT_LABEL } from '../lib/windMap';

// Carte Leaflet du résultat — chargement client-only, même raison que WeatherRadarMap
// (accès direct à `window`/DOM, incompatible avec le rendu serveur Next.js).
const RouteResultMap = dynamic(() => import('./RouteResultMap'), {
  ssr: false,
  loading: () => <p className="text-xs text-ink-500 animate-pulse text-center py-8">Chargement de la carte…</p>,
});

/**
 * Planificateur de parcours vélo — demande explicite de l'athlète : depuis un point de
 * départ et une distance, tracer une boucle qui optimise le vent (dos/face) et tient
 * compte des routes populaires (Strava + réseau cyclable OSM), avec la même IA que le
 * reste de l'app (Gemini + Groq) pour le choix final et la stratégie course.
 * Orchestration complète côté serveur — voir pages/api/plan-route.js pour le détail.
 */
export default function RoutePlanner({ session }) {
  const { t, lang } = useI18n();

  // --- Point de départ ---
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [start, setStart] = useState(null); // { lat, lon, name }
  const [geoError, setGeoError] = useState('');
  const searchDebounceRef = useRef(null);

  // --- Paramètres ---
  const [distanceKm, setDistanceKm] = useState(60);
  const [avgSpeedKmh, setAvgSpeedKmh] = useState(28);
  const [departure, setDeparture] = useState(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    return d.toISOString().slice(0, 16);
  });

  // --- Génération ---
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!query.trim() || query.length < 2) {
      setSuggestions([]);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await geocodeCity(query);
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      } finally {
        setSearchLoading(false);
      }
    }, 350);
    return () => clearTimeout(searchDebounceRef.current);
  }, [query]);

  const useMyLocation = useCallback(() => {
    setGeoError('');
    if (!navigator.geolocation) {
      setGeoError('Géolocalisation non disponible sur cet appareil.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStart({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: 'Ma position' });
        setQuery('Ma position');
        setSuggestions([]);
      },
      () => setGeoError("Impossible d'accéder à ta position — vérifie les autorisations de localisation."),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  const pickSuggestion = useCallback((s) => {
    setStart({ lat: s.latitude, lon: s.longitude, name: `${s.name}${s.admin1 ? `, ${s.admin1}` : ''}` });
    setQuery(`${s.name}${s.admin1 ? `, ${s.admin1}` : ''}`);
    setSuggestions([]);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!start) {
      setError('Choisis un point de départ (recherche une ville ou utilise ta position).');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/plan-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: session?.access_token,
          startLat: start.lat,
          startLon: start.lon,
          startPlaceName: start.name,
          distanceKm,
          avgSpeedKmh,
          departure,
          language: lang,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Échec de la génération du parcours.');
      setResult(data);
    } catch (e) {
      setError(e.message || 'Échec de la génération du parcours.');
    } finally {
      setLoading(false);
    }
  }, [start, distanceKm, avgSpeedKmh, departure, lang, session?.access_token]);

  const downloadGpx = useCallback(() => {
    if (!result?.gpx) return;
    const blob = new Blob([result.gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parcours-${Math.round(result.winner.distanceKm)}km.gpx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-black uppercase text-ink-50">🚴 Parcours optimisé vent</h2>
      </div>

      {/* --- Formulaire --- */}
      <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3 space-y-3">
        <div className="space-y-1.5 relative">
          <label className="text-[10px] font-bold uppercase text-ink-500">Point de départ</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setStart(null); }}
              placeholder="Rechercher une ville…"
              className="flex-1 bg-ink-950 border border-ink-700 rounded-xl px-3 py-2 text-xs text-ink-50 placeholder:text-ink-600"
            />
            <button
              onClick={useMyLocation}
              className="shrink-0 px-3 py-2 rounded-xl bg-ink-800 text-ink-50 text-xs font-bold border border-ink-700"
              title="Utiliser ma position"
            >
              📍
            </button>
          </div>
          {searchLoading && <p className="text-[10px] text-ink-500">Recherche…</p>}
          {suggestions.length > 0 && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-ink-950 border border-ink-700 rounded-xl overflow-hidden shadow-xl">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => pickSuggestion(s)}
                  className="w-full text-left px-3 py-2 text-xs text-ink-200 hover:bg-ink-800 border-b border-ink-800 last:border-0"
                >
                  {s.name}{s.admin1 ? `, ${s.admin1}` : ''} <span className="text-ink-500">({s.country})</span>
                </button>
              ))}
            </div>
          )}
          {geoError && <p className="text-[10px] text-rose-400">{geoError}</p>}
          {start && !suggestions.length && (
            <p className="text-[10px] text-volt-400">✓ {start.name} ({start.lat.toFixed(3)}, {start.lon.toFixed(3)})</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase text-ink-500">Distance (km)</label>
            <input
              type="number"
              min={5}
              max={300}
              value={distanceKm}
              onChange={(e) => setDistanceKm(Number(e.target.value))}
              className="w-full bg-ink-950 border border-ink-700 rounded-xl px-3 py-2 text-xs text-ink-50"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase text-ink-500">Vitesse moy. (km/h)</label>
            <input
              type="number"
              min={10}
              max={50}
              value={avgSpeedKmh}
              onChange={(e) => setAvgSpeedKmh(Number(e.target.value))}
              className="w-full bg-ink-950 border border-ink-700 rounded-xl px-3 py-2 text-xs text-ink-50"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase text-ink-500">Départ prévu</label>
          <input
            type="datetime-local"
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
            className="w-full bg-ink-950 border border-ink-700 rounded-xl px-3 py-2 text-xs text-ink-50"
          />
        </div>

        <button
          onClick={handleGenerate}
          disabled={loading || !start}
          className="w-full py-2.5 rounded-xl bg-volt-500 text-white text-xs font-black uppercase disabled:opacity-40"
        >
          {loading ? 'Génération en cours…' : 'Générer le parcours'}
        </button>
        {error && <p className="text-[10px] text-rose-400">{error}</p>}
      </div>

      {/* --- Résultat --- */}
      {result && (
        <div className="space-y-3">
          <div className="rounded-2xl overflow-hidden border border-ink-800" style={{ height: '320px' }}>
            <RouteResultMap points={result.winner.points} />
          </div>

          <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black uppercase text-ink-50">📊 Récap</span>
              <button
                onClick={downloadGpx}
                className="text-[10px] font-bold px-2.5 py-1 rounded-lg border text-volt-400 border-volt-500/30 bg-volt-500/10"
              >
                ⬇ GPX
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="text-ink-400">Distance <span className="text-ink-50 font-bold">{result.winner.distanceKm}km</span></div>
              <div className="text-ink-400">Dénivelé <span className="text-ink-50 font-bold">{result.winner.ascentM != null ? `+${result.winner.ascentM}m` : '?'}</span></div>
              <div className="text-ink-400">Vent de dos <span className="font-bold" style={{ color: impactColor('tail') }}>{result.winner.wind.distTailKm}km</span></div>
              <div className="text-ink-400">Vent de face <span className="font-bold" style={{ color: impactColor('head') }}>{result.winner.wind.distHeadKm}km</span></div>
              <div className="text-ink-400">Vent de travers <span className="font-bold" style={{ color: impactColor('cross') }}>{result.winner.wind.distCrossKm}km</span></div>
              <div className="text-ink-400">Routes populaires <span className="text-ink-50 font-bold">{Math.round(result.winner.popularityScore * 100)}%</span></div>
            </div>
            {result.strategyNote && (
              <p className="text-[11px] text-ink-200 bg-ink-950 rounded-xl p-2 mt-1">💡 {result.strategyNote}</p>
            )}
            {result.doubleCheckNote && (
              <p className="text-[9px] text-ink-500 italic">{result.doubleCheckNote}</p>
            )}
            {!result.stravaAvailable && (
              <p className="text-[9px] text-ink-500">ℹ️ Compte Strava non lié — popularité basée uniquement sur le réseau cyclable officiel.</p>
            )}
            {result.warnings?.map((w, i) => (
              <p key={i} className="text-[9px] text-amber-400">⚠️ {w}</p>
            ))}
          </div>

          {result.alternatives?.length > 0 && (
            <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3 space-y-1.5">
              <span className="text-[10px] font-black uppercase text-ink-500">Autres candidats écartés</span>
              {result.alternatives.map((a, i) => (
                <div key={i} className="flex items-center justify-between text-[10px] text-ink-400">
                  <span>{a.distanceKm}km · vent net {a.wind.netScore >= 0 ? '+' : ''}{a.wind.netScore}km · {Math.round(a.popularityScore * 100)}% populaire</span>
                  <span className="text-ink-600">score {a.compositeScore}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
