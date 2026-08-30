import { coGeneratePlan } from '../../lib/coGeneration';
import { ensureCompleteWorkouts, getIncompleteWorkouts, checkPlanCoherence } from '../../lib/workouts';
import { checkRateLimit, RATE_LIMIT_MESSAGES } from '../../lib/rateLimit';

// Ces messages ne s'affichent que si LES DEUX IA (Gemini ET Groq) ont échoué —
// voir coGeneratePlan : tant qu'une seule répond, la génération réussit quand même
// (avec une note transparente dans autoFixNotes signalant l'absence de double-check).
const ERROR_MESSAGES = {
  fr: {
    NO_KEY: "Ni Gemini ni Groq ne sont connectés : ajoute au moins GEMINI_API_KEY (et idéalement aussi GROQ_API_KEY, gratuite, pour le double-check) dans Vercel → Settings → Environment Variables, puis redéploie.",
    AUTH: "Les clés API semblent invalides ou expirées. Vérifie GEMINI_API_KEY et GROQ_API_KEY dans Vercel → Settings → Environment Variables (puis redéploie).",
    QUOTA: "Le quota des IA est atteint pour le moment. Réessaie dans quelques minutes.",
    MODEL_NOT_FOUND: "Le modèle IA configuré est introuvable (peut-être renommé côté fournisseur).",
    SAFETY: "La génération a été bloquée par les filtres de sécurité de l'IA. Essaie de reformuler ton objectif.",
    NETWORK: "Le service IA n'a pas répondu à temps. Réessaie dans un instant.",
    PARSE_ERROR: "Le coach IA a renvoyé une réponse inattendue. Réessaie la génération.",
    UNKNOWN: 'Erreur lors de la génération du plan.',
  },
  en: {
    NO_KEY: "Neither Gemini nor Groq is connected: add at least GEMINI_API_KEY (and ideally GROQ_API_KEY too, free, for the double-check) in Vercel → Settings → Environment Variables, then redeploy.",
    AUTH: "The API keys seem invalid or expired. Check GEMINI_API_KEY and GROQ_API_KEY in Vercel → Settings → Environment Variables (then redeploy).",
    QUOTA: "The AI quota has been reached for now. Try again in a few minutes.",
    MODEL_NOT_FOUND: "The configured AI model can't be found (it may have been renamed by the provider).",
    SAFETY: "Generation was blocked by the AI's safety filters. Try rephrasing your goal.",
    NETWORK: "The AI service didn't respond in time. Try again in a moment.",
    PARSE_ERROR: "The AI coach returned an unexpected response. Try generating again.",
    UNKNOWN: 'Error while generating the plan.',
  },
  es: {
    NO_KEY: "Ni Gemini ni Groq están conectados: añade al menos GEMINI_API_KEY (e idealmente también GROQ_API_KEY, gratuita, para la doble verificación) en Vercel → Settings → Environment Variables, y vuelve a desplegar.",
    AUTH: "Las claves de API parecen inválidas o caducadas. Revisa GEMINI_API_KEY y GROQ_API_KEY en Vercel → Settings → Environment Variables (y vuelve a desplegar).",
    QUOTA: "Se ha alcanzado la cuota de las IA por ahora. Inténtalo de nuevo en unos minutos.",
    MODEL_NOT_FOUND: "No se encuentra el modelo de IA configurado (puede que el proveedor le haya cambiado el nombre).",
    SAFETY: "La generación fue bloqueada por los filtros de seguridad de la IA. Intenta reformular tu objetivo.",
    NETWORK: "El servicio de IA no respondió a tiempo. Inténtalo de nuevo en un momento.",
    PARSE_ERROR: "El coach IA devolvió una respuesta inesperada. Vuelve a intentar la generación.",
    UNKNOWN: 'Error al generar el plan.',
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }
  const { wizardData, profile, feedbackHistory, healthHistory, manualPaceZones, language } = req.body || {};
  const lang = ERROR_MESSAGES[language] ? language : 'fr';

  // Rate limit léger par IP (voir lib/rateLimit.js) : génération complète = l'appel
  // Gemini le plus coûteux de l'app (gros prompt), donc la limite la plus stricte des 3 routes.
  const { allowed, retryAfterSec } = checkRateLimit(req, { id: 'generate-plan', limit: 5, windowMs: 60_000 });
  if (!allowed) {
    return res.status(429).json({ error: RATE_LIMIT_MESSAGES[lang](retryAfterSec) });
  }

  try {
    if (!wizardData?.targetDate || !profile) {
      return res.status(400).json({ error: 'wizardData et profile requis' });
    }

    const coherenceWarnings = checkPlanCoherence(wizardData);

    const { trainingPlan, workouts, resolvedProfile, qualityWarnings, autoFixNotes } = await coGeneratePlan({ wizardData, profile, feedbackHistory, healthHistory, manualPaceZones, language: lang });
    // Même besoin qu'à l'intérieur de generatePlanWithAI (voir lib/gemini.js:profileForSanitize) :
    // ensureCompleteWorkouts ré-exécute sanitizeWorkout, qui doit voir les zones calibrées
    // manuellement pour ne pas retomber sur le calcul théorique 75% VMA à cette étape.
    const profileForCompletion = { ...(resolvedProfile || profile), paceZones: manualPaceZones };
    const enriched = ensureCompleteWorkouts(workouts, profileForCompletion);
    const incomplete = getIncompleteWorkouts(enriched);

    return res.status(200).json({
      trainingPlan,
      workouts: enriched,
      profile: resolvedProfile || profile,
      incompleteCount: incomplete.length,
      // Avertissements pré-génération (contraintes du questionnaire) + post-génération
      // (vérifications déterministes sur le plan réellement produit par l'IA, voir
      // generatePlanWithAI) — mêmes types d'alerte côté front, donc fusionnés ici.
      // Ce sont des points RÉELLEMENT non résolus (rien ne les a corrigés).
      coherenceWarnings: [...coherenceWarnings, ...(qualityWarnings || [])],
      // Distinct de coherenceWarnings : ce que la relecture IA a détecté ET DÉJÀ CORRIGÉ
      // automatiquement dans le plan livré — simple transparence, pas une alerte à traiter.
      autoFixNotes: autoFixNotes || [],
    });
  } catch (error) {
    // Log complet côté serveur (visible dans Vercel → Deployments → Functions → Logs)
    console.error('[api/generate-plan] error:', {
      code: error?.code,
      message: error?.message,
      stack: error?.stack,
    });

    const code = error?.code || 'UNKNOWN';
    // Important : le front (index.js) vérifie `res.ok` pour savoir si la génération a échoué.
    // On garde donc un statut d'erreur ici (contrairement à /api/chat qui renvoie toujours 200) —
    // mais le message reste clair et exploitable, et rien ne "casse" côté client (wizardError s'affiche proprement).
    return res.status(503).json({
      error: ERROR_MESSAGES[lang][code] || ERROR_MESSAGES[lang].UNKNOWN,
    });
  }
}
