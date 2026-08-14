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
  - Nom: ${profile.name}
  - Poids: ${profile.weight} kg
  - VMA: ${profile.vma} km/h | FTP: ${profile.ftp} W | Natation 100m: ${profile.nat100}
  - Style de coaching demandé: ${profile.tone === 'cash' ? 'Direct, exigeant, cash. Signale immédiatement le sur-entraînement et le volume poubelle.' : 'Pédagogique et encourageant.'}
  
  Règles strictes :
  1. Donner toujours des INTENTIONS DE NAGE et RPE au lieu de simples chronos fixes en natation.
  2. Détailler systématiquement les récups exactes à vélo.
  `;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: systemInstruction }] },
          ...history.map(h => ({
            role: h.role === 'user' ? 'user' : 'model',
            parts: [{ text: h.text }]
          })),
          { role: 'user', parts: [{ text: message }] }
        ]
      })
    });

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Désolé, problème d'analyse.";
    return res.status(200).json({ reply });
  } catch (error) {
    return res.status(500).json({ reply: "Erreur serveur API." });
  }
}
