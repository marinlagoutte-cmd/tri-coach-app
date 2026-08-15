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
      return 'bg-slate-900 text-slate-400 border-slate-800';
  }
}

function SessionPill({ workout, compact, onSelectWorkout }) {
  const isRest = workout.type === 'REPOS';
  return (
    <button
      type="button"
      onClick={() => onSelectWorkout?.(workout)}
      className={`w-full text-left rounded-lg p-2 transition-all border ${
        isRest
          ? 'border-slate-900/60 opacity-60'
          : 'border-slate-800 hover:border-orange-500/50 active:scale-[0.98]'
      }`}
    >
      <div className="flex justify-between items-center gap-1 mb-1">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 uppercase font-mono leading-none ${badgeClass(workout.type)}`}>
          {shortLabel(workout.type)}
        </span>
        {workout.modified && (
          <span className="text-orange-400 font-bold text-[9px] shrink-0" title="Séance modifiée via chat">●</span>
        )}
      </div>
      <p className={`text-xs font-bold text-white leading-snug break-words hyphens-auto ${compact ? 'line-clamp-2' : 'line-clamp-3'}`}>
        {workout.title}
      </p>
      {!isRest && workout.intensity && !compact && (
        <p className="text-[10px] text-orange-400 font-mono mt-1 leading-snug break-words">{workout.intensity}</p>
      )}
      {!isRest && (
        <p className="text-[9px] font-mono text-slate-400 mt-1 truncate">{workout.duration}</p>
      )}
    </button>
  );
}

export default function CalendarView({
  weekKey = 'N',
  workouts = [],
  daysOfWeek = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'],
  onSelectWorkout,
}) {
  const workoutList = Array.isArray(workouts) ? workouts : (workouts?.[weekKey] || []);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-xs font-black uppercase tracking-wide text-slate-300">
          Semaine{' '}
          <span className="text-orange-400">{weekKey === 'N' ? 'En cours (N)' : 'Suivante (N+1)'}</span>
        </h3>
        <span className="text-[10px] font-mono font-bold bg-slate-950 px-2.5 py-1 rounded-full border border-slate-800 text-slate-400">
          {workoutList.length} séances
        </span>
      </div>

      {/* Toujours en scroll horizontal : le conteneur app reste étroit (max-w-md)
          sur tous les écrans, une grille fixe à 7 colonnes y écraserait le texte. */}
      <div className="grid grid-flow-col auto-cols-[minmax(148px,1fr)] gap-2.5 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-none">
        {daysOfWeek.map((dayName) => {
          const sessions = workoutList.filter((w) => w.day?.toLowerCase() === dayName.toLowerCase());
          const hasSessions = sessions.length > 0 && !(sessions.length === 1 && sessions[0].type === 'REPOS');

          return (
            <div
              key={dayName}
              className={`snap-start bg-slate-950 border rounded-xl p-2.5 flex flex-col gap-1.5 min-h-[150px] overflow-hidden ${
                hasSessions ? 'border-slate-800' : 'border-slate-900/60 opacity-50'
              }`}
            >
              <span className="text-[10px] font-bold uppercase text-slate-500 shrink-0">{dayName.slice(0, 3)}</span>

              {hasSessions ? (
                sessions.map((w) => (
                  <SessionPill key={w.id} workout={w} compact={sessions.length > 1} onSelectWorkout={onSelectWorkout} />
                ))
              ) : (
                <p className="text-[11px] italic text-slate-600 mt-1">Repos</p>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-500 text-center">
        ← Glisse latéralement pour voir toute la semaine →
      </p>
    </div>
  );
}
