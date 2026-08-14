export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ reply: 'Méthode non autorisée' });
  }

  const { message, profile } = req.body;
  const rawKey = process.env.GEMINI_API_KEY;

  if (!rawKey) {
    return res.status(200).json({ 
      reply: "⚠️ Clé API manquante. Ajoute GEMINI_API_KEY dans Vercel (Settings > Environment Variables) puis fais un Redeploy." 
    });
  }

  const apiKey = rawKey.trim();

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

  // Liste des modèles à tester dans l'ordre de priorité
  const modelsToTry = [
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-2.0-flash'
  ];

  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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

      if (response.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
        return res.status(200).json({ 
          reply: data.candidates[0].content.parts[0].text 
        });
      }

      if (data.error) {
        lastError = data.error.message;
        // Si le modèle n'est pas trouvé, la boucle essaye le modèle suivant
        if (data.error.message.includes('not found')) {
          continue;
        } else {
          // Si c'est une autre erreur (ex: clé invalide), on arrête la boucle
          return res.status(200).json({ reply: `❌ Erreur Google Gemini : ${data.error.message}` });
        }
      }
    } catch (err) {
      lastError = err.message;
    }
  }

  return res.status(200).json({ 
    reply: `❌ Impossible de joindre l'API Gemini. Dernier message d'erreur : ${lastError}` 
  });
}      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(200).json({ reply: `❌ Erreur Google Gemini : ${data.error.message}` });
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
