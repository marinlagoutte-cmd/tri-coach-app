import { chatWithCoach } from '../../lib/gemini';
import { mergeWorkoutPatches } from '../../lib/workouts';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { message, profile, workouts, trainingPlan } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ reply: 'Écris-moi un message pour que je puisse t\'aider.', updatedWorkouts: workouts });
  }

  try {
    const { reply, patches } = await chatWithCoach({ message, profile, workouts, trainingPlan });
    const updatedWorkouts = mergeWorkoutPatches(workouts, patches, profile);
    return res.status(200).json({ reply, updatedWorkouts });
  } catch (error) {
    console.error('chat error:', error?.message || error);
    // Detect model missing / 404 style messages
    const msg = String(error?.message || '').toLowerCase();
    if (msg.includes('aucun modèle disponible') || msg.includes('not found') || msg.includes('404')) {
      return res.status(503).json({
        reply: "⚠️ Le coach IA est temporairement indisponible (modèle introuvable). J'ai enregistré ta demande et tu peux réessayer plus tard.",
        updatedWorkouts: workouts,
      });
    }

    if (/clé api/i.test(String(error?.message || ''))) {
      return res.status(200).json({
        reply: "⚠️ Le coach IA n'est pas encore connecté : ajoute GOOGLE_GENERATIVE_AI_API_KEY dans ton fichier .env.local.",
        updatedWorkouts: workouts,
      });
    }

    return res.status(200).json({
      reply: "Je n'ai pas réussi à traiter ta demande pour le moment, réessaie dans un instant.",
      updatedWorkouts: workouts,
    });
  }
}
