import React, { useEffect, useMemo, useState } from 'react';
import NutritionPlanner from './NutritionPlanner';
import { deriveRaceProfile, buildStaticAdvice, TIER_LABELS } from '../lib/nutritionData';

function AdviceBlock({ title, text, loading, verified }) {
  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest">{title}</span>
        {verified && <span className="text-[9px] text-emerald-400 font-bold shrink-0">✓ Vérifié</span>}
      </div>
      <p className={`text-xs text-ink-200 leading-relaxed whitespace-pre-line ${loading ? 'opacity-50' : ''}`}>{text}</p>
    </div>
  );
}

export default function NutritionPanel({ profile, trainingPlan, sportType, constraints }) {
  const raceProfile = useMemo(
    () => deriveRaceProfile({ constraints, trainingPlan, sportType }),
    [constraints, trainingPlan, sportType]
  );
  const staticAdvice = useMemo(() => buildStaticAdvice(raceProfile), [raceProfile]);

  const [training, setTraining] = useState(staticAdvice.trainingAdvice);
  const [race, setRace] = useState(staticAdvice.raceAdvice);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [planSummary, setPlanSummary] = useState('');

  const [question, setQuestion] = useState('');
  const [qaHistory, setQaHistory] = useState([]);
  const [asking, setAsking] = useState(false);

  // Les deux paragraphes s'affichent instantanément avec un texte déterministe (toujours
  // disponible, jamais d'écran d'attente) puis sont discrètement remplacés par une version
  // personnalisée par l'IA une fois générée — voir lib/nutritionData.js pour le texte par défaut.
  const loadAiAdvice = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, trainingPlan, sportType, constraints }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setTraining(data.trainingAdvice);
        setRace(data.raceAdvice);
        setVerified(data.verified);
      }
    } catch (e) {
      // Silencieux : le texte statique déjà affiché reste une réponse valable.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setTraining(staticAdvice.trainingAdvice);
    setRace(staticAdvice.raceAdvice);
    setVerified(false);
    loadAiAdvice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceProfile.tier, raceProfile.sportType]);

  const askQuestion = async (e) => {
    e?.preventDefault();
    if (!question.trim() || asking) return;
    const q = question;
    setQuestion('');
    setAsking(true);
    setQaHistory((prev) => [...prev, { role: 'user', text: q }]);
    try {
      const res = await fetch('/api/nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, trainingPlan, constraints, question: q, planSummary }),
      });
      const data = await res.json();
      setQaHistory((prev) => [...prev, { role: 'coach', text: data.error || data.answer, verified: data.verified }]);
    } catch (e) {
      setQaHistory((prev) => [...prev, { role: 'coach', text: "⚠️ Erreur lors de la réponse." }]);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-black uppercase text-ink-50">🥗 Nutrition & hydratation</h2>
          <p className="text-[10px] text-ink-500 mt-0.5">{TIER_LABELS[raceProfile.tier]}</p>
        </div>
        <button
          onClick={loadAiAdvice}
          disabled={loading}
          className="text-[10px] font-bold text-volt-400 border border-volt-500/30 bg-volt-500/10 px-2.5 py-1 rounded-lg disabled:opacity-50 shrink-0"
        >
          ↻ Régénérer
        </button>
      </div>

      {error && <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 p-3 rounded-xl">{error}</p>}

      <AdviceBlock title="À l'entraînement" text={training} loading={loading} verified={verified} />
      <AdviceBlock title="Le jour de la course" text={race} loading={loading} verified={verified} />

      <NutritionPlanner
        profile={profile}
        sportType={sportType}
        constraints={constraints}
        trainingPlan={trainingPlan}
        onSummaryChange={setPlanSummary}
      />

      <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-3">
        <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">Une question spécifique ?</span>
        <p className="text-[10px] text-ink-500">Ex : "Je n'arrive pas à manger de gels pendant les efforts intenses, que faire ?"</p>

        {qaHistory.length > 0 && (
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {qaHistory.map((m, i) => (
              <div key={i} className={`text-xs p-2.5 rounded-xl ${m.role === 'user' ? 'bg-volt-500/10 border border-volt-500/20 text-volt-200' : 'bg-ink-950 border border-ink-800 text-ink-200'}`}>
                {m.role === 'coach' && m.verified && <span className="block text-[9px] text-emerald-400 font-bold mb-1">✓ Vérifié</span>}
                <p className="whitespace-pre-line leading-relaxed">{m.text}</p>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={askQuestion} className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Pose ta question nutrition..."
            className="flex-1 bg-ink-950 border border-ink-800 rounded-xl px-3 py-2 text-xs text-ink-50 placeholder-ink-500 focus:border-volt-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={asking}
            className="bg-volt-500 hover:bg-volt-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold"
          >
            Envoyer
          </button>
        </form>
      </div>

      <p className="text-[9px] text-ink-600 text-center">
        Conseils basés sur les référentiels ACSM/ISSN — ne remplacent pas un avis médical ou diététique individualisé.
      </p>
    </div>
  );
}
