export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { message, profile, workouts } = req.body;

  try {
    // Appel à Gemini / API LLM
    // On exige le retour des métriques complètes : intensity, cadence, cardio, rpe, duration, title, desc
    
    // Exemple de structure JSON attendue dans la réponse API :
    /*
      {
        "reply": "J'ai bien décalé ta séance...",
        "updatedWorkouts": {
          "N": [ ... ],
          "N+1": [ ... ]
        }
      }
    */

    return res.status(200).json({ 
      reply: "Séance mise à jour avec succès !", 
      updatedWorkouts: workouts 
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
