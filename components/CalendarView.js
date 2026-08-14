import React from 'react';

export default function CalendarView({ workouts }) {
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
              {workouts[weekKey]?.length || 0} séances
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
            {daysOfWeek.map((dayName) => {
              const workout = workouts[weekKey]?.find((w) => w.day.toLowerCase() === dayName.toLowerCase());

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

                    {workout ? (
                      <div>
                        <p className="text-xs font-bold text-ria-darkText line-clamp-2">{workout.title}</p>
                        <p className="text-[11px] text-ria-sub mt-1 line-clamp-3">{workout.desc}</p>
                      </div>
                    ) : (
                      <p className="text-xs italic text-ria-sub/60 mt-2">Repos</p>
                    )}
                  </div>

                  {workout && workout.type !== 'REPOS' && (
                    <div className="mt-3 pt-2 border-t border-ria-border/60 flex justify-between items-center text-[10px] font-mono">
                      <span className="text-ria-sub">{workout.duration}</span>
                      <span className="text-ria-neon font-bold">{workout.intensity}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
