export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ reply: 'Méthode non autorisée' });
  }

  const { message, profile } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(200).json({ reply: "⚠️ Clé API manquante dans Vercel (GEMINI_API_KEY)." });
  }

  const prompt = `
Tu es un coach expert en triathlon (format Sprint / D3).
Profil athlète :
- Nom: ${profile?.name || 'Marin'}
- Poids: ${profile?.weight || 90} kg
- VMA: ${profile?.vma || 20} km/h | FTP: ${profile?.ftp || 350} W | Natation 100m: ${profile?.nat100 || '1:38'}
- Style: Direct, exigeant, cash. Signale immédiatement le sur-entraînement et le volume poubelle.

Règles de formatage STRICTES pour la lisibilité :
1. Présente TOUJOURS le corps principal de la séance sous forme de TABLEAU MARKDOWN propre avec les colonnes suivantes :
   | Bloc / Partie | Exercice / Contenu | Intensité (RPE / Watts / %VMA) | Récupération |
2. Utilise des listes à puces claires pour l'Échauffement et le Retour au calme.
3. Donne des INTENTIONS DE NAGE et RPE au lieu de chronos fixes en natation.
4. Détailler les récups exactes à vélo.
5. Sois très concis et lisible en un coup d'œil sur mobile.

Message athlète : ${message}
`;

  const modelsToTry = ['gemini-flash-latest', 'gemini-pro-latest', 'gemini-flash-lite-latest'];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  let lastError = null;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal: controller.signal
        });
        clearTimeout(timeout);

        const data = await response.json();

        if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
          return res.status(200).json({ reply: data.candidates[0].content.parts[0].text });
        }

        if (data.error) {
          lastError = `[${model}] ${data.error.code} — ${data.error.message}`;
          if (data.error.code === 503 || data.error.code === 429) {
            await sleep(500 * Math.pow(2, attempt));
            continue;
          }
          break;
        }
      } catch (err) {
        lastError = `[${model}] ${err.name === 'AbortError' ? 'Timeout (15s)' : err.message}`;
        await sleep(500 * Math.pow(2, attempt));
      }
    }
  }

  return res.status(200).json({
    reply: `❌ Le coach est temporairement indisponible (surcharge Google). Réessaie dans une minute. Détail technique : ${lastError}`
  });
}
