import { generateNutritionAdvice, answerNutritionQuestion } from '../../lib/gemini';
import { deriveRaceProfile } from '../../lib/nutritionData';

const ERROR_MESSAGES = {
  fr: {
    NO_KEY: "⚠️ Le coach IA n'est pas encore connecté : ajoute GEMINI_API_KEY dans Vercel → Settings → Environment Variables, puis redéploie.",
    AUTH: "⚠️ La clé API Gemini semble invalide ou expirée.",
    QUOTA: "⚠️ Le quota de l'API Gemini est atteint pour le moment. Réessaie dans quelques minutes.",
    NETWORK: "⚠️ Le service IA n'a pas répondu à temps. Réessaie dans un instant.",
    UNKNOWN: "Je n'ai pas réussi à générer ce conseil nutrition, réessaie dans un instant.",
  },
  en: {
    NO_KEY: "⚠️ The AI coach isn't connected yet: add GEMINI_API_KEY in Vercel → Settings → Environment Variables, then redeploy.",
    AUTH: "⚠️ The Gemini API key seems invalid or expired.",
    QUOTA: "⚠️ The Gemini API quota has been reached for now. Try again in a few minutes.",
    NETWORK: "⚠️ The AI service didn't respond in time. Try again in a moment.",
    UNKNOWN: "I couldn't generate this nutrition advice, try again in a moment.",
  },
  es: {
    NO_KEY: "⚠️ El coach IA aún no está conectado: añade GEMINI_API_KEY en Vercel → Settings → Environment Variables, y vuelve a desplegar.",
    AUTH: "⚠️ La clave de la API Gemini parece inválida o caducada.",
    QUOTA: "⚠️ Se ha alcanzado la cuota de la API Gemini por ahora. Inténtalo de nuevo en unos minutos.",
    NETWORK: "⚠️ El servicio de IA no respondió a tiempo. Inténtalo de nuevo en un momento.",
    UNKNOWN: "No he podido generar este consejo de nutrición, inténtalo de nuevo en un momento.",
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { profile, trainingPlan, sportType, constraints, question, planSummary, language } = req.body || {};
  const lang = ERROR_MESSAGES[language] ? language : 'fr';
  const raceProfile = deriveRaceProfile({ constraints, trainingPlan, sportType });

  try {
    if (question && String(question).trim()) {
      const { answer, verified } = await answerNutritionQuestion({ profile, trainingPlan, question, raceProfile, planSummary, language: lang });
      return res.status(200).json({ answer, verified });
    }
    const result = await generateNutritionAdvice({ profile, trainingPlan, sportType, raceProfile, language: lang });
    return res.status(200).json(result);
  } catch (error) {
    console.error('[api/nutrition] error:', { code: error?.code, message: error?.message });
    const code = error?.code || 'UNKNOWN';
    return res.status(200).json({ error: ERROR_MESSAGES[lang][code] || ERROR_MESSAGES[lang].UNKNOWN });
  }
}
