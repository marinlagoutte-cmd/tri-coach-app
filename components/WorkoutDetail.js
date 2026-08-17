import React, { useState } from 'react';
import { shortLabel, getDetailFields } from '../lib/workouts';


function RatingSlider({ label, value, onChange, hint }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] font-bold uppercase text-ink-400">{label}</span>
        <span className="text-xs font-black text-volt-400 font-mono">{value}/10</span>
      </div>
      <input
        type="range"
        min="1"
        max="10"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-volt-500"
      />
      {hint && <p className="text-[9px] text-ink-500 mt-0.5">{hint}</p>}
    </div>
  );
}

function SessionValidation({ workout, existingFeedback, pendingAdjustment, onSubmit, onLighten, onKeep }) {
  const [showForm, setShowForm] = useState(false);
  const [difficulty, setDifficulty] = useState(5);
  const [capacity, setCapacity] = useState(5);

  const isPending = pendingAdjustment?.workout?.id === workout.id;

  if (isPending) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-xl space-y-2">
        <p className="text-[11px] text-amber-300 leading-relaxed">⚠️ {pendingAdjustment.analysis.reason}</p>
        <p className="text-[11px] text-ink-300">Faut-il alléger la suite de la semaine ?</p>
        <div className="flex gap-2">
          <button onClick={onLighten} className="flex-1 bg-volt-500 hover:bg-volt-600 text-white font-bold px-3 py-2 rounded-xl text-[11px] min-h-tap">
            Alléger la semaine
          </button>
          <button onClick={onKeep} className="flex-1 bg-ink-800 hover:bg-ink-700 text-ink-50 font-bold px-3 py-2 rounded-xl text-[11px] min-h-tap">
            Garder comme ça
          </button>
        </div>
      </div>
    );
  }

  if (existingFeedback) {
    return (
      <div className="bg-emerald-950/40 border border-emerald-800 p-3 rounded-xl text-[11px] text-emerald-300 flex justify-between">
        <span>✅ Séance validée</span>
        <span className="font-mono">Dureté {existingFeedback.difficulty}/10 · Forme {existingFeedback.capacity}/10</span>
      </div>
    );
  }

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="w-full bg-ink-800 hover:bg-ink-700 text-ink-50 font-bold px-3 py-2.5 rounded-xl text-xs uppercase min-h-tap"
      >
        ✔️ Valider la séance
      </button>
    );
  }

  return (
    <div className="bg-ink-950 border border-ink-800 p-3 rounded-xl space-y-3">
      <RatingSlider label="Dureté ressentie" value={difficulty} onChange={setDifficulty} hint="1 = très facile, 10 = extrêmement dur" />
      <RatingSlider label="Forme physique" value={capacity} onChange={setCapacity} hint="1 = mauvaise forme, 10 = en pleine forme" />
      <button
        onClick={() => { onSubmit(difficulty, capacity); setShowForm(false); }}
        className="w-full bg-volt-500 hover:bg-volt-600 text-white font-bold px-3 py-2 rounded-xl text-xs uppercase min-h-tap"
      >
        Envoyer mon ressenti
      </button>
    </div>
  );
}

function FieldsGrid({ workout, title, dimmed }) {
  const fields = getDetailFields(workout);
  return (
    <div className={dimmed ? 'opacity-60' : ''}>
      {title && <p className="text-[10px] font-bold uppercase text-ink-500 mb-1.5">{title}</p>}
      <p className="text-xs font-bold text-ink-50 mb-1.5">{workout.title} · <span className="font-mono text-ink-400">{workout.duration}</span></p>
      {workout.structure && (
        <div className="bg-volt-500/5 border border-volt-500/20 p-2.5 rounded-lg mb-2">
          <span className="text-[9px] text-volt-400 uppercase font-bold block mb-0.5">Structure de la séance</span>
          <p className="text-[11px] text-ink-200 leading-relaxed">{workout.structure}</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
        {fields.map((f) => (
          <div key={f.label} className="bg-ink-950 border border-ink-800 p-2.5 rounded-xl">
            <span className="text-[9px] text-ink-500 uppercase block">{f.label}</span>
            <span className="font-bold text-volt-400">{f.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WorkoutDetail({ workout, onClose, existingFeedback, pendingAdjustment, onSubmitFeedback, onLightenWeek, onKeepAsIs }) {
  if (!workout) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-ink-900 border border-ink-800 w-full max-w-sm rounded-3xl p-5 space-y-4 shadow-2xl text-ink-100 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start border-b border-ink-800 pb-3">
          <div>
            <span className="text-[10px] font-mono font-bold uppercase text-volt-400 bg-volt-500/10 border border-volt-500/20 px-2 py-0.5 rounded-md">
              {workout.day} · {shortLabel(workout.type)}
            </span>
            {workout.modified && (
              <span className="inline-block mt-1 ml-1 text-[9px] font-bold text-volt-400 bg-volt-500/10 border border-volt-500/30 px-1.5 py-0.5 rounded">
                {workout.added ? 'AJOUTÉE VIA CHAT' : 'MODIFIÉE VIA CHAT'}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-50 font-bold p-1 min-h-tap min-w-[44px]">✕</button>
        </div>

        {/* Comparaison : l'ancienne séance reste visible au-dessus de la nouvelle */}
        {workout.previous && (
          <div className="bg-ink-950/60 border border-dashed border-ink-700 p-3 rounded-xl">
            <FieldsGrid workout={workout.previous} title="AVANT" dimmed />
          </div>
        )}

        <div className={workout.previous ? 'bg-ink-950 border border-volt-500/30 p-3 rounded-xl' : ''}>
          {workout.previous && <p className="text-[10px] font-bold uppercase text-volt-400 mb-1.5">APRÈS</p>}
          <FieldsGrid workout={workout} />
        </div>

        <div className="bg-ink-950 p-3 rounded-xl border border-ink-800 text-xs text-ink-300 leading-relaxed">
          {workout.desc}
        </div>

        {workout.type !== 'REPOS' && (
          <SessionValidation
            workout={workout}
            existingFeedback={existingFeedback}
            pendingAdjustment={pendingAdjustment}
            onSubmit={(difficulty, capacity) => onSubmitFeedback?.(workout, difficulty, capacity)}
            onLighten={onLightenWeek}
            onKeep={onKeepAsIs}
          />
        )}

        <div className="flex justify-end pt-2 border-t border-ink-800 text-xs">
          <button
            onClick={onClose}
            className="bg-ink-800 hover:bg-ink-700 text-ink-50 font-bold px-4 py-2 rounded-xl text-xs uppercase min-h-tap"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
