// pages/api/validate-zones.js
//
// Demande explicite de l'athlète : avant d'enregistrer des bornes de zone éditées à la
// main (basse ET haute désormais indépendantes, voir components/ZoneCharts.js), une
// vérification de non-chevauchement doit avoir lieu, ET les deux IA du protocole de
// co-génération (voir lib/coGeneration.js) doivent "s'accorder" pour confirmer que les
// bornes proposées sont physiologiquement possibles. Ce endpoint fait les deux, dans cet
// ordre :
//   1. Re-vérifie le non-chevauchement de façon déterministe côté serveur (findZoneOverlaps,
//      lib/zones.js) — jamais uniquement confiance dans le contrôle déjà fait côté client
//      (voir components/ZoneCharts.js), qui reste la première ligne de défense pour un
//      retour instantané, mais un appel réseau direct à cette API pourrait le contourner.
//   2. Seulement si (1) passe : appelle coCheckZoneBounds (Gemini + Groq) pour le
//      jugement de plausibilité physiologique, qui ne peut pas être déterministe.
import { findZoneOverlaps } from '../../lib/zones';
import { coCheckZoneBounds } from '../../lib/coGeneration';
import { checkRateLimit, RATE_LIMIT_MESSAGES } from '../../lib/rateLimit';

const ERROR_MESSAGES = {
  fr: {
    NO_KEY: "⚠️ Le double-check IA n'est pas encore connecté : ajoute GEMINI_API_KEY/GROQ_API_KEY dans Vercel → Settings → Environment Variables, puis redéploie.",
    UNKNOWN: "Je n'ai pas réussi à vérifier ces zones avec l'IA pour le moment, réessaie dans un instant.",
  },
  en: {
    NO_KEY: "⚠️ The AI double-check isn't connected yet: add GEMINI_API_KEY/GROQ_API_KEY in Vercel → Settings → Environment Variables, then redeploy.",
    UNKNOWN: "I couldn't check these zones with AI right now, try again in a moment.",
  },
  es: {
    NO_KEY: "⚠️ La doble verificación IA aún no está conectada: añade GEMINI_API_KEY/GROQ_API_KEY en Vercel → Settings → Environment Variables, y vuelve a desplegar.",
    UNKNOWN: "No he podido verificar estas zonas con la IA ahora mismo, inténtalo de nuevo en un momento.",
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { zones, metric, discipline, profile, language } = req.body || {};
  const lang = ERROR_MESSAGES[language] ? language : 'fr';

  if (!Array.isArray(zones) || !zones.length) {
    return res.status(400).json({ ok: false, overlapIssues: ['Aucune zone à vérifier.'] });
  }

  // (1) Re-vérification déterministe du chevauchement, côté serveur — voir en-tête.
  const overlapIssues = findZoneOverlaps(zones);
  if (overlapIssues.length > 0) {
    return res.status(200).json({ ok: false, overlapIssues });
  }

  // Rate limit léger par IP (voir lib/rateLimit.js) : ce endpoint appelle Gemini + Groq,
  // comme /api/chat et /api/nutrition.
  const { allowed, retryAfterSec } = checkRateLimit(req, { id: 'validate-zones', limit: 12, windowMs: 60_000 });
  if (!allowed) {
    return res.status(200).json({ ok: false, aiError: RATE_LIMIT_MESSAGES[lang](retryAfterSec) });
  }

  try {
    // (2) Double-check IA (Gemini + Groq) de plausibilité physiologique — voir
    // coCheckZoneBounds, lib/coGeneration.js.
    const { plausible, note, doubleCheckNote } = await coCheckZoneBounds({ zones, metric, discipline, profile, language: lang });
    return res.status(200).json({ ok: true, overlapIssues: [], plausible, note, doubleCheckNote });
  } catch (err) {
    console.error('[validate-zones] error:', { code: err?.code, message: err?.message });
    const message = err?.code === 'NO_KEY' ? ERROR_MESSAGES[lang].NO_KEY : ERROR_MESSAGES[lang].UNKNOWN;
    // Ne bloque jamais totalement l'athlète si l'IA est indisponible : le contrôle de
    // chevauchement déterministe (le plus important pour l'intégrité des données) a déjà
    // réussi à ce stade — on renvoie donc `ok: true` avec `plausible: null` (indéterminé)
    // plutôt qu'un blocage complet, l'UI affichant alors une note transparente.
    return res.status(200).json({ ok: true, overlapIssues: [], plausible: null, note: '', doubleCheckNote: message });
  }
}
