import React, { useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useI18n } from '../lib/i18n';
import { geocodeCity, reverseGeocode } from '../lib/weather';
import { impactColor, IMPACT_LABEL } from '../lib/windMap';

// Carte Leaflet interactive (départ par clic + affichage du parcours) — chargement
// client-only, même raison que WeatherRadarMap (accès direct à `window`/DOM Leaflet).
const RoutePlannerMap = dynamic(() => import('./RoutePlannerMap'), {
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
  // Index du candidat actuellement affiché parmi result.candidates (navigation aux
  // flèches ‹ › demandée par l'athlète) — initialisé sur le candidat retenu par l'IA
  // (result.winnerIndex) à chaque nouvelle génération, voir handleGenerate.
  const [selectedIndex, setSelectedIndex] = useState(0);

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

  // Clic (ou glisser-déposer du marqueur) sur la carte — voir components/RoutePlannerMap.js.
  // Géocodage inverse pour afficher un nom de lieu lisible plutôt que de simples coordonnées ;
  // si le service de géocodage inverse échoue (best-effort, jamais bloquant), on retombe sur
  // les coordonnées brutes plutôt que d'empêcher l'athlète de continuer.
  const handleMapSetStart = useCallback(async (lat, lon) => {
    setStart({ lat, lon, name: `${lat.toFixed(3)}, ${lon.toFixed(3)}` });
    setQuery('');
    setSuggestions([]);
    try {
      const place = await reverseGeocode(lat, lon);
      if (place?.name) {
        const name = `${place.name}${place.admin1 && place.admin1 !== place.name ? `, ${place.admin1}` : ''}`;
        setStart({ lat, lon, name });
        setQuery(name);
      }
    } catch {
      // Best-effort — les coordonnées brutes déjà affichées restent utilisables.
    }
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
      setSelectedIndex(data.winnerIndex || 0);
    } catch (e) {
      setError(e.message || 'Échec de la génération du parcours.');
    } finally {
      setLoading(false);
    }
  }, [start, distanceKm, avgSpeedKmh, departure, lang, session?.access_token]);

  const candidates = result?.candidates || [];
  const current = candidates[selectedIndex] || null;
  const isWinner = result && selectedIndex === result.winnerIndex;

  // Navigation aux flèches ‹ › entre les candidats retenus (jusqu'à 3, voir
  // pages/api/plan-route.js) — boucle d'un bout à l'autre de la liste.
  const goToCandidate = useCallback((delta) => {
    setSelectedIndex((i) => {
      if (!candidates.length) return i;
      return (i + delta + candidates.length) % candidates.length;
    });
  }, [candidates.length]);

  const downloadGpx = useCallback(() => {
    if (!current?.gpx) return;
    const blob = new Blob([current.gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parcours-${Math.round(current.distanceKm)}km.gpx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [current]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-black uppercase text-ink-50">🚴 Parcours optimisé vent</h2>
      </div>

      {/* --- Carte interactive : clic pour positionner le départ, tracé affiché après génération --- */}
      <div className="rounded-2xl overflow-hidden border border-ink-800" style={{ height: '320px' }}>
        <RoutePlannerMap start={start} onSetStart={handleMapSetStart} routePoints={current?.points} windSamples={current?.wind?.samples} />
      </div>
      <p className="text-[9px] text-ink-500 -mt-2">📍 Touche la carte pour placer le point de départ, ou utilise la recherche ci-dessous.</p>

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
      {result && current && (
        <div className="space-y-3">
          {/* Navigation entre les candidats (flèches ‹ ›) — demande explicite de
              l'athlète : pouvoir changer de parcours parmi ceux générés, chacun avec sa
              propre carte/vent/GPX déjà prêts côté client (pas de ré-appel réseau). */}
          {candidates.length > 1 && (
            <div className="flex items-center justify-between bg-ink-900 border border-ink-800 rounded-2xl px-2 py-1.5">
              <button
                onClick={() => goToCandidate(-1)}
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-ink-800 text-ink-50 text-sm font-bold"
                aria-label="Parcours précédent"
              >
                ‹
              </button>
              <span className="text-[10px] font-bold text-ink-300 uppercase">
                Parcours {selectedIndex + 1}/{candidates.length}{isWinner ? ' · ⭐ recommandé' : ''}
              </span>
              <button
                onClick={() => goToCandidate(1)}
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-ink-800 text-ink-50 text-sm font-bold"
                aria-label="Parcours suivant"
              >
                ›
              </button>
            </div>
          )}

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
              <div className="text-ink-400">Distance <span className="text-ink-50 font-bold">{current.distanceKm}km</span></div>
              <div className="text-ink-400">Dénivelé <span className="text-ink-50 font-bold">{current.ascentM != null ? `+${current.ascentM}m` : '?'}</span></div>
              <div className="text-ink-400">Vent de dos <span className="font-bold" style={{ color: impactColor('tail') }}>{current.wind.distTailKm}km</span></div>
              <div className="text-ink-400">Vent de face <span className="font-bold" style={{ color: impactColor('head') }}>{current.wind.distHeadKm}km</span></div>
              <div className="text-ink-400">Vent de travers <span className="font-bold" style={{ color: impactColor('cross') }}>{current.wind.distCrossKm}km</span></div>
              <div className="text-ink-400">Routes populaires <span className="text-ink-50 font-bold">{Math.round(current.popularityScore * 100)}%</span></div>
            </div>
            {isWinner && result.strategyNote && (
              <p className="text-[11px] text-ink-200 bg-ink-950 rounded-xl p-2 mt-1">💡 {result.strategyNote}</p>
            )}
            {/* result.doubleCheckNote (statut interne du double-check Gemini+Groq, ex. panne
                d'un des deux fournisseurs) n'est volontairement plus affiché ici — demande
                explicite de l'athlète : ces détails techniques n'ont rien à faire dans
                l'app. Toujours calculé côté serveur (voir lib/coGeneration.js:coPickRoute)
                si besoin de le ré-exposer plus tard, par ex. dans le panneau de diagnostic
                IA (Réglages → IA, voir components/AiDiagnosticsModal.js). */}
            {!result.stravaAvailable && (
              <p className="text-[9px] text-ink-500">ℹ️ Compte Strava non lié — popularité basée uniquement sur le réseau cyclable officiel.</p>
            )}
            {result.warnings?.map((w, i) => (
              <p key={i} className="text-[9px] text-amber-400">⚠️ {w}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
