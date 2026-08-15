import React from 'react';
import { shortLabel, getDetailFields } from '../lib/workouts';

function FieldsGrid({ workout, title, dimmed }) {
  const fields = getDetailFields(workout);
  return (
    <div className={dimmed ? 'opacity-60' : ''}>
      {title && <p className="text-[10px] font-bold uppercase text-slate-500 mb-1.5">{title}</p>}
      <p className="text-xs font-bold text-white mb-1.5">{workout.title} · <span className="font-mono text-slate-400">{workout.duration}</span></p>
      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
        {fields.map((f) => (
          <div key={f.label} className="bg-slate-950 border border-slate-800 p-2.5 rounded-xl">
            <span className="text-[9px] text-slate-500 uppercase block">{f.label}</span>
            <span className="font-bold text-orange-400">{f.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WorkoutDetail({ workout, onClose }) {
  if (!workout) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-3xl p-5 space-y-4 shadow-2xl text-slate-100 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start border-b border-slate-800 pb-3">
          <div>
            <span className="text-[10px] font-mono font-bold uppercase text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-md">
              {workout.day} · {shortLabel(workout.type)}
            </span>
            {workout.modified && (
              <span className="inline-block mt-1 ml-1 text-[9px] font-bold text-orange-400 bg-orange-500/10 border border-orange-500/30 px-1.5 py-0.5 rounded">
                {workout.added ? 'AJOUTÉE VIA CHAT' : 'MODIFIÉE VIA CHAT'}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white font-bold p-1 min-h-tap min-w-[44px]">✕</button>
        </div>

        {/* Comparaison : l'ancienne séance reste visible au-dessus de la nouvelle */}
        {workout.previous && (
          <div className="bg-slate-950/60 border border-dashed border-slate-700 p-3 rounded-xl">
            <FieldsGrid workout={workout.previous} title="AVANT" dimmed />
          </div>
        )}

        <div className={workout.previous ? 'bg-slate-950 border border-orange-500/30 p-3 rounded-xl' : ''}>
          {workout.previous && <p className="text-[10px] font-bold uppercase text-orange-400 mb-1.5">APRÈS</p>}
          <FieldsGrid workout={workout} />
        </div>

        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs text-slate-300 leading-relaxed">
          {workout.desc}
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-800 text-xs">
          <button
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 text-white font-bold px-4 py-2 rounded-xl text-xs uppercase min-h-tap"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
