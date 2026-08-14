import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const { message, profile, currentWorkouts } = await req.json();

    // Analyse simple du message pour la démonstration
    const lowerMsg = message.toLowerCase();
    const isModification = lowerMsg.includes('décale') || lowerMsg.includes('remplace') || lowerMsg.includes('mal');

    let responsePayload;

    if (isModification) {
      // Exemple de modification dynamique de la séance du mardi
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
        reply: `Bien reçu ! Avec ta VMA de ${profile.vma} km/h et ta FTP de ${profile.ftp}W, ton planning est idéalement calibré pour ton objectif.`,
        updatedWorkouts: []
      };
    }

    return NextResponse.json(responsePayload);
  } catch (error) {
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
