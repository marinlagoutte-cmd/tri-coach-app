// pages/api/notifications/weekly-recap.js
//
// Cible des deux tâches planifiées Vercel Cron définies dans vercel.json — PAS un
// endpoint appelé par l'app. Calcule et envoie à chaque athlète abonné (table
// push_subscriptions) une notification "récap de la semaine", chaque dimanche à
// 19h heure de PARIS.
//
// POURQUOI DEUX HORAIRES CRON POUR UN SEUL "19h Paris" : Vercel Cron ne raisonne
// qu'en UTC, or Paris alterne entre UTC+1 (hiver, CET) et UTC+2 (été, CEST) selon
// le changement d'heure. vercel.json déclare donc DEUX horaires (17h et 18h UTC,
// chacun une fois par semaine — compatible avec la limite du plan Hobby : 1
// exécution/jour max par cron), et c'est CETTE fonction qui vérifie l'heure LOCALE
// réelle à Paris (getParisLocalHour) pour n'envoyer qu'au bon moment : l'autre
// invocation de la semaine repart aussitôt sans rien envoyer (`skipped: true`).
// weekly_recap_log sert de garde-fou supplémentaire pour ne jamais envoyer deux
// fois le récap de la même semaine (retry Vercel après timeout, etc.).
import webpush from 'web-push';
import { getAdminClient, loadAthleteContext } from '../../../lib/athleteContext';
import { buildWeeklyRecap, getCurrentParisWeekStartUTC, getParisDateKey, getParisLocalHour } from '../../../lib/weeklyRecap';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT; // ex: 'mailto:toi@example.com'
const TARGET_PARIS_HOUR = 19;

export default async function handler(req, res) {
  // Vercel signe automatiquement ses propres invocations cron avec ce header dès
  // que la variable d'env CRON_SECRET est configurée (voir NOTIFICATIONS_SETUP.md)
  // — ça empêche n'importe qui de déclencher un envoi en devinant l'URL.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const parisHourNow = getParisLocalHour();
  if (parisHourNow !== TARGET_PARIS_HOUR) {
    return res.status(200).json({ skipped: true, reason: `heure Paris actuelle: ${parisHourNow}h, cible: ${TARGET_PARIS_HOUR}h` });
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    console.error('[weekly-recap] Clés VAPID manquantes — voir NOTIFICATIONS_SETUP.md');
    return res.status(503).json({ error: 'VAPID non configuré côté serveur.' });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const admin = getAdminClient();
  const now = new Date();
  const weekStartUTC = getCurrentParisWeekStartUTC(now);
  const weekStartKey = getParisDateKey(weekStartUTC); // clé de dédoublonnage (date, pas timestamp)

  const { data: subscriptions, error: subsError } = await admin.from('push_subscriptions').select('*');
  if (subsError) {
    console.error('[weekly-recap] erreur lecture abonnements:', subsError);
    return res.status(500).json({ error: 'Lecture des abonnements impossible.' });
  }

  const byUser = new Map();
  (subscriptions || []).forEach((sub) => {
    if (!byUser.has(sub.user_id)) byUser.set(sub.user_id, []);
    byUser.get(sub.user_id).push(sub);
  });

  const results = { usersNotified: 0, usersSkipped: 0, subscriptionsSent: 0, subscriptionsPruned: 0, errors: 0 };

  for (const [userId, userSubs] of byUser.entries()) {
    try {
      // Dédoublonnage : déjà envoyé pour cette semaine ? (voir doc en tête de fichier)
      const { data: existingLog } = await admin
        .from('weekly_recap_log')
        .select('user_id')
        .eq('user_id', userId)
        .eq('week_start', weekStartKey)
        .maybeSingle();
      if (existingLog) {
        results.usersSkipped += 1;
        continue;
      }

      const { data: activities, error: activitiesError } = await admin
        .from('strava_activities')
        .select('sport_type, distance_m, moving_time_s, start_date')
        .eq('user_id', userId)
        .gte('start_date', weekStartUTC.toISOString())
        .lte('start_date', now.toISOString());
      if (activitiesError) {
        console.error('[weekly-recap] erreur lecture activités pour', userId, activitiesError);
        results.errors += 1;
        continue;
      }

      const { workouts, language } = await loadAthleteContext(admin, userId);
      const plannedCount = (workouts?.N || []).filter((w) => w.type !== 'REPOS').length;
      const { title, body } = buildWeeklyRecap({ activities: activities || [], plannedCount, lang: language });

      const payload = JSON.stringify({ title, body, url: '/' });
      let sentAtLeastOnce = false;

      for (const sub of userSubs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
          sentAtLeastOnce = true;
          results.subscriptionsSent += 1;
        } catch (pushError) {
          // 404/410 = abonnement révoqué côté navigateur (désinstallation, permission
          // retirée...) — on le supprime pour ne plus jamais réessayer dessus.
          if (pushError?.statusCode === 404 || pushError?.statusCode === 410) {
            await admin.from('push_subscriptions').delete().eq('id', sub.id);
            results.subscriptionsPruned += 1;
          } else {
            console.error('[weekly-recap] échec envoi push pour', userId, pushError?.statusCode, pushError?.body);
            results.errors += 1;
          }
        }
      }

      if (sentAtLeastOnce) {
        await admin.from('weekly_recap_log').upsert({ user_id: userId, week_start: weekStartKey });
        results.usersNotified += 1;
      }
    } catch (userError) {
      console.error('[weekly-recap] erreur inattendue pour', userId, userError);
      results.errors += 1;
    }
  }

  return res.status(200).json({ weekStart: weekStartKey, ...results });
}
