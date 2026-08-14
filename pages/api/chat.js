export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ reply: 'Méthode non autorisée' });

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(200).json({ reply: "⚠️ GEMINI_API_KEY manquante." });
  }

  try {
    // Interrogation directe de l'API Google pour lister les modèles disponibles
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim()}`);
    const data = await response.json();

    if (data.error) {
      return res.status(200).json({ reply: `❌ Erreur Google (${data.error.code}) : ${data.error.message}` });
    }

    if (!data.models) {
      return res.status(200).json({ reply: "⚠️ Aucun modèle renvoyé par l'API pour cette clé." });
    }

    // Extraction des noms de modèles supportant la génération de contenu
    const availableModels = data.models
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => m.name.replace('models/', ''))
      .join('\n• ');

    return res.status(200).json({ 
      reply: `✅ Connexion réussie !\n\nVoici les noms exacts des modèles disponibles pour ta clé :\n• ${availableModels}` 
    });

  } catch (err) {
    return res.status(200).json({ reply: `❌ Erreur serveur : ${err.message}` });
  }
}
