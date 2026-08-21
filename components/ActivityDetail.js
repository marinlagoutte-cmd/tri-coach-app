import React, { useEffect, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler } from 'chart.js';
import { supabase } from '../lib/supabase';
import { stravaSportToDiscipline } from '../lib/stravaClient';
import { shortLabel } from '../lib/workouts';
import { formatKm, formatDurationFromSeconds, formatPaceFromSpeedMs } from '../lib/stravaMatch';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILES_ATTRIBUTION = '&copy; <a href="https://carto.com/attributions">CARTO</a>';

// Décodage d'un polyline encodé Google (format utilisé par Strava pour
// `map.summary_polyline`) — algorithme standard, voir
// https://developers.google.com/maps/documentation/utilities/polylinealgorithm
function decodePolyline(encoded) {
  if (!encoded) return [];
  let index = 0, lat = 0, lng = 0;
  const points = [];
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

function ActivityMap({ polyline }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const points = decodePolyline(polyline);
    if (!points.length) return undefined;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapElRef.current || mapRef.current) return;
      const map = L.map(mapElRef.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
      L.tileLayer(DARK_TILES, { attribution: TILES_ATTRIBUTION, maxZoom: 19, subdomains: 'abcd' }).addTo(map);
      L.polyline(points, { color: '#FC4C02', weight: 4, opacity: 0.9 }).addTo(map);
      L.circleMarker(points[0], { radius: 6, color: '#34D399', fillColor: '#34D399', fillOpacity: 1 }).addTo(map);
      L.circleMarker(points[points.length - 1], { radius: 6, color: '#FF4D80', fillColor: '#FF4D80', fillOpacity: 1 }).addTo(map);
      map.fitBounds(L.latLngBounds(points), { padding: [16, 16] });
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [polyline]);

  if (!polyline) return null;
  return <div ref={mapElRef} className="w-full h-48 rounded-xl overflow-hidden border border-ink-800" />;
}

// Un seul graphique réutilisé pour allure/FC/puissance/altitude : n'affiche que
// les courbes dont le stream Strava est réellement présent (une activité vélo
// sans capteur de puissance n'a simplement pas de stream "watts").
function StreamChart({ label, color, timeStream, dataStream, unit, invertY }) {
  if (!timeStream?.length || !dataStream?.length) return null;
  // Sous-échantillonnage léger : au-delà de ~200 points le rendu Chart.js devient
  // lourd sur mobile pour un gain de lisibilité nul.
  const step = Math.max(1, Math.floor(timeStream.length / 200));
  const labels = [];
  const values = [];
  for (let i = 0; i < timeStream.length; i += step) {
    labels.push(Math.round(timeStream[i] / 60)); // minutes
    values.push(dataStream[i]);
  }
  return (
    <div className="bg-ink-950 border border-ink-800 rounded-xl p-2.5">
      <span className="text-[9px] text-ink-500 uppercase font-bold block mb-1">{label}</span>
      <div className="h-24">
        <Line
          data={{ labels, datasets: [{ data: values, borderColor: color, backgroundColor: `${color}22`, fill: true, pointRadius: 0, borderWidth: 1.5, tension: 0.25 }] }}
          options={{
            responsive: true, maintainAspectRatio: false,
            scales: {
              x: { ticks: { color: '#6b7280', font: { size: 8 }, maxTicksLimit: 6 }, grid: { display: false } },
              y: { reverse: invertY, ticks: { color: '#6b7280', font: { size: 8 } }, grid: { color: '#1f2937' } },
            },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y}${unit}` } } },
          }}
        />
      </div>
    </div>
  );
}

export default function ActivityDetail({ activity, session, workouts, onClose, onActivityUpdated }) {
  const [streams, setStreams] = useState(null);
  const [streamsLoading, setStreamsLoading] = useState(false);
  const [streamsError, setStreamsError] = useState('');
  const [matchSaving, setMatchSaving] = useState(false);
  // Sélection EN COURS dans le <select>, distincte de l'association déjà confirmée
  // (activity.matched_workout_id + match_confirmed) — tant que "Confirmer" n'a pas
  // été cliqué, rien n'est écrit en base et le calendrier ne fusionne pas les deux
  // pastilles. Initialisé sur l'association déjà connue (auto-suggérée ou déjà
  // confirmée précédemment) pour ne pas perdre la pré-sélection à l'ouverture.
  const [pendingWorkoutId, setPendingWorkoutId] = useState(activity?.matched_workout_id || '');

  useEffect(() => {
    setPendingWorkoutId(activity?.matched_workout_id || '');
  }, [activity?.id, activity?.matched_workout_id]);

  useEffect(() => {
    if (!activity) return;
    setStreams(null);
    setStreamsError('');
    if (activity.streams) { setStreams(activity.streams); return; }
    if (!session?.access_token) return;
    setStreamsLoading(true);
    fetch('/api/strava/streams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: session.access_token, activityId: activity.id }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setStreamsError(data.error); return; }
        setStreams(data.streams);
      })
      .catch(() => setStreamsError('Impossible de charger le détail de cette activité.'))
      .finally(() => setStreamsLoading(false));
  }, [activity, session?.access_token]);

  if (!activity) return null;

  const discipline = stravaSportToDiscipline(activity.sport_type);
  const weekWorkouts = (workouts?.N || []).filter((w) => w.type !== 'REPOS');
  const matchedWorkout = weekWorkouts.find((w) => w.id === activity.matched_workout_id);

  // "Confirmer" n'est utile/actif que si la sélection a changé depuis la dernière
  // association CONFIRMÉE — reconfirmer une sélection identique et déjà validée
  // n'a pas de sens, et resélectionner la même auto-suggestion doit quand même
  // pouvoir être confirmée (d'où la comparaison à match_confirmed, pas seulement
  // à matched_workout_id).
  const hasPendingChange = pendingWorkoutId !== (activity.matched_workout_id || '')
    || (pendingWorkoutId && !activity.match_confirmed);

  const persistMatch = async (workoutId, confirmed) => {
    if (!supabase) return;
    setMatchSaving(true);
    try {
      const patch = workoutId
        ? { matched_week_key: 'N', matched_workout_id: workoutId, match_source: 'manual', match_confirmed: confirmed }
        : { matched_week_key: null, matched_workout_id: null, match_source: 'none', match_confirmed: false };
      const { error } = await supabase.from('strava_activities').update(patch).eq('id', activity.id);
      if (!error) onActivityUpdated?.({ ...activity, ...patch });
    } finally {
      setMatchSaving(false);
    }
  };

  // Changer la sélection dans le <select> ne sauvegarde plus rien immédiatement :
  // ça met seulement à jour `pendingWorkoutId`. Exception : repasser sur "Aucune
  // séance prévue associée" dissocie tout de suite (rien à confirmer pour un retrait,
  // et ça évite de laisser une fusion précédente affichée dans le calendrier pendant
  // qu'on hésite sur la nouvelle association).
  const handleSelectChange = (workoutId) => {
    setPendingWorkoutId(workoutId);
    if (!workoutId) persistMatch(null, false);
  };

  const handleConfirm = () => {
    if (!pendingWorkoutId) return;
    persistMatch(pendingWorkoutId, true);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-end sm:items-center justify-center animate-sheetBackdrop" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-ink-900 border border-ink-800 sm:border w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-4 shadow-2xl text-ink-100 max-h-[92vh] overflow-y-auto animate-slideUp sm:animate-none"
      >
        <div className="sm:hidden -mt-1.5 mb-1 flex justify-center">
          <span className="w-9 h-1 rounded-full bg-ink-700" />
        </div>

        <div className="flex justify-between items-start border-b border-ink-800 pb-3">
          <div>
            <span
              className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-md border"
              style={{ color: '#FC4C02', borderColor: 'rgba(252,76,2,0.3)', backgroundColor: 'rgba(252,76,2,0.08)' }}
            >
              Strava · {shortLabel(discipline || '')}
            </span>
            <p className="text-xs font-bold text-ink-50 mt-1.5">{activity.name}</p>
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-50 font-bold p-1 min-h-tap min-w-[44px]">✕</button>
        </div>

        <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
          <div className="bg-ink-950 border border-ink-800 p-2.5 rounded-xl">
            <span className="text-[9px] text-ink-500 uppercase block">Distance</span>
            <span className="font-bold text-volt-400">{formatKm(activity.distance_m)}</span>
          </div>
          <div className="bg-ink-950 border border-ink-800 p-2.5 rounded-xl">
            <span className="text-[9px] text-ink-500 uppercase block">Durée</span>
            <span className="font-bold text-volt-400">{formatDurationFromSeconds(activity.moving_time_s)}</span>
          </div>
          <div className="bg-ink-950 border border-ink-800 p-2.5 rounded-xl">
            <span className="text-[9px] text-ink-500 uppercase block">Allure moy.</span>
            <span className="font-bold text-volt-400">{formatPaceFromSpeedMs(activity.average_speed_ms)}</span>
          </div>
          {activity.average_heartrate && (
            <div className="bg-ink-950 border border-ink-800 p-2.5 rounded-xl">
              <span className="text-[9px] text-ink-500 uppercase block">FC moy./max</span>
              <span className="font-bold text-volt-400">{Math.round(activity.average_heartrate)} / {Math.round(activity.max_heartrate || 0)} bpm</span>
            </div>
          )}
          {activity.average_watts && (
            <div className="bg-ink-950 border border-ink-800 p-2.5 rounded-xl">
              <span className="text-[9px] text-ink-500 uppercase block">Puissance moy./max</span>
              <span className="font-bold text-volt-400">{Math.round(activity.average_watts)} / {Math.round(activity.max_watts || 0)} W</span>
            </div>
          )}
          {activity.total_elevation_m > 0 && (
            <div className="bg-ink-950 border border-ink-800 p-2.5 rounded-xl">
              <span className="text-[9px] text-ink-500 uppercase block">D+</span>
              <span className="font-bold text-volt-400">{Math.round(activity.total_elevation_m)} m</span>
            </div>
          )}
        </div>

        {activity.summary_polyline && <ActivityMap polyline={activity.summary_polyline} />}

        {streamsLoading && <p className="text-[10px] text-ink-500 text-center">Chargement du détail…</p>}
        {streamsError && <p className="text-[10px] text-rose-400 text-center">{streamsError}</p>}
        {streams && (
          <div className="space-y-2">
            <StreamChart label="Allure (min/km)" color="#22d3ee" timeStream={streams.time?.data} dataStream={streams.velocity_smooth?.data?.map((v) => (v ? 1000 / v / 60 : null))} unit=" /km" invertY />
            <StreamChart label="Fréquence cardiaque" color="#fb7185" timeStream={streams.time?.data} dataStream={streams.heartrate?.data} unit=" bpm" />
            <StreamChart label="Puissance" color="#fbbf24" timeStream={streams.time?.data} dataStream={streams.watts?.data} unit=" W" />
            <StreamChart label="Altitude" color="#34d399" timeStream={streams.time?.data} dataStream={streams.altitude?.data} unit=" m" />
          </div>
        )}

        {/* Correspondance avec le plan — auto-suggérée par défaut, corrigeable ici (voir
            lib/stravaMatch.js pour l'hypothèse "Semaine N = semaine réelle en cours" qui
            explique pourquoi le matching auto peut parfois se tromper). Sélectionner ne
            sauvegarde plus rien tout seul : il faut cliquer "Confirmer" pour que la séance
            prévue et l'activité réalisée fusionnent en une seule pastille dans le calendrier
            (voir CalendarView.js) — tant que ce n'est pas confirmé, les deux restent
            affichées séparément. */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-mono text-ink-500 uppercase tracking-widest block">Séance associée</span>
          <select
            value={pendingWorkoutId}
            onChange={(e) => handleSelectChange(e.target.value)}
            disabled={matchSaving}
            className="w-full bg-ink-950 border border-ink-800 rounded-xl p-2.5 text-xs text-ink-50"
          >
            <option value="">— Aucune séance prévue associée —</option>
            {weekWorkouts.map((w) => (
              <option key={w.id} value={w.id}>{w.day} · {shortLabel(w.type)} · {w.title}</option>
            ))}
          </select>

          {activity.match_source === 'auto' && matchedWorkout && !activity.match_confirmed && (
            <p className="text-[9px] text-ink-600">Association automatique proposée (jour + discipline) — vérifie puis confirme, ou change-la ci-dessus.</p>
          )}

          {hasPendingChange ? (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={matchSaving || !pendingWorkoutId}
              className="w-full bg-volt-500 hover:bg-volt-400 disabled:opacity-50 text-ink-50 font-bold text-xs uppercase py-2.5 rounded-xl min-h-tap"
            >
              {matchSaving ? 'Confirmation…' : '✓ Confirmer cette association'}
            </button>
          ) : activity.match_confirmed && pendingWorkoutId ? (
            <p className="text-[10px] text-emerald-400 font-bold">✓ Association confirmée — séances fusionnées dans le calendrier.</p>
          ) : null}
        </div>

        {/* Analyse IA — générée automatiquement à la réception de l'activité
            (voir pages/api/strava/webhook.js), jamais recalculée ici. */}
        <div className="bg-volt-500/5 border border-volt-500/20 p-3 rounded-xl">
          <span className="text-[9px] text-volt-400 uppercase font-bold block mb-1.5">🤖 Analyse du coach</span>
          {activity.ai_analysis_status === 'ok' && activity.ai_analysis ? (
            <p className="text-xs text-ink-200 leading-relaxed whitespace-pre-line">{activity.ai_analysis}</p>
          ) : activity.ai_analysis_status === 'error' ? (
            <p className="text-[11px] text-ink-500">L'analyse IA n'a pas pu être générée pour cette activité (service temporairement indisponible).</p>
          ) : activity.ai_analysis_status === 'skipped' ? (
            <p className="text-[11px] text-ink-500">Pas d'analyse IA pour cette activité (importée en masse depuis Réglages — l'analyse prévu/réalisé n'est générée automatiquement que pour les nouvelles activités).</p>
          ) : (
            <p className="text-[11px] text-ink-500">Analyse en cours de génération…</p>
          )}
        </div>

        <div className="flex justify-end pt-2 border-t border-ink-800 text-xs">
          <button onClick={onClose} className="bg-ink-800 hover:bg-ink-700 text-ink-50 font-bold px-4 py-2 rounded-xl text-xs uppercase min-h-tap">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
