export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { message, profile, history } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ reply: "Clé API Gemini non configurée sur Vercel." });
  }

  const systemInstruction = `
Tu es un coach expert en triathlon (format Sprint / D3).
Profil athlète :
- Nom: ${profile.name || 'Athlète'}
- Poids: ${profile.weight || 90} kg
- VMA: ${profile.vma || 18} km/h | FTP: ${profile.ftp || 350} W | Natation 100m: ${profile.nat100 || '1:38'}
- Style de coaching demandé: ${profile.tone === 'cash' ? 'Direct, exigeant, cash. Signale immédiatement le sur-entraînement et le volume poubelle.' : 'Pédagogique et encourageant.'}

Règles strictes :
1. Donner toujours des INTENTIONS DE NAGE et RPE au lieu de simples chronos fixes en natation.
2. Détailler systématiquement les recups exactes à vélo.
`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `${systemInstruction}\n\nMessage athlète : ${message}` }] }
        ]
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ reply: `Erreur API Gemini : ${data.error.message}` });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Pas de réponse générée par l'IA.";
    return res.status(200).json({ reply });
  } catch (error) {
    return res.status(500).json({ reply: "Erreur de connexion au serveur." });
  }
}
