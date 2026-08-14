import React from 'react';

export default function WorkoutDetail({ workout, onClose }) {
  if (!workout) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-3xl p-5 space-y-4 shadow-2xl text-slate-100">
        <div className="flex justify-between items-start border-b border-slate-800 pb-3">
          <div>
            <span className="text-[10px] font-mono font-bold uppercase text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-md">
              {workout.day} · {workout.type}
            </span>
            <h3 className="text-base font-black text-white mt-1.5">{workout.title}</h3>
            {workout.modified && (
              <span className="inline-block mt-1 text-[9px] font-bold text-orange-400 bg-orange-500/10 border border-orange-500/30 px-1.5 py-0.5 rounded">
                MODIFIÉ VIA CHAT
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white font-bold p-1 min-h-tap min-w-[44px]">✕</button>
        </div>

        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs text-slate-300 leading-relaxed">
          {workout.desc}
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
          <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-xl">
            <span className="text-[9px] text-slate-500 uppercase block">Allure / Puissance</span>
            <span className="font-bold text-orange-400">{workout.intensity || '-'}</span>
          </div>
          <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-xl">
            <span className="text-[9px] text-slate-500 uppercase block">Cadence</span>
            <span className="font-bold text-slate-200">{workout.cadence || '-'}</span>
          </div>
          <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-xl">
            <span className="text-[9px] text-slate-500 uppercase block">Cardio / Zone</span>
            <span className="font-bold text-indigo-400">{workout.cardio || '-'}</span>
          </div>
          <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-xl">
            <span className="text-[9px] text-slate-500 uppercase block">Effort ressenti</span>
            <span className="font-bold text-rose-400">{workout.rpe || '-'}</span>
          </div>
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-slate-800 text-xs">
          <span className="text-slate-400 font-mono">⏱️ Durée : <strong className="text-white">{workout.duration}</strong></span>
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
