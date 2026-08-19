import React from 'react';
import { shortLabel } from '../lib/workouts';

export { shortLabel };

export function badgeClass(type) {
  switch (shortLabel(type)) {
    case 'SWIM':
      return 'bg-cyan-950 text-cyan-400 border-cyan-800';
    case 'BIKE':
      return 'bg-amber-950 text-amber-400 border-amber-800';
    case 'RUN':
      return 'bg-emerald-950 text-emerald-400 border-emerald-800';
    case 'BRICK':
      return 'bg-purple-950 text-purple-400 border-purple-800';
    default:
      return 'bg-ink-900 text-ink-400 border-ink-800';
  }
}

function SessionPill({ workout, compact, onSelectWorkout, isValidated, hideOwnBadge }) {
  const isRest = workout.type === 'REPOS';
  return (
    <button
      type="button"
      onClick={() => onSelectWorkout?.(workout)}
      className={`w-full text-left rounded-lg p-2 transition-all border ${
        isValidated
          ? 'border-emerald-600/70 bg-emerald-950/30 hover:border-emerald-500 active:scale-[0.98]'
          : isRest
          ? 'border-ink-900/60 opacity-60'
          : 'border-ink-800 hover:border-volt-500/50 active:scale-[0.98]'
      }`}
    >
      <div className="flex justify-between items-center gap-1 mb-1">
        {!hideOwnBadge && (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 uppercase font-mono leading-none ${badgeClass(workout.type)}`}>
            {shortLabel(workout.type)}
          </span>
        )}
        <span className="flex items-center gap-1 shrink-0 ml-auto">
          {isValidated && (
            <span className="text-emerald-400 font-bold text-[10px]" title="Séance validée">✓</span>
          )}
          {workout.modified && (
            <span className="text-volt-400 font-bold text-[9px]" title="Séance modifiée via chat">●</span>
          )}
        </span>
      </div>
      <p className={`text-xs font-bold text-ink-50 leading-snug break-words hyphens-auto ${compact ? 'line-clamp-2' : 'line-clamp-2'}`}>
        {workout.title}
      </p>
      {!isRest && workout.intensity && (
        <p className="text-[10px] text-volt-400 font-mono mt-1 leading-snug break-words">{workout.intensity}</p>
      )}
      {!isRest && workout.structure && !compact && (
        <p className="text-[9px] text-ink-400 mt-1 leading-snug break-words line-clamp-2">{workout.structure}</p>
      )}
      {!isRest && (
        <p className="text-[9px] font-mono text-ink-400 mt-1 truncate">{workout.duration}</p>
      )}
    </button>
  );
}

// Couleur de trait utilisée par le connecteur SVG entre deux séances d'un
// même jour double ("brick") — reprend la teinte "400" de badgeClass pour
// chaque discipline, afin que le dégradé du connecteur matche visuellement
// les couleurs déjà utilisées ailleurs pour SWIM/BIKE/RUN.
function connectorColor(type) {
  switch (shortLabel(type)) {
    case 'SWIM':
      return '#22d3ee'; // cyan-400
    case 'BIKE':
      return '#fbbf24'; // amber-400
    case 'RUN':
      return '#34d399'; // emerald-400
    default:
      return '#a78bfa'; // purple-400 (brick / autre)
  }
}

// Connecteur visuel entre deux séances d'un même jour double : un trait SVG
// vertical en dégradé discipline A → discipline B, avec un badge "Double"
// unique au-dessus plutôt que deux badges de discipline qui se percutent.
function BrickConnector({ sessions }) {
  const gradId = `brick-grad-${sessions.map((s) => s.id).join('-')}`;
  const colorA = connectorColor(sessions[0].type);
  const colorB = connectorColor(sessions[sessions.length - 1].type);
  return (
    <div className="flex flex-col items-center shrink-0">
      <span className="text-[8px] font-black uppercase tracking-wide text-ink-300 bg-ink-900 border border-ink-700 px-1.5 py-0.5 rounded-full mb-0.5 whitespace-nowrap">
        Double
      </span>
      <svg width="10" height="16" viewBox="0 0 10 16" className="shrink-0">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colorA} />
            <stop offset="100%" stopColor={colorB} />
          </linearGradient>
        </defs>
        <line x1="5" y1="0" x2="5" y2="16" stroke={`url(#${gradId})`} strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export default function CalendarView({
  weekKey = 'N',
  workouts = [],
  daysOfWeek = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'],
  onSelectWorkout,
  validatedIds = new Set(),
  sportFilter = 'ALL',
}) {
  const workoutList = Array.isArray(workouts) ? workouts : (workouts?.[weekKey] || []);

  // Le filtrage par sport se fait ICI (au niveau de l'affichage jour par jour),
  // et non plus en amont sur la liste brute : sinon, un jour dont la séance ne
  // correspond pas au sport choisi se retrouve avec 0 séance et s'affiche comme
  // "Repos", ce qui laisse croire à tort que c'est un vrai jour de repos.
  const matchesFilter = (w) => sportFilter === 'ALL' || shortLabel(w.type) === sportFilter || w.type === 'REPOS';

  // Le compteur affiché doit correspondre aux séances d'entraînement réelles
  // du sport sélectionné, pas au nombre total d'entrées (qui inclut les jours
  // de repos et les autres disciplines).
  const realSessionCount = workoutList.filter((w) => w.type !== 'REPOS' && matchesFilter(w)).length;

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3 sm:p-4 space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-xs font-black uppercase tracking-wide text-ink-300">
          Semaine{' '}
          <span className="text-volt-400">{weekKey === 'N' ? 'En cours (N)' : 'Suivante (N+1)'}</span>
        </h3>
        <span className="text-[10px] font-mono font-bold bg-ink-950 px-2.5 py-1 rounded-full border border-ink-800 text-ink-400">
          {realSessionCount} séances
        </span>
      </div>

      {/* Toujours en scroll horizontal : le conteneur app reste étroit (max-w-md)
          sur tous les écrans, une grille fixe à 7 colonnes y écraserait le texte.
          key={sportFilter} force React à remonter la grille à chaque changement
          de filtre, ce qui rejoue l'animation .animate-triSweep depuis le début. */}
      <div key={sportFilter} className="grid grid-flow-col auto-cols-[minmax(148px,1fr)] gap-2.5 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-none animate-triSweep rounded-lg">
        {daysOfWeek.map((dayName) => {
          const allDaySessions = workoutList.filter((w) => w.day?.toLowerCase() === dayName.toLowerCase());
          const sessions = allDaySessions.filter(matchesFilter);
          const hasSessions = sessions.length > 0 && !(sessions.length === 1 && sessions[0].type === 'REPOS');
          // Ce jour n'est pas un vrai jour de repos : il a une séance, mais d'une
          // autre discipline que celle actuellement filtrée.
          const hasOtherSportOnly = !hasSessions && allDaySessions.some((w) => w.type !== 'REPOS' && !matchesFilter(w));
          // Jour double ("brick") : au moins deux vraies séances (hors repos) le même jour.
          const trainingSessions = sessions.filter((w) => w.type !== 'REPOS');
          const isBrickDay = trainingSessions.length > 1;

          return (
            <div
              key={dayName}
              className={`snap-start bg-ink-950 border rounded-xl p-2.5 flex flex-col gap-1.5 min-h-[172px] overflow-hidden ${
                hasSessions ? 'border-ink-800' : 'border-ink-900/60 opacity-50'
              }`}
            >
              <span className="text-[10px] font-bold uppercase text-ink-500 shrink-0">{dayName.slice(0, 3)}</span>

              {hasSessions ? (
                isBrickDay ? (
                  <div className="flex flex-col gap-0">
                    {trainingSessions.map((w, idx) => (
                      <React.Fragment key={w.id}>
                        <SessionPill workout={w} compact onSelectWorkout={onSelectWorkout} isValidated={validatedIds.has(w.id)} />
                        {idx < trainingSessions.length - 1 && <BrickConnector sessions={trainingSessions} />}
                      </React.Fragment>
                    ))}
                  </div>
                ) : (
                  sessions.map((w) => (
                    <SessionPill key={w.id} workout={w} compact={sessions.length > 1} onSelectWorkout={onSelectWorkout} isValidated={validatedIds.has(w.id)} />
                  ))
                )
              ) : hasOtherSportOnly ? (
                <p className="text-[11px] italic text-ink-600 mt-1">Autre séance</p>
              ) : (
                <p className="text-[11px] flex items-center gap-1 text-emerald-500/70 mt-1">
                  <span aria-hidden="true">☾</span> Repos
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-ink-500 text-center">
        ← Glisse latéralement pour voir toute la semaine →
      </p>
    </div>
  );
}
