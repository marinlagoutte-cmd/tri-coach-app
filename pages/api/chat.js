import { chatWithCoach } from '../../lib/gemini';
import { mergeWorkoutPatches, checkSessionCountCoherence } from '../../lib/workouts';

const ERROR_MESSAGES = {
  NO_KEY: "⚠️ Le coach IA n'est pas encore connecté : ajoute GEMINI_API_KEY dans Vercel → Settings → Environment Variables, puis redéploie.",
  AUTH: "⚠️ La clé API Gemini semble invalide ou expirée. Vérifie sa valeur dans Vercel → Settings → Environment Variables (puis redéploie).",
  QUOTA: "⚠️ Le quota de l'API Gemini est atteint pour le moment. Réessaie dans quelques minutes.",
  MODEL_NOT_FOUND: "⚠️ Le modèle IA configuré est introuvable (peut-être renommé côté Google). J'ai enregistré ta demande, réessaie plus tard.",
  SAFETY: "⚠️ Ta demande a été bloquée par les filtres de sécurité de l'IA. Essaie de la reformuler.",
  NETWORK: "⚠️ Le service IA n'a pas répondu à temps. Réessaie dans un instant.",
  PARSE_ERROR: "⚠️ Le coach IA a renvoyé une réponse inattendue. Réessaie ta demande.",
  UNKNOWN: "Je n'ai pas réussi à traiter ta demande pour le moment, réessaie dans un instant.",
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { message, profile, workouts, trainingPlan, intent, sportType, constraints, feedbackHistory } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ reply: 'Écris-moi un message pour que je puisse t\'aider.', updatedWorkouts: workouts });
  }

  try {
    const { reply, patches } = await chatWithCoach({ message, profile, workouts, trainingPlan, intent, sportType, constraints, feedbackHistory });
    let updatedWorkouts = mergeWorkoutPatches(workouts, patches, profile);

    // Si le coach a ajouté/retiré une séance sans que ce soit demandé (intent absent),
    // on ne force PAS de correction déterministe ici (contrairement à la génération
    // initiale) : un ajustement ponctuel demandé par l'athlète peut légitimement
    // changer le nombre de séances pour CETTE semaine. On se contente de signaler
    // l'écart dans les logs pour diagnostic, sans jamais l'imposer silencieusement.
    if (constraints?.maxSessionsPerWeek && patches?.length) {
      ['N', 'N+1'].forEach((weekKey) => {
        const issues = checkSessionCountCoherence(updatedWorkouts[weekKey], constraints.maxSessionsPerWeek, constraints.offDays);
        if (issues.length) {
          console.warn('[api/chat] Écart au nombre de séances/semaine déclaré après ajustement chat:', issues.map((i) => i.message));
        }
      });
    }

    return res.status(200).json({ reply, updatedWorkouts });
  } catch (error) {
    // Log complet côté serveur (visible dans Vercel → Deployments → Functions → Logs)
    console.error('[api/chat] error:', {
      code: error?.code,
      message: error?.message,
      stack: error?.stack,
    });

    const code = error?.code || 'UNKNOWN';
    const reply = ERROR_MESSAGES[code] || ERROR_MESSAGES.UNKNOWN;

    // On répond toujours 200 avec un message clair : l'app ne doit jamais planter côté client,
    // même quand le service IA est en panne.
    return res.status(200).json({ reply, updatedWorkouts: workouts });
  }
}
