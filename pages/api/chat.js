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
    const isNoKey = /Clé API Gemini manquante/.test(error.message || '');
    console.error('chat error:', error);
    return res.status(200).json({
      reply: isNoKey
        ? "⚠️ Le coach IA n'est pas encore connecté : ajoute GOOGLE_GENERATIVE_AI_API_KEY dans ton fichier .env.local."
        : "Je n'ai pas réussi à traiter ta demande, réessaie dans un instant.",
      updatedWorkouts: workouts,
    });
  }
}
