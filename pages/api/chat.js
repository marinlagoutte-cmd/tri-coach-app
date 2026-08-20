import { chatWithCoach } from '../../lib/gemini';
import { mergeWorkoutPatches, checkSessionCountCoherence } from '../../lib/workouts';
import { checkRateLimit, RATE_LIMIT_MESSAGES } from '../../lib/rateLimit';

const ERROR_MESSAGES = {
  fr: {
    NO_KEY: "⚠️ Le coach IA n'est pas encore connecté : ajoute GEMINI_API_KEY dans Vercel → Settings → Environment Variables, puis redéploie.",
    AUTH: "⚠️ La clé API Gemini semble invalide ou expirée. Vérifie sa valeur dans Vercel → Settings → Environment Variables (puis redéploie).",
    QUOTA: "⚠️ Le quota de l'API Gemini est atteint pour le moment. Réessaie dans quelques minutes.",
    MODEL_NOT_FOUND: "⚠️ Le modèle IA configuré est introuvable (peut-être renommé côté Google). J'ai enregistré ta demande, réessaie plus tard.",
    SAFETY: "⚠️ Ta demande a été bloquée par les filtres de sécurité de l'IA. Essaie de la reformuler.",
    NETWORK: "⚠️ Le service IA n'a pas répondu à temps. Réessaie dans un instant.",
    PARSE_ERROR: "⚠️ Le coach IA a renvoyé une réponse inattendue. Réessaie ta demande.",
    UNKNOWN: "Je n'ai pas réussi à traiter ta demande pour le moment, réessaie dans un instant.",
    EMPTY: "Écris-moi un message pour que je puisse t'aider.",
  },
  en: {
    NO_KEY: "⚠️ The AI coach isn't connected yet: add GEMINI_API_KEY in Vercel → Settings → Environment Variables, then redeploy.",
    AUTH: "⚠️ The Gemini API key seems invalid or expired. Check its value in Vercel → Settings → Environment Variables (then redeploy).",
    QUOTA: "⚠️ The Gemini API quota has been reached for now. Try again in a few minutes.",
    MODEL_NOT_FOUND: "⚠️ The configured AI model can't be found (it may have been renamed by Google). I've saved your request, try again later.",
    SAFETY: "⚠️ Your request was blocked by the AI's safety filters. Try rephrasing it.",
    NETWORK: "⚠️ The AI service didn't respond in time. Try again in a moment.",
    PARSE_ERROR: "⚠️ The AI coach returned an unexpected response. Try your request again.",
    UNKNOWN: "I couldn't process your request right now, try again in a moment.",
    EMPTY: 'Write me a message so I can help you.',
  },
  es: {
    NO_KEY: "⚠️ El coach IA aún no está conectado: añade GEMINI_API_KEY en Vercel → Settings → Environment Variables, y vuelve a desplegar.",
    AUTH: "⚠️ La clave de la API Gemini parece inválida o caducada. Revisa su valor en Vercel → Settings → Environment Variables (y vuelve a desplegar).",
    QUOTA: "⚠️ Se ha alcanzado la cuota de la API Gemini por ahora. Inténtalo de nuevo en unos minutos.",
    MODEL_NOT_FOUND: "⚠️ No se encuentra el modelo de IA configurado (puede que Google le haya cambiado el nombre). He guardado tu solicitud, inténtalo más tarde.",
    SAFETY: "⚠️ Tu solicitud fue bloqueada por los filtros de seguridad de la IA. Intenta reformularla.",
    NETWORK: "⚠️ El servicio de IA no respondió a tiempo. Inténtalo de nuevo en un momento.",
    PARSE_ERROR: "⚠️ El coach IA devolvió una respuesta inesperada. Vuelve a intentar tu solicitud.",
    UNKNOWN: "No he podido procesar tu solicitud ahora mismo, inténtalo de nuevo en un momento.",
    EMPTY: 'Escríbeme un mensaje para que pueda ayudarte.',
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { message, profile, workouts, trainingPlan, intent, sportType, constraints, feedbackHistory, language } = req.body || {};
  const lang = ERROR_MESSAGES[language] ? language : 'fr';
  if (!message || !String(message).trim()) {
    return res.status(400).json({ reply: ERROR_MESSAGES[lang].EMPTY, updatedWorkouts: workouts });
  }

  // Rate limit léger par IP (voir lib/rateLimit.js) : ce endpoint appelle Gemini,
  // qui a un quota quotidien limité — sans ce garde-fou, un simple bot trouvant
  // l'URL Vercel peut l'épuiser en quelques secondes pour tout le monde.
  const { allowed, retryAfterSec } = checkRateLimit(req, { id: 'chat', limit: 12, windowMs: 60_000 });
  if (!allowed) {
    return res.status(200).json({ reply: RATE_LIMIT_MESSAGES[lang](retryAfterSec), updatedWorkouts: workouts });
  }

  try {
    const { reply, patches } = await chatWithCoach({ message, profile, workouts, trainingPlan, intent, sportType, constraints, feedbackHistory, language: lang });
    let updatedWorkouts = mergeWorkoutPatches(workouts, patches, profile);

    // Si le coach a ajouté/retiré une séance sans que ce soit demandé (intent absent),
    // on ne force PAS de correction déterministe ici (contrairement à la génération
    // initiale) : un ajustement ponctuel demandé par l'athlète peut légitimement
    // changer le nombre de séances pour CETTE semaine. On se contente de signaler
    // l'écart dans les logs pour diagnostic, sans jamais l'imposer silencieusement.
    if (constraints?.maxSessionsPerWeek && patches?.length) {
      ['N', 'N+1'].forEach((weekKey) => {
        const issues = checkSessionCountCoherence(updatedWorkouts[weekKey], constraints.maxSessionsPerWeek, constraints.offDays);
        if (issues.length) {
          console.warn('[api/chat] Écart au nombre de séances/semaine déclaré après ajustement chat:', issues.map((i) => i.message));
        }
      });
    }

    return res.status(200).json({ reply, updatedWorkouts });
  } catch (error) {
    // Log complet côté serveur (visible dans Vercel → Deployments → Functions → Logs)
    console.error('[api/chat] error:', {
      code: error?.code,
      message: error?.message,
      stack: error?.stack,
    });

    const code = error?.code || 'UNKNOWN';
    const reply = ERROR_MESSAGES[lang][code] || ERROR_MESSAGES[lang].UNKNOWN;

    // On répond toujours 200 avec un message clair : l'app ne doit jamais planter côté client,
    // même quand le service IA est en panne.
    return res.status(200).json({ reply, updatedWorkouts: workouts });
  }
}
