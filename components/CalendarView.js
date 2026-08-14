import React from 'react';

export function badgeClass(type) {
  switch (type?.toUpperCase()) {
    case 'NATATION':
    case 'SWIM':
      return 'bg-cyan-950 text-cyan-400 border-cyan-800';
    case 'CYCLISME':
    case 'VELO':
    case 'BIKE':
      return 'bg-amber-950 text-amber-400 border-amber-800';
    case 'C.A.P':
    case 'RUN':
      return 'bg-emerald-950 text-emerald-400 border-emerald-800';
    case 'ENCHAÎNEMENT':
    case 'BRICK':
      return 'bg-purple-950 text-purple-400 border-purple-800';
    default:
      return 'bg-slate-900 text-slate-400 border-slate-800';
  }
}

export function shortLabel(type) {
  switch (type?.toUpperCase()) {
    case 'NATATION':
    case 'SWIM':
      return 'SWIM';
    case 'CYCLISME':
    case 'VELO':
    case 'BIKE':
      return 'BIKE';
    case 'C.A.P':
    case 'RUN':
      return 'RUN';
    case 'ENCHAÎNEMENT':
    case 'BRICK':
      return 'BRICK';
    case 'REPOS':
      return 'REPOS';
    default:
      return type?.slice(0, 5) || '-';
  }
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

      <div className="grid grid-flow-col auto-cols-[minmax(150px,1fr)] sm:grid-flow-row sm:grid-cols-7 gap-2.5 overflow-x-auto pb-2 snap-x snap-mandatory sm:overflow-visible scrollbar-none">
        {daysOfWeek.map((dayName) => {
          const workout = workoutList.find((w) => w.day?.toLowerCase() === dayName.toLowerCase());
          const isRest = !workout || workout.type === 'REPOS';

          return (
            <button
              key={dayName}
              type="button"
              disabled={!workout}
              onClick={() => workout && onSelectWorkout?.(workout)}
              className={`snap-start text-left bg-slate-950 border rounded-xl p-3 flex flex-col justify-between min-h-[165px] transition-all ${
                workout
                  ? 'border-slate-800 hover:border-orange-500/50 active:scale-[0.98] cursor-pointer'
                  : 'border-slate-900/60 opacity-50 cursor-default'
              }`}
            >
              <div>
                <div className="flex justify-between items-start gap-1 mb-2">
                  <span className="text-[10px] font-bold uppercase text-slate-500">{dayName.slice(0, 3)}</span>
                  {workout && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 uppercase font-mono ${badgeClass(workout.type)}`}>
                      {shortLabel(workout.type)}
                    </span>
                  )}
                </div>

                {workout ? (
                  <div>
                    <p className="text-xs font-bold text-white leading-snug line-clamp-3">{workout.title}</p>
                    {!isRest && workout.intensity && (
                      <p className="text-[10px] text-orange-400 font-mono mt-1.5 leading-snug">{workout.intensity}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] italic text-slate-600 mt-2">Repos</p>
                )}
              </div>

              {workout && (
                <div className="mt-2 pt-1.5 border-t border-slate-900 flex justify-between items-center text-[9px] font-mono text-slate-400">
                  <span>{workout.duration}</span>
                  {workout.modified && (
                    <span className="text-orange-400 font-bold" title="Séance modifiée via chat">
                      ● mod
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-500 text-center sm:hidden">
        ← Glisse latéralement pour voir toute la semaine →
      </p>
    </div>
  );
}          <span className="text-orange-400">{weekKey === 'N' ? 'En cours (N)' : 'Suivante (N+1)'}</span>
        </h3>
        <span className="text-[10px] font-mono font-bold bg-slate-950 px-2.5 py-1 rounded-full border border-slate-800 text-slate-400">
          {workoutList.length} séances
        </span>
      </div>

      <div className="grid grid-flow-col auto-cols-[minmax(125px,1fr)] sm:grid-flow-row sm:grid-cols-7 gap-2 overflow-x-auto pb-2 snap-x snap-mandatory sm:overflow-visible scrollbar-none">
        {daysOfWeek.map((dayName) => {
          const workout = workoutList.find((w) => w.day?.toLowerCase() === dayName.toLowerCase());
          const isRest = !workout || workout.type === 'REPOS';

          return (
            <button
              key={dayName}
              type="button"
              disabled={!workout}
              onClick={() => workout && onSelectWorkout?.(workout)}
              className={`snap-start text-left bg-slate-950 border rounded-xl p-2.5 flex flex-col justify-between min-h-[130px] transition-all ${
                workout
                  ? 'border-slate-800 hover:border-orange-500/50 active:scale-[0.98] cursor-pointer'
                  : 'border-slate-900/60 opacity-50 cursor-default'
              }`}
            >
              <div>
                <div className="flex justify-between items-start gap-1 mb-1.5">
                  <span className="text-[10px] font-bold uppercase text-slate-500">{dayName.slice(0, 3)}</span>
                  {workout && (
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border shrink-0 uppercase font-mono ${badgeClass(workout.type)}`}>
                      {workout.type === 'C.A.P' ? 'CAP' : workout.type?.slice(0, 4)}
                    </span>
                  )}
                </div>

                {workout ? (
                  <div>
                    <p className="text-[11px] font-bold text-white line-clamp-2 leading-tight">{workout.title}</p>
                    {!isRest && workout.intensity && (
                      <p className="text-[10px] text-orange-400 font-mono mt-1 truncate">{workout.intensity}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] italic text-slate-600 mt-2">Repos</p>
                )}
              </div>

              {workout && (
                <div className="mt-2 pt-1.5 border-t border-slate-900 flex justify-between items-center text-[9px] font-mono text-slate-400">
                  <span>{workout.duration}</span>
                  {workout.modified && (
                    <span className="text-orange-400 font-bold" title="Séance modifiée via chat">
                      ● mod
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-slate-500 text-center sm:hidden">
        ← Glisse latéralement pour voir toute la semaine →
      </p>
    </div>
  );
}
