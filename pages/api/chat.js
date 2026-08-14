export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Méthode non autorisée' });
  }

  try {
    const { message, profile, currentWorkouts } = req.body;

    const lowerMsg = (message || '').toLowerCase();
    const isModification = lowerMsg.includes('décale') || lowerMsg.includes('remplace') || lowerMsg.includes('mal');

    let responsePayload;

    if (isModification) {
      responsePayload = {
        reply: "J'ai adapté la séance de mardi pour réduire l'intensité tout en conservant le volume d'entraînement.",
        updatedWorkouts: [
          {
            week: "N",
            workoutId: "w2",
            day: "Mardi",
            type: "CYCLISME",
            title: "PMA Modérée (Adaptée)",
            duration: "1h00",
            intensity: "300W",
            desc: "Séance ajustée suite à ton message dans le chat.",
            modified: true
          }
        ]
      };
    } else {
      responsePayload = {
        reply: `Bien reçu ! Avec ta VMA de ${profile?.vma || 18} km/h et ta FTP de ${profile?.ftp || 300}W, ton planning est idéalement calibré pour ton objectif.`,
        updatedWorkouts: []
      };
    }

    return res.status(200).json(responsePayload);
  } catch (error) {
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
