import { badgeClass } from './CalendarView';
export default function WorkoutDetail({ workout, onClose }) {
  if (!workout) return null;
  const isRest = workout.type === 'REPOS';
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-label="Fermer" />
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[85vh] overflow-y-auto animate-slideUp">
        <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-mono font-black uppercase text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-md">
                {workout.day}
              </span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${badgeClass(workout.type)}`}>
                {workout.type}
              </span>
              {workout.modified && (
                <span className="text-[9px] text-orange-400 font-mono">modifiée</span>
              )}
            </div>
            <h3 className="text-base font-black text-white">{workout.title}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none p-1">✕</button>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed bg-slate-950/60 p-3 rounded-xl border border-slate-800/50">
          {workout.desc}
        </p>
        {!isRest && (
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            {[
              { label: 'Durée', value: workout.duration, color: 'text-slate-200' },
              { label: 'Intensité / Pace', value: workout.intensity, color: 'text-orange-400' },
              { label: 'Cadence', value: workout.cadence, color: 'text-slate-200' },
              { label: 'Zone FC', value: workout.cardio, color: 'text-indigo-400' },
              { label: 'RPE', value: workout.rpe, color: 'text-rose-400', span: true },
            ].map((m) => (
              <div
                key={m.label}
                className={`bg-slate-950 border border-slate-800 p-2.5 rounded-xl ${m.span ? 'col-span-2' : ''}`}
              >
                <span className="text-[9px] text-slate-500 font-mono uppercase">{m.label}</span>
                <p className={`font-bold font-mono mt-0.5 ${m.color}`}>{m.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
