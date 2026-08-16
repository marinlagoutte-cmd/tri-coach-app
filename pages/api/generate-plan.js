import { generatePlanWithAI } from '../../lib/gemini';
import { ensureCompleteWorkouts, getIncompleteWorkouts, checkPlanCoherence } from '../../lib/workouts';

const ERROR_MESSAGES = {
  NO_KEY: "Le coach IA n'est pas encore connecté : ajoute GEMINI_API_KEY dans Vercel → Settings → Environment Variables, puis redéploie.",
  AUTH: "La clé API Gemini semble invalide ou expirée. Vérifie sa valeur dans Vercel → Settings → Environment Variables (puis redéploie).",
  QUOTA: "Le quota de l'API Gemini est atteint pour le moment. Réessaie dans quelques minutes.",
  MODEL_NOT_FOUND: "Le modèle IA configuré est introuvable (peut-être renommé côté Google).",
  SAFETY: "La génération a été bloquée par les filtres de sécurité de l'IA. Essaie de reformuler ton objectif.",
  NETWORK: "Le service IA n'a pas répondu à temps. Réessaie dans un instant.",
  PARSE_ERROR: "Le coach IA a renvoyé une réponse inattendue. Réessaie la génération.",
  UNKNOWN: 'Erreur lors de la génération du plan.',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }
  try {
    const { wizardData, profile, feedbackHistory } = req.body || {};
    if (!wizardData?.targetDate || !profile) {
      return res.status(400).json({ error: 'wizardData et profile requis' });
    }

    const coherenceWarnings = checkPlanCoherence(wizardData);

    const { trainingPlan, workouts, resolvedProfile } = await generatePlanWithAI({ wizardData, profile, feedbackHistory });
    const enriched = ensureCompleteWorkouts(workouts, resolvedProfile || profile);
    const incomplete = getIncompleteWorkouts(enriched);

    return res.status(200).json({
      trainingPlan,
      workouts: enriched,
      profile: resolvedProfile || profile,
      incompleteCount: incomplete.length,
      coherenceWarnings,
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
      error: ERROR_MESSAGES[code] || ERROR_MESSAGES.UNKNOWN,
    });
  }
}
