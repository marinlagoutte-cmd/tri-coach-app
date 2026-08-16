import { generateNutritionAdvice, answerNutritionQuestion } from '../../lib/gemini';

const ERROR_MESSAGES = {
  NO_KEY: "⚠️ Le coach IA n'est pas encore connecté : ajoute GEMINI_API_KEY dans Vercel → Settings → Environment Variables, puis redéploie.",
  AUTH: "⚠️ La clé API Gemini semble invalide ou expirée.",
  QUOTA: "⚠️ Le quota de l'API Gemini est atteint pour le moment. Réessaie dans quelques minutes.",
  NETWORK: "⚠️ Le service IA n'a pas répondu à temps. Réessaie dans un instant.",
  UNKNOWN: "Je n'ai pas réussi à générer ce conseil nutrition, réessaie dans un instant.",
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { profile, trainingPlan, workouts, sportType, question } = req.body || {};

  try {
    if (question && String(question).trim()) {
      const { answer, verified } = await answerNutritionQuestion({ profile, trainingPlan, question });
      return res.status(200).json({ answer, verified });
    }
    const result = await generateNutritionAdvice({ profile, trainingPlan, workouts, sportType });
    return res.status(200).json(result);
  } catch (error) {
    console.error('[api/nutrition] error:', { code: error?.code, message: error?.message });
    const code = error?.code || 'UNKNOWN';
    return res.status(200).json({ error: ERROR_MESSAGES[code] || ERROR_MESSAGES.UNKNOWN });
  }
}
