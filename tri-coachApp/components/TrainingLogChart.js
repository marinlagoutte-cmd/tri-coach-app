// components/TrainingLogChart.js
//
// Remplace le bloc "Volume prévu / Volume réalisé" (2 barres côte à côte) de
// PerformanceDashboard.js par un graphe à bulles façon "Training Log" Strava : une
// bulle par activité réellement synchronisée, semaine par semaine (Lundi→Dimanche),
// couleur = sport, taille = métrique choisie (Distance / Temps / Intensité). Voir
// lib/analytics.js:computeTrainingLogWeeks pour l'agrégation des données (aucune
// activité inventée, uniquement `stravaActivities` réellement synchronisées).
import { useMemo, useState } from 'react';
import { computeTrainingLogWeeks } from '../lib/analytics';

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const WEEKS_PER_PAGE = 6;

const METRIC_OPTIONS = [
  { key: 'distanceKm', label: 'Distance', unit: 'km', format: (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) },
  { key: 'durationMin', label: 'Temps', unit: 'min', format: (v) => Math.round(v) },
  { key: 'intensityPoints', label: 'Intensité', unit: 'pts', format: (v) => Math.round(v) },
];

const MIN_RADIUS = 4;
const MAX_RADIUS = 15;
const EMPTY_RADIUS = 3; // bulle "témoin" pour une activité sans valeur sur la métrique choisie (ex: renfo en Distance)

function radiusFor(value, maxValue) {
  if (!Number.isFinite(value) || value <= 0) return EMPTY_RADIUS;
  if (!Number.isFinite(maxValue) || maxValue <= 0) return MIN_RADIUS;
  // Aire proportionnelle à la valeur (rayon en racine carrée), comme le Training Log Strava —
  // sinon une activité 2x plus longue paraîtrait 4x plus grosse à l'œil.
  const ratio = Math.sqrt(value / maxValue);
  return Math.round(MIN_RADIUS + ratio * (MAX_RADIUS - MIN_RADIUS));
}

export default function TrainingLogChart({ activities = [], profile }) {
  const [metricKey, setMetricKey] = useState('distanceKm');
  const [sportFilter, setSportFilter] = useState(null); // null = tous les sports
  const [weeksOffset, setWeeksOffset] = useState(0);
  const [weeksCount, setWeeksCount] = useState(WEEKS_PER_PAGE);

  const metric = METRIC_OPTIONS.find((m) => m.key === metricKey);

  const { weeks, sportsPresent } = useMemo(
    () => computeTrainingLogWeeks(activities, { weeksCount, weeksOffset, profile }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activities, weeksCount, weeksOffset, profile?.fcMax]
  );

  const visibleWeeks = useMemo(() => {
    if (!sportFilter) return weeks;
    return weeks.map((w) => ({
      ...w,
      days: w.days.map((day) => day.filter((a) => a.sportGroup.key === sportFilter)),
    }));
  }, [weeks, sportFilter]);

  // Échelle commune à toute la fenêtre affichée (pas juste la semaine visible à l'écran) —
  // pour que la taille d'une bulle reste comparable d'une semaine à l'autre.
  const maxValue = useMemo(() => {
    let max = 0;
    visibleWeeks.forEach((w) => w.days.flat().forEach((a) => {
      const v = a[metricKey];
      if (Number.isFinite(v) && v > max) max = v;
    }));
    return max;
  }, [visibleWeeks, metricKey]);

  const hasAnyActivity = visibleWeeks.some((w) => w.days.some((d) => d.length > 0));

  return (
    <div className="bg-ink-950 border border-ink-800 rounded-xl p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-0.5">
        <p className="text-xs font-bold text-ink-50">Journal d'entraînement</p>
      </div>
      <p className="text-[10px] text-ink-500 mb-3">
        Une bulle par activité Strava synchronisée · taille = {metric.label.toLowerCase()}
      </p>

      {/* Toggle métrique (taille des bulles) */}
      <div className="flex justify-center gap-1.5 mb-2.5">
        {METRIC_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setMetricKey(opt.key)}
            className={`text-[10px] font-bold px-3 py-1 rounded-full border ${
              metricKey === opt.key
                ? 'bg-ink-50 text-ink-950 border-ink-50'
                : 'text-ink-400 border-ink-700 bg-ink-900 hover:bg-ink-800'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Légende / filtre par sport — cliquable, comme la légende du Training Log Strava */}
      {sportsPresent.length > 0 && (
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mb-3">
          <button
            onClick={() => setSportFilter(null)}
            className={`flex items-center gap-1 text-[10px] font-bold ${sportFilter === null ? 'text-ink-100' : 'text-ink-500'}`}
          >
            <span className="w-2 h-2 rounded-full bg-ink-400" />
            Tout
          </button>
          {sportsPresent.map((sg) => (
            <button
              key={sg.key}
              onClick={() => setSportFilter((prev) => (prev === sg.key ? null : sg.key))}
              className={`flex items-center gap-1 text-[10px] font-bold ${sportFilter === sg.key || sportFilter === null ? '' : 'opacity-40'}`}
              style={{ color: sportFilter === sg.key || sportFilter === null ? '#E5E7EB' : undefined }}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: sg.color }} />
              {sg.label}
            </button>
          ))}
        </div>
      )}

      {!hasAnyActivity ? (
        <p className="text-xs text-ink-500 text-center py-8">
          {activities?.length > 0
            ? "Aucune activité de ce type sur la période affichée."
            : "Connecte Strava (Réglages) pour voir ton journal d'entraînement ici."}
        </p>
      ) : (
        <>
          {/* En-tête jours de la semaine */}
          <div className="grid pl-16" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
            {DAY_LABELS.map((d) => (
              <span key={d} className="text-[9px] text-ink-500 text-center font-bold uppercase">{d}</span>
            ))}
          </div>

          <div className="space-y-1 mt-1">
            {visibleWeeks.map((week) => (
              <div key={week.key} className="flex items-stretch gap-1">
                <div className="w-16 shrink-0 flex flex-col justify-center py-1.5">
                  <span className={`text-[10px] font-bold leading-tight ${week.isCurrent ? 'text-volt-400' : 'text-ink-200'}`}>
                    {week.isCurrent ? 'Cette sem.' : week.label}
                  </span>
                  <span className="text-[9px] text-ink-600 leading-tight">{week.totalDistanceKm} km</span>
                </div>
                <div className="grid flex-1 rounded-lg bg-ink-900/60" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
                  {week.days.map((dayActs, dayIdx) => (
                    <div key={dayIdx} className="flex flex-wrap items-center justify-center gap-1 py-1.5 px-0.5 min-h-[2.5rem]">
                      {dayActs.map((a) => {
                        const value = a[metricKey];
                        const r = radiusFor(value, maxValue);
                        const showLabel = r >= 11 && Number.isFinite(value) && value > 0;
                        return (
                          <div
                            key={a.id}
                            title={`${a.name} · ${metric.format(a.distanceKm)} km · ${metric.format(a.durationMin)} min`}
                            className="rounded-full flex items-center justify-center shrink-0 font-bold text-ink-950"
                            style={{
                              width: r * 2,
                              height: r * 2,
                              backgroundColor: a.sportGroup.color,
                              fontSize: r >= 13 ? 8 : 6,
                            }}
                          >
                            {showLabel ? `${metric.format(value)}` : ''}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-center gap-2 mt-3">
            <button
              onClick={() => setWeeksOffset((prev) => prev + weeksCount)}
              className="text-[10px] font-bold px-3 py-1.5 rounded-full border text-ink-400 border-ink-700 bg-ink-900 hover:bg-ink-800"
            >
              Semaines précédentes
            </button>
            {weeksOffset > 0 && (
              <button
                onClick={() => { setWeeksOffset(0); setWeeksCount(WEEKS_PER_PAGE); }}
                className="text-[10px] font-bold px-3 py-1.5 rounded-full border text-ink-400 border-ink-700 bg-ink-900 hover:bg-ink-800"
              >
                Revenir à aujourd'hui
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
