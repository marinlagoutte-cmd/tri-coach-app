// components/GenerationProgress.js
//
// ÉCRAN DE PROGRESSION pendant la génération d'un plan ou d'une semaine (souvent 1 à 2 min,
// sans aucune indication auparavant). La barre est un parcours de triathlon : l'athlète
// avance avec la progression et change de sport aux transitions (natation → vélo → course).
//
// Honnêteté : le serveur ne renvoie pas d'avancement réel pendant la génération ; la
// progression est une ESTIMATION calée sur la durée habituelle (elle ralentit à l'approche de
// la fin et ne dépasse jamais 95 % tant que la réponse n'est pas arrivée). Le temps écoulé
// réel est affiché à côté.

import { useEffect, useState } from 'react';
import { Waves, Bike, Footprints, Check } from 'lucide-react';

const STAGES = {
  plan: [
    { at: 0, label: 'Analyse de ton profil et de ta charge' },
    { at: 12, label: 'Construction de la saison : phases et volumes' },
    { at: 30, label: "Écriture des séances par l'IA" },
    { at: 68, label: 'Double vérification par une deuxième IA' },
    { at: 86, label: 'Contrôles de cohérence et derniers ajustements' },
  ],
  week: [
    { at: 0, label: 'Lecture de ta semaine précédente et de ta forme' },
    { at: 20, label: "Écriture des séances par l'IA" },
    { at: 65, label: 'Double vérification par une deuxième IA' },
    { at: 86, label: 'Contrôles de cohérence et derniers ajustements' },
  ],
};
const EXPECTED_S = { plan: 100, week: 60 };
// Parcours : natation 0-20 %, vélo 20-70 %, course 70-100 % (repères visuels).
const LEGS = [
  { until: 20, Icon: Waves, color: '#06B6D4', name: 'Natation' },
  { until: 70, Icon: Bike, color: '#F59E0B', name: 'Vélo' },
  { until: 101, Icon: Footprints, color: '#10B981', name: 'Course' },
];

export function estimatedProgress(elapsedS, expectedS) {
  return Math.min(95, 95 * (1 - Math.exp(-elapsedS / (expectedS / 2))));
}

function fmt(s) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export default function GenerationProgress({ kind = 'plan', title }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - start) / 1000), 250);
    return () => clearInterval(id);
  }, []);
  const stages = STAGES[kind] || STAGES.plan;
  const progress = estimatedProgress(elapsed, EXPECTED_S[kind] || 90);
  const stageIdx = stages.reduce((idx, s, i) => (progress >= s.at ? i : idx), 0);
  const leg = LEGS.find((l) => progress < l.until) || LEGS[2];
  const LegIcon = leg.Icon;

  return (
    <div className="fixed inset-0 z-[90] bg-ink-950/95 backdrop-blur-sm flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-labelledby="gen-title">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h2 id="gen-title" className="text-[17px] font-bold text-ink-50">{title || (kind === 'week' ? 'Ton coach prépare la semaine' : 'Ton coach prépare ton plan')}</h2>
          <p className="text-[13px] text-ink-400">En général 1 à 2 minutes. Tu peux laisser l'app ouverte.</p>
        </div>

        {/* Parcours : la barre de progression */}
        <div className="pt-8">
          <div className="relative h-2.5 rounded-full bg-ink-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="Avancement estimé">
            <div
              className="absolute inset-0 rounded-full transition-[clip-path] duration-300"
              style={{
                background: 'linear-gradient(90deg, #06B6D4 0%, #06B6D4 20%, #F59E0B 20%, #F59E0B 70%, #10B981 70%, #10B981 100%)',
                clipPath: `inset(0 ${100 - progress}% 0 0 round 999px)`,
              }}
            />
            <span className="absolute top-[-2px] w-px h-3.5 bg-ink-600" style={{ left: '20%' }} aria-hidden="true" />
            <span className="absolute top-[-2px] w-px h-3.5 bg-ink-600" style={{ left: '70%' }} aria-hidden="true" />
            <span
              className="tri-athlete absolute -top-9 w-8 h-8 rounded-full text-white flex items-center justify-center shadow-md transition-[left,background-color] duration-300"
              style={{ left: `${progress}%`, backgroundColor: leg.color }}
              aria-hidden="true"
            >
              <LegIcon size={17} strokeWidth={2.3} />
            </span>
          </div>
          <div className="relative h-4 mt-1.5 text-[11px] text-ink-500" aria-hidden="true">
            <span className="absolute left-0">Natation</span>
            <span className="absolute -translate-x-1/2" style={{ left: '45%' }}>Vélo</span>
            <span className="absolute right-0">Course</span>
          </div>
        </div>

        <div className="flex items-baseline justify-between px-1">
          <span className="text-[22px] font-bold text-ink-50 tabular-nums">{Math.round(progress)} %</span>
          <span className="text-[12px] text-ink-400 tabular-nums">{fmt(elapsed)} écoulées · estimation</span>
        </div>

        <ol className="space-y-2" aria-live="polite">
          {stages.map((s, i) => {
            const done = i < stageIdx;
            const current = i === stageIdx;
            return (
              <li key={s.label} className={`flex items-center gap-2.5 text-[13px] ${current ? 'text-ink-50 font-semibold' : done ? 'text-ink-300' : 'text-ink-500'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-emerald-500 text-white' : current ? 'border-2 border-ink-50' : 'border border-ink-700'}`} aria-hidden="true">
                  {done && <Check size={12} strokeWidth={3} />}
                  {current && <span className="w-1.5 h-1.5 rounded-full bg-ink-50 tri-pulse" />}
                </span>
                {s.label}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
