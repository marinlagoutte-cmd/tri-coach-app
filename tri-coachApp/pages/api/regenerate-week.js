import { coRegenerateWeek } from '../../lib/coGeneration';
import { ensureCompleteWorkouts, getIncompleteWorkouts } from '../../lib/workouts';
import { checkRateLimit, RATE_LIMIT_MESSAGES } from '../../lib/rateLimit';

// Mêmes messages d'erreur que /api/generate-plan.js (même origine possible : clé
// manquante/invalide, quota, timeout réseau, JSON invalide côté IA) — pas de duplication
// de logique de génération de message ici, juste les mêmes libellés déjà éprouvés.
// Ne s'affichent que si LES DEUX IA ont échoué (voir coRegenerateWeek).
const ERROR_MESSAGES = {
  fr: {
    NO_KEY: "Ni Gemini ni Groq ne sont connectés : ajoute au moins GEMINI_API_KEY (et idéalement aussi GROQ_API_KEY, gratuite, pour le double-check) dans Vercel → Settings → Environment Variables, puis redéploie.",
    AUTH: "Les clés API semblent invalides ou expirées. Vérifie GEMINI_API_KEY et GROQ_API_KEY dans Vercel → Settings → Environment Variables (puis redéploie).",
    QUOTA: "Le quota des IA est atteint pour le moment. Réessaie dans quelques minutes.",
    MODEL_NOT_FOUND: "Le modèle IA configuré est introuvable (peut-être renommé côté fournisseur).",
    SAFETY: "La génération a été bloquée par les filtres de sécurité de l'IA. Essaie de reformuler ton objectif.",
    NETWORK: "Le service IA n'a pas répondu à temps. Réessaie dans un instant.",
    PARSE_ERROR: "Le coach IA a renvoyé une réponse inattendue. Réessaie la régénération.",
    UNKNOWN: 'Erreur lors de la régénération de la semaine.',
  },
  en: {
    NO_KEY: "Neither Gemini nor Groq is connected: add at least GEMINI_API_KEY (and ideally GROQ_API_KEY too, free, for the double-check) in Vercel → Settings → Environment Variables, then redeploy.",
    AUTH: "The API keys seem invalid or expired. Check GEMINI_API_KEY and GROQ_API_KEY in Vercel → Settings → Environment Variables (then redeploy).",
    QUOTA: "The AI quota has been reached for now. Try again in a few minutes.",
    MODEL_NOT_FOUND: "The configured AI model can't be found (it may have been renamed by the provider).",
    SAFETY: "Generation was blocked by the AI's safety filters. Try rephrasing your goal.",
    NETWORK: "The AI service didn't respond in time. Try again in a moment.",
    PARSE_ERROR: "The AI coach returned an unexpected response. Try regenerating again.",
    UNKNOWN: 'Error while regenerating the week.',
  },
  es: {
    NO_KEY: "Ni Gemini ni Groq están conectados: añade al menos GEMINI_API_KEY (e idealmente también GROQ_API_KEY, gratuita, para la doble verificación) en Vercel → Settings → Environment Variables, y vuelve a desplegar.",
    AUTH: "Las claves de API parecen inválidas o caducadas. Revisa GEMINI_API_KEY y GROQ_API_KEY en Vercel → Settings → Environment Variables (y vuelve a desplegar).",
    QUOTA: "Se ha alcanzado la cuota de las IA por ahora. Inténtalo de nuevo en unos minutos.",
    MODEL_NOT_FOUND: "No se encuentra el modelo de IA configurado (puede que el proveedor le haya cambiado el nombre).",
    SAFETY: "La generación fue bloqueada por los filtros de seguridad de la IA. Intenta reformular tu objetivo.",
    NETWORK: "El servicio de IA no respondió a tiempo. Inténtalo de nuevo en un momento.",
    PARSE_ERROR: "El coach IA devolvió una respuesta inesperada. Vuelve a intentar la regeneración.",
    UNKNOWN: 'Error al regenerar la semana.',
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }
  const { weekKey, profile, workouts, trainingPlan, constraints, feedbackHistory, healthHistory, manualPaceZones, language } = req.body || {};
  const lang = ERROR_MESSAGES[language] ? language : 'fr';

  // Rate limit léger par IP — même ordre de grandeur que /api/chat (prompt plus petit qu'une
  // génération complète des 2 semaines, mais reste un appel IA à part entière + relecture).
  const { allowed, retryAfterSec } = checkRateLimit(req, { id: 'regenerate-week', limit: 10, windowMs: 60_000 });
  if (!allowed) {
    return res.status(429).json({ error: RATE_LIMIT_MESSAGES[lang](retryAfterSec) });
  }

  try {
    if (!constraints?.targetDate || !profile) {
      return res.status(400).json({ error: 'constraints (objectif) et profile requis pour régénérer une semaine.' });
    }
    if (weekKey !== 'N' && weekKey !== 'N+1') {
      return res.status(400).json({ error: "weekKey doit valoir 'N' ou 'N+1'." });
    }

    const { workouts: updatedWorkouts, resolvedProfile, qualityWarnings } = await coRegenerateWeek({
      weekKey,
      profile,
      workouts,
      trainingPlan,
      constraints,
      feedbackHistory,
      healthHistory,
      manualPaceZones,
      language: lang,
    });

    const profileForCompletion = { ...(resolvedProfile || profile), paceZones: manualPaceZones };
    const enriched = ensureCompleteWorkouts(updatedWorkouts, profileForCompletion);
    const incomplete = getIncompleteWorkouts(enriched);

    return res.status(200).json({
      workouts: enriched,
      profile: resolvedProfile || profile,
      incompleteCount: incomplete.length,
      qualityWarnings: qualityWarnings || [],
    });
  } catch (error) {
    console.error('[api/regenerate-week] error:', {
      code: error?.code,
      message: error?.message,
      stack: error?.stack,
    });
    const code = error?.code || 'UNKNOWN';
    return res.status(503).json({
      error: ERROR_MESSAGES[lang][code] || ERROR_MESSAGES[lang].UNKNOWN,
    });
  }
}
