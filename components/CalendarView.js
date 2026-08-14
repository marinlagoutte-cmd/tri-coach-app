import React from 'react';
const BADGE = {
  NATATION: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  CYCLISME: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'C.A.P': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  ENCHAÎNEMENT: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  REPOS: 'bg-slate-700/50 text-slate-400 border-slate-600',
};
export default function CalendarView({ workouts }) {
function badgeClass(type) {
  const key = Object.keys(BADGE).find((k) => (type || '').toUpperCase().includes(k.replace('.', '')));
  return BADGE[key] || BADGE[(type || '').toUpperCase()] || 'bg-slate-800 text-slate-300 border-slate-700';
}
export default function CalendarView({ weekKey, workouts = [], onSelectWorkout }) {
  const daysOfWeek = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  const getTypeBadgeColor = (type) => {
    switch (type) {
      case 'NATATION': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'CYCLISME': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'C.A.P': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'ENCHAÎNEMENT': return 'bg-purple-100 text-purple-700 border-purple-200';
      default: return 'bg-gray-100 text-gray-600 border-gray-200';
    }
  };
  return (
    <div className="space-y-6">
      {['N', 'N+1'].map((weekKey) => (
        <div key={weekKey} className="bg-white border border-ria-border rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex justify-between items-center border-b border-ria-border pb-3">
            <h3 className="text-sm font-black uppercase tracking-wide">
              Semaine <span className="text-ria-neon">{weekKey === 'N' ? 'En cours (N)' : 'Suivante (N+1)'}</span>
            </h3>
            <span className="text-xs font-mono font-bold bg-ria-bg px-3 py-1 rounded-full border border-ria-border">
              {workouts?.[weekKey]?.length || 0} séances
            </span>
          </div>
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-xs font-black uppercase tracking-wide text-slate-300">
          Semaine{' '}
          <span className="text-orange-400">{weekKey === 'N' ? 'En cours (N)' : 'Suivante (N+1)'}</span>
        </h3>
        <span className="text-[10px] font-mono font-bold bg-slate-950 px-2.5 py-1 rounded-full border border-slate-800 text-slate-400">
          {workouts.length} séances
        </span>
      </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
            {daysOfWeek.map((dayName) => {
              const workout = workouts?.[weekKey]?.find((w) => w.day.toLowerCase() === dayName.toLowerCase());
      {/* Mobile: horizontal scroll | Desktop: 7 cols */}
      <div className="grid grid-flow-col auto-cols-[minmax(120px,1fr)] sm:grid-flow-row sm:grid-cols-7 gap-2 overflow-x-auto pb-1 snap-x snap-mandatory sm:overflow-visible scrollbar-none">
        {daysOfWeek.map((dayName) => {
          const workout = workouts.find((w) => w.day?.toLowerCase() === dayName.toLowerCase());
          const isRest = workout?.type === 'REPOS';
              return (
                <div
                  key={dayName}
                  className="bg-ria-bg border border-ria-border rounded-xl p-3 flex flex-col justify-between min-h-[140px]"
                >
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[10px] font-bold uppercase text-ria-sub">{dayName}</span>
                      {workout && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${getTypeBadgeColor(workout.type)}`}>
                          {workout.type}
                        </span>
                      )}
                    </div>
          return (
            <button
              key={dayName}
              type="button"
              disabled={!workout}
              onClick={() => workout && onSelectWorkout?.(workout)}
              className={`snap-start text-left bg-slate-950 border rounded-xl p-2.5 flex flex-col justify-between min-h-[130px] transition-all ${
                workout
                  ? 'border-slate-800 hover:border-orange-500/40 active:scale-[0.98] cursor-pointer'
                  : 'border-slate-800/50 opacity-60 cursor-default'
              }`}
            >
              <div>
                <div className="flex justify-between items-start gap-1 mb-1.5">
                  <span className="text-[10px] font-bold uppercase text-slate-500">{dayName.slice(0, 3)}</span>
                  {workout && (
                    <span className={`text-[8px] font-bold px-1 py-0.5 rounded border shrink-0 ${badgeClass(workout.type)}`}>
                      {workout.type === 'C.A.P' ? 'CAP' : workout.type?.slice(0, 4)}
                    </span>
                  )}
                </div>
                    {workout ? (
                      <div>
                        <p className="text-xs font-bold text-ria-darkText line-clamp-2">{workout.title}</p>
                        <p className="text-[11px] text-ria-sub mt-1 line-clamp-3">{workout.desc}</p>
                      </div>
                    ) : (
                      <p className="text-xs italic text-ria-sub/60 mt-2">Repos</p>
                {workout ? (
                  <>
                    <p className="text-[11px] font-bold text-white line-clamp-2 leading-tight">{workout.title}</p>
                    {!isRest && (
                      <p className="text-[10px] text-orange-400/80 font-mono mt-1 truncate">{workout.intensity}</p>
                    )}
                  </div>
                  </>
                ) : (
                  <p className="text-[11px] italic text-slate-600 mt-2">Repos</p>
                )}
              </div>
                  {workout && workout.type !== 'REPOS' && (
                    <div className="mt-3 pt-2 border-t border-ria-border/60 flex justify-between items-center text-[10px] font-mono">
                      <span className="text-ria-sub">{workout.duration}</span>
                      <span className="text-ria-neon font-bold">{workout.intensity}</span>
                    </div>
                  )}
              {workout && (
                <div className="mt-2 pt-1.5 border-t border-slate-800 flex justify-between items-center text-[9px] font-mono text-slate-500">
                  <span>{workout.duration}</span>
                  {workout.modified && <span className="text-orange-400">● mod</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-slate-500 text-center sm:hidden">← Glisse pour voir la semaine →</p>
    </div>
  );
}
export { badgeClass };
