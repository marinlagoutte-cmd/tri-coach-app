import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ reply: 'Méthode non autorisée' });

  const { message, profile } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(200).json({ reply: "⚠️ GEMINI_API_KEY manquante dans Vercel." });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey.trim());
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
Tu es un coach expert en triathlon (format Sprint / D3).
Profil athlète :
- Nom: ${profile?.name || 'Athlète'}
- Poids: ${profile?.weight || 90} kg
- VMA: ${profile?.vma || 18} km/h | FTP: ${profile?.ftp || 350} W | Natation 100m: ${profile?.nat100 || '1:38'}
- Style: Direct, exigeant, cash. Signale immédiatement le sur-entraînement et le volume poubelle.

Règles strictes :
1. Donner des INTENTIONS DE NAGE et RPE au lieu de chronos fixes.
2. Détailler les récups exactes à vélo.

Message athlète : ${message}
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return res.status(200).json({ reply: text });

  } catch (err) {
    return res.status(200).json({ reply: `❌ Erreur SDK Gemini : ${err.message}` });
  }
}
