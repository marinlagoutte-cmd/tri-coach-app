export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ reply: 'Méthode non autorisée' });
  }

  const { message, profile } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(200).json({ 
      reply: "⚠️ Clé API manquante dans Vercel (GEMINI_API_KEY)." 
    });
  }

  const prompt = `
Tu es un coach expert en triathlon (format Sprint / D3).
Profil athlète :
- Nom: ${profile?.name || 'Marin'}
- Poids: ${profile?.weight || 90} kg
- VMA: ${profile?.vma || 20} km/h | FTP: ${profile?.ftp || 549} W | Natation 100m: ${profile?.nat100 || '1:38'}
- Style: Direct, exigeant, cash. Signale immédiatement le sur-entraînement et le volume poubelle.

Règles strictes :
1. Donner des INTENTIONS DE NAGE et RPE au lieu de chronos fixes.
2. Détailler les récups exactes à vélo.

Message athlète : ${message}
`;

  try {
    // Utilisation directe du modèle exact validé par ton test : gemini-2.5-flash
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey.trim()}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(200).json({ reply: `❌ Erreur API (${data.error.code}) : ${data.error.message}` });
    }

    const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!replyText) {
      return res.status(200).json({ reply: "❌ Réponse vide reçue de l'IA." });
    }

    return res.status(200).json({ reply: replyText });

  } catch (err) {
    return res.status(200).json({ reply: `❌ Erreur serveur : ${err.message}` });
  }
}
