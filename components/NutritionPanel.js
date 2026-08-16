import React, { useEffect, useState } from 'react';

function AdviceBlock({ title, text, loading, verified }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-orange-400 uppercase tracking-widest">{title}</span>
        {verified && <span className="text-[9px] text-emerald-400 font-bold">✓ Vérifié scientifiquement</span>}
      </div>
      {loading ? (
        <p className="text-xs text-slate-500 animate-pulse">Génération du conseil...</p>
      ) : (
        <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-line">{text || "Pas encore de conseil généré."}</p>
      )}
    </div>
  );
}

export default function NutritionPanel({ profile, trainingPlan, workouts, sportType }) {
  const [general, setGeneral] = useState('');
  const [weekly, setWeekly] = useState('');
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [question, setQuestion] = useState('');
  const [qaHistory, setQaHistory] = useState([]);
  const [asking, setAsking] = useState(false);

  const loadAdvice = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, trainingPlan, workouts, sportType }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setGeneral(data.generalAdvice);
        setWeekly(data.weeklyAdvice);
        setVerified(data.verified);
      }
    } catch (e) {
      setError("⚠️ Impossible de générer les conseils nutrition pour le moment.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdvice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        body: JSON.stringify({ profile, trainingPlan, question: q }),
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
        <h2 className="text-sm font-black uppercase text-white">🥗 Nutrition & hydratation</h2>
        <button
          onClick={loadAdvice}
          disabled={loading}
          className="text-[10px] font-bold text-orange-400 border border-orange-500/30 bg-orange-500/10 px-2.5 py-1 rounded-lg disabled:opacity-50"
        >
          ↻ Régénérer
        </button>
      </div>

      {error && <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 p-3 rounded-xl">{error}</p>}

      <AdviceBlock title="Conseil général (nourriture & boisson au quotidien)" text={general} loading={loading} verified={verified} />
      <AdviceBlock title="Sur la semaine d'entraînement (par séance)" text={weekly} loading={loading} verified={verified} />

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <span className="text-[10px] font-mono text-orange-400 uppercase tracking-widest block">Une question spécifique ?</span>
        <p className="text-[10px] text-slate-500">Ex : "Je n'arrive pas à manger du solide pendant les efforts intenses, que faire ?"</p>

        {qaHistory.length > 0 && (
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {qaHistory.map((m, i) => (
              <div key={i} className={`text-xs p-2.5 rounded-xl ${m.role === 'user' ? 'bg-orange-500/10 border border-orange-500/20 text-orange-200' : 'bg-slate-950 border border-slate-800 text-slate-200'}`}>
                {m.role === 'coach' && m.verified && <span className="block text-[9px] text-emerald-400 font-bold mb-1">✓ Vérifié scientifiquement</span>}
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
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-orange-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={asking}
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold"
          >
            Envoyer
          </button>
        </form>
      </div>

      <p className="text-[9px] text-slate-600 text-center">
        Conseils basés sur les référentiels ACSM/ISSN — ne remplacent pas un avis médical ou diététique individualisé.
      </p>
    </div>
  );
}
