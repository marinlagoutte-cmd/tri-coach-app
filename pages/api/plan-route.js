// pages/api/plan-route.js
//
// Planificateur de parcours vélo — demande explicite de l'athlète : depuis un point de
// départ et une distance, tracer une boucle qui optimise le vent (dos/face) et tient
// compte des routes populaires (Strava + réseau cyclable OSM), avec la même IA que le
// reste de l'app (Gemini + Groq) pour le choix final et la stratégie course.
//
// ORCHESTRATION (voir en-tête des modules pour le détail de chaque étape) :
//   1. lib/routing.js       — génère N boucles candidates (OpenRouteService, round-trip)
//   2. lib/routePlanning.js — score chaque candidat sur le vent (Open-Meteo, même méthode
//                             que components/WeatherRadarMap.js) et la popularité
//   3. lib/strava.js + lib/osmCycleRoutes.js — les deux sources de popularité (voir
//                             lib/routePlanning.js pour pourquoi les deux, pas une seule)
//   4. lib/coGeneration.js:coPickRoute — Gemini + Groq valident/choisissent + narrent
//   5. lib/gpx.js:buildGPX  — export du parcours vainqueur
//
// Le compte Strava est OPTIONNEL ici (contrairement à pages/api/strava/sync.js) : si
// l'athlète n'a pas lié Strava, ou si le token est absent/invalide, on continue avec la
// seule popularité OSM plutôt que de bloquer toute la fonctionnalité — cohérent avec le
// reste de l'app, qui ne bloque jamais un athlète faute d'une intégration optionnelle.
import { fetchRoundTripCandidates } from '../../lib/routing';
import { scoreRouteWind, routeBoundingBox, coverageFraction, combinePopularityScore, rankCandidates } from '../../lib/routePlanning';
import { exploreSegments, fetchSegmentDetail, ensureValidStravaToken } from '../../lib/strava';
import { fetchOsmCycleNetworkPoints } from '../../lib/osmCycleRoutes';
import { buildGPX } from '../../lib/gpx';
import { coPickRoute } from '../../lib/coGeneration';
import { getAdminClient } from '../../lib/athleteContext';
import { checkRateLimit, RATE_LIMIT_MESSAGES } from '../../lib/rateLimit';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const CANDIDATE_COUNT = 4;
// Nombre de segments Strava (les plus "notables" renvoyés par explore, déjà trié par
// Strava) dont on va chercher le détail (effort_count) — voir lib/strava.js:fetchSegmentDetail,
// un appel réseau par segment donc volontairement limité.
const SEGMENT_DETAIL_LIMIT = 8;

/**
 * Récupère un token Strava valide pour cet utilisateur, ou `null` si non lié/non
 * configuré — jamais une erreur bloquante (voir commentaire d'en-tête).
 */
async function tryGetStravaToken(admin, userId) {
  try {
    const { data: tokenRow } = await admin
      .from('strava_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (!tokenRow) return null;
    const { accessToken, refreshToken, expiresAt, refreshed } = await ensureValidStravaToken({
      accessToken: tokenRow.access_token,
      refreshToken: tokenRow.refresh_token,
      expiresAt: tokenRow.expires_at,
    });
    if (refreshed) {
      await admin.from('strava_tokens').update({
        access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt, updated_at: new Date().toISOString(),
      }).eq('user_id', userId);
    }
    return accessToken;
  } catch (e) {
    console.warn('[plan-route] Strava token indisponible, poursuite sans:', e?.message || e);
    return null;
  }
}

/**
 * Score de popularité Strava [0,1] pour un candidat : explore les segments dans la bbox du
 * TRACÉ COMPLET une seule fois (partagée entre tous les candidats qui se chevauchent
 * géographiquement — économise des appels), pondère chaque segment par sa fréquentation
 * réelle (effort_count, via fetchSegmentDetail sur les plus significatifs), puis mesure la
 * fraction du tracé de CE candidat qui passe à proximité de segments pondérés.
 */
async function scoreStravaPopularity(accessToken, points) {
  if (!accessToken) return { score: 0, weightedPoints: [], available: false };
  try {
    const bbox = routeBoundingBox(points, 0.02);
    const segments = await exploreSegments(accessToken, bbox, 'riding');
    if (!segments.length) return { score: 0, weightedPoints: [], available: true };

    // Détail (effort_count) sur les segments les plus prometteurs uniquement (déjà triés
    // par Strava dans l'ordre de pertinence pour la zone).
    const toDetail = segments.slice(0, SEGMENT_DETAIL_LIMIT);
    const details = await Promise.allSettled(toDetail.map((s) => fetchSegmentDetail(accessToken, s.id)));

    // Un point de référence PAR TRANCHE DE 200 EFFORTS sur le segment (répété), plutôt
    // qu'un point unique par segment : un segment très fréquenté "pèse" alors plus lourd
    // dans coverageFraction qu'un segment anecdotique au même endroit géographique — sans
    // avoir à réécrire coverageFraction pour gérer une pondération explicite.
    const weightedPoints = [];
    details.forEach((r, i) => {
      const seg = toDetail[i];
      const effortCount = r.status === 'fulfilled' ? (r.value?.effort_count || 0) : 0;
      const mid = seg.start_latlng && seg.end_latlng
        ? { lat: (seg.start_latlng[0] + seg.end_latlng[0]) / 2, lon: (seg.start_latlng[1] + seg.end_latlng[1]) / 2 }
        : null;
      if (!mid) return;
      const weight = Math.max(1, Math.round(effortCount / 200));
      for (let w = 0; w < weight; w++) weightedPoints.push(mid);
    });

    return { score: weightedPoints.length ? 1 : 0, weightedPoints, available: true };
  } catch (e) {
    console.warn('[plan-route] Strava segments indisponibles, poursuite sans:', e?.message || e);
    return { score: 0, weightedPoints: [], available: false };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { accessToken: supabaseAccessToken, startLat, startLon, startPlaceName, distanceKm, avgSpeedKmh, departure, language } = req.body || {};
  const lang = language || 'fr';

  if (!Number.isFinite(startLat) || !Number.isFinite(startLon)) {
    return res.status(400).json({ error: 'Point de départ invalide.' });
  }
  if (!Number.isFinite(distanceKm) || distanceKm < 5 || distanceKm > 300) {
    return res.status(400).json({ error: 'Distance invalide (entre 5 et 300km).' });
  }

  const { allowed, retryAfterSec } = checkRateLimit(req, { id: 'plan-route', limit: 6, windowMs: 5 * 60_000 });
  if (!allowed) {
    return res.status(429).json({ error: RATE_LIMIT_MESSAGES[lang] ? RATE_LIMIT_MESSAGES[lang](retryAfterSec) : RATE_LIMIT_MESSAGES.fr(retryAfterSec) });
  }

  const start = { lat: startLat, lon: startLon };
  const avgSpeed = Number.isFinite(avgSpeedKmh) && avgSpeedKmh > 0 ? avgSpeedKmh : 28;
  const departureDate = departure ? new Date(departure) : new Date();

  try {
    // 1) Candidats géométriques (OpenRouteService) — voir lib/routing.js.
    const { candidates: rawCandidates, errors: routingErrors } = await fetchRoundTripCandidates(start, distanceKm, CANDIDATE_COUNT);

    // 2) Token Strava optionnel (voir commentaire d'en-tête — jamais bloquant).
    let stravaAccessToken = null;
    if (supabaseAccessToken && supabaseUrl && anonKey) {
      try {
        const authClient = createClient(supabaseUrl, anonKey);
        const { data: userData } = await authClient.auth.getUser(supabaseAccessToken);
        if (userData?.user?.id) {
          const admin = getAdminClient();
          stravaAccessToken = await tryGetStravaToken(admin, userData.user.id);
        }
      } catch (e) {
        console.warn('[plan-route] Session Supabase invalide, poursuite sans Strava:', e?.message || e);
      }
    }

    // 3) Popularité Strava : calculée UNE FOIS sur la bbox englobant TOUS les candidats
    // (ils partent tous du même point et font une distance similaire, donc se chevauchent
    // largement) plutôt qu'un appel par candidat — économise le quota Strava.
    const allPoints = rawCandidates.flatMap((c) => c.points);
    const globalBbox = routeBoundingBox(allPoints, 0.02);
    const [stravaPop, osmPoints] = await Promise.all([
      scoreStravaPopularity(stravaAccessToken, allPoints),
      fetchOsmCycleNetworkPoints(globalBbox).catch((e) => {
        console.warn('[plan-route] Réseau cyclable OSM indisponible, poursuite sans:', e?.message || e);
        return [];
      }),
    ]);

    // 4) Score vent + popularité PAR candidat.
    const scored = await Promise.all(rawCandidates.map(async (c) => {
      const wind = await scoreRouteWind(c.points, avgSpeed, departureDate);
      const samples = wind.samples;
      const stravaCoverage = stravaPop.weightedPoints.length ? coverageFraction(samples, stravaPop.weightedPoints, 0.15) : 0;
      const osmCoverage = osmPoints.length ? coverageFraction(samples, osmPoints, 0.1) : 0;
      const popularityScore = combinePopularityScore(stravaCoverage, osmCoverage);
      return { ...c, wind, popularityScore, stravaCoverage, osmCoverage };
    }));

    const ranked = rankCandidates(scored);

    // 5) Choix final + stratégie course par les deux IA (voir lib/coGeneration.js:coPickRoute)
    // — sur les 3 meilleurs seulement (prompt plus léger, l'essentiel du tri est déjà fait
    // déterministiquement, voir lib/gemini.js:pickBestRouteWithAI pour le détail du rôle de l'IA ici).
    const topCandidates = ranked.slice(0, 3);
    let aiResult;
    try {
      aiResult = await coPickRoute({ candidates: topCandidates, startPlaceName, distanceKm, language: lang });
    } catch (e) {
      console.warn('[plan-route] Double-check IA indisponible, candidat le mieux classé retenu sans stratégie:', e?.message || e);
      aiResult = { pickedIndex: 0, strategyNote: '', doubleCheckNote: "Double-check IA indisponible cette fois — candidat le mieux classé par le score déterministe retenu directement." };
    }

    const winnerIndex = Math.min(Math.max(aiResult.pickedIndex ?? 0, 0), topCandidates.length - 1);

    // On renvoie DÉSORMAIS les 3 candidats complets (tracé + vent échantillon par
    // échantillon + GPX), pas juste le vainqueur + un résumé des 2 autres — demande
    // explicite de l'athlète : pouvoir naviguer d'un candidat à l'autre (flèches) côté
    // client, avec à chaque fois la carte, les flèches de vent et le GPX à jour, sans
    // ré-appeler l'API. `winnerIndex` indique lequel des 3 est le choix retenu par le
    // double-check IA (voir lib/coGeneration.js:coPickRoute), affiché en premier/mis en
    // avant côté client mais les 2 autres restent immédiatement consultables.
    const candidates = topCandidates.map((c) => ({
      points: c.points.map((p) => ({ lat: p.lat, lon: p.lon, ele: p.ele ?? null })),
      distanceKm: Math.round(c.distanceKm * 10) / 10,
      ascentM: c.ascentM,
      wind: {
        distTailKm: c.wind.distTailKm,
        distHeadKm: c.wind.distHeadKm,
        distCrossKm: c.wind.distCrossKm,
        netScore: c.wind.netScore,
        // Échantillons allégés pour l'affichage des flèches de vent sur la carte
        // (components/RoutePlannerMap.js) — on ne garde que ce qui est utile au rendu,
        // pas les champs internes de scoring (heading brut, etc.).
        samples: c.wind.samples
          .filter((s) => s.impact)
          .map((s) => ({
            lat: s.lat,
            lon: s.lon,
            distKm: Math.round(s.distKm * 10) / 10,
            windSpeed: Number.isFinite(s.windSpeed) ? Math.round(s.windSpeed) : null,
            windDir: s.windDir ?? null,
            impactType: s.impact.type,
            eta: s.eta.toISOString(),
          })),
      },
      popularityScore: c.popularityScore,
      compositeScore: c.compositeScore,
      gpx: buildGPX(c.points, `Parcours vélo ${Math.round(c.distanceKm)}km`),
    }));

    return res.status(200).json({
      candidates,
      winnerIndex,
      strategyNote: aiResult.strategyNote,
      doubleCheckNote: aiResult.doubleCheckNote,
      stravaAvailable: stravaPop.available,
      warnings: routingErrors.length ? [`${routingErrors.length} candidat(s) écarté(s) (OpenRouteService n'a pas pu générer de boucle viable pour cette graine).`] : [],
    });
  } catch (e) {
    console.error('[plan-route] error:', e?.code, e?.message || e);
    // DIAGNOSTIC PRÉCIS (plutôt qu'un message générique unique) : sans ça, impossible de
    // distinguer "clé ORS absente/invalide", "quota épuisé" et "aucune boucle viable pour ce
    // point de départ" — trois causes très différentes qui demandent une action différente
    // de l'athlète, et qu'on ne peut pas diagnostiquer à distance sans les logs Vercel.
    let message;
    let status = 500;
    if (e?.code === 'NO_KEY') {
      message = e.message;
      status = 503;
    } else if (e?.code === 'AUTH') {
      message = "OpenRouteService a refusé la clé API (401/403) — vérifie qu'ORS_API_KEY est bien copiée sans espace dans Vercel → Settings → Environment Variables, et que le déploiement a bien pris effet après l'ajout.";
      status = 503;
    } else if (e?.code === 'QUOTA') {
      message = 'Quota OpenRouteService atteint (2000 requêtes/jour en offre gratuite) — réessaie plus tard ou demain.';
      status = 429;
    } else if (/aucune boucle/i.test(e?.message || '')) {
      message = `${e.message} Essaie une distance différente ou un point de départ légèrement différent (zone rurale/isolée : OpenRouteService peut ne pas trouver de boucle viable).`;
      status = 502;
    } else {
      message = `La génération du parcours a échoué (${e?.message || 'erreur inconnue'}). Vérifie le point de départ et réessaie dans un instant.`;
    }
    return res.status(status).json({ error: message });
  }
}
