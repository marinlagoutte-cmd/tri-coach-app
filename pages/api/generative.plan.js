import { generatePlanWithAI } from '../../lib/gemini';
import { ensureCompleteWorkouts, getIncompleteWorkouts } from '../../lib/workouts';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Méthode non autorisée' });
  }

  try {
    const { wizardData, profile } = req.body;

    if (!wizardData?.targetDate || !profile) {
      return res.status(400).json({ error: 'wizardData et profile requis' });
    }

    const { trainingPlan, workouts } = await generatePlanWithAI({ wizardData, profile });
    const enriched = ensureCompleteWorkouts(workouts, profile);
    const incomplete = getIncompleteWorkouts(enriched);

    return res.status(200).json({
      trainingPlan,
      workouts: enriched,
      incompleteCount: incomplete.length,
    });
  } catch (error) {
    console.error('generate-plan error:', error);
    return res.status(500).json({
      error: error.message || 'Erreur lors de la génération du plan',
    });
  }
}
