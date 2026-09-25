import React from 'react';
import { buildRaceExecutionPlan } from '../lib/raceExecution';

// Point 4 — Plan d'exécution course : un vrai plan de course jour J (allures/vitesses
// cibles, minutage, stratégie d'effort par segment), distinct du plan d'ENTRAÎNEMENT
// (semaines N/N+1) déjà affiché ailleurs. Toute la logique de construction/les règles
// "ne jamais inventer" vivent dans lib/raceExecution.js — ce composant ne fait qu'afficher.

function NutritionChips({ nutrition }) {
  if (!nutrition) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      <span className="text-[9px] font-mono bg-ink-900 border border-ink-700 text-ink-300 px-1.5 py-0.5 rounded-full">🍬 {nutrition.carbText}</span>
      <span className="text-[9px] font-mono bg-ink-900 border border-ink-700 text-ink-300 px-1.5 py-0.5 rounded-full">💧 {nutrition.fluidText}</span>
      {nutrition.sodiumText && (
        <span className="text-[9px] font-mono bg-ink-900 border border-ink-700 text-ink-300 px-1.5 py-0.5 rounded-full">🧂 {nutrition.sodiumText}</span>
      )}
    </div>
  );
}

function TriathlonTimeline({ plan }) {
  const isTransition = (key) => key === 't1' || key === 't2';
  return (
    <div className="relative">
      {plan.segments.map((seg, idx) => {
        const isLast = idx === plan.segments.length - 1;
        return (
          <div key={seg.key} className="relative flex gap-3 pb-4 last:pb-0">
            {!isLast && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-ink-700" />}
            <span className={`relative z-10 mt-0.5 shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs ${
              isTransition(seg.key) ? 'bg-ink-950 border-ink-700' : 'bg-ink-900 border-volt-500/50'
            }`}>
              {seg.icon}
            </span>
            <div className={`flex-1 rounded-xl p-2.5 border ${isTransition(seg.key) ? 'bg-ink-950/60 border-ink-800' : 'bg-ink-950 border-ink-800'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-xs text-ink-50">{seg.label}</p>
                <span className="text-[9px] font-mono text-ink-500 shrink-0">{seg.startAtLabel} → {seg.endAtLabel}</span>
              </div>
              {seg.target ? (
                <p className="text-sm font-black font-mono text-volt-400 mt-1">{seg.target}</p>
              ) : seg.targetSource ? (
                <p className="text-[10px] text-ink-600 italic mt-1">{seg.targetSource}</p>
              ) : null}
              <p className="text-[10px] text-ink-400 leading-relaxed mt-1.5">{seg.strategy}</p>
              <NutritionChips nutrition={seg.nutrition} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RunningPlan({ plan }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-1.5 text-center">
        {plan.checkpoints.map((cp) => (
          <div key={cp.label} className="bg-ink-950 border border-ink-800 rounded-xl p-2">
            <span className="text-[9px] text-ink-500 uppercase block">{cp.label}</span>
            <span className="text-[11px] font-black text-ink-50 font-mono block">{cp.atLabel}</span>
            {cp.atKm != null && <span className="text-[9px] text-ink-600 font-mono">{cp.atKm}km</span>}
          </div>
        ))}
      </div>

      {plan.pace ? (
        <div className="bg-ink-950 border border-ink-800 rounded-xl p-2.5 text-center">
          <span className="text-[9px] text-ink-500 uppercase block">Allure cible (constante)</span>
          <span className="text-lg font-black text-volt-400 font-mono">{plan.pace}</span>
          <span className="text-[9px] text-ink-600 block mt-0.5">{plan.paceSource}</span>
        </div>
      ) : (
        <p className="text-[10px] text-ink-600 italic">Allure cible non disponible — distance ou temps visé incomplet au questionnaire.</p>
      )}

      <p className="text-[10px] text-ink-400 leading-relaxed">{plan.strategy}</p>
      <NutritionChips nutrition={plan.nutrition} />
    </div>
  );
}

export default function RaceExecutionPlan({ constraints, profile, onGoToNutrition }) {
  const plan = buildRaceExecutionPlan({ constraints, profile });
  if (!plan) return null;

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">
          🏁 Plan d'exécution course — jour J
        </span>
        <span className="text-[10px] font-mono text-ink-500">{plan.totalLabel}</span>
      </div>
      <p className="text-[10px] text-ink-500 leading-relaxed">
        Du départ à l'arrivée : allures/vitesses cibles, minutage estimé et stratégie d'effort par segment — à ne pas confondre
        avec le plan d'entraînement des semaines à venir.
      </p>

      {plan.sportType === 'triathlon' ? <TriathlonTimeline plan={plan} /> : <RunningPlan plan={plan} />}

      <button
        onClick={onGoToNutrition}
        className="w-full bg-ink-950 hover:bg-ink-800 border border-ink-700 text-ink-300 font-bold px-3 py-2 rounded-xl text-[10px] uppercase min-h-tap"
      >
        🥗 Détailler ma stratégie nutrition par segment →
      </button>
    </div>
  );
}
