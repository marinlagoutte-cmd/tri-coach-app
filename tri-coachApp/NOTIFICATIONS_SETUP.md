# Notifications push — Récap de la semaine

Envoie chaque **dimanche à 19h (heure de Paris)** une notification système
(même app fermée) résumant les séances réellement faites dans la semaine
(distance, durée, nombre de séances par discipline, prévu vs réalisé) — basé
sur les vraies activités Strava importées, jamais une estimation.

Nécessite Supabase déjà configuré (`SUPABASE_SETUP.md`) et, pour un vrai
contenu de récap, Strava déjà connecté (`STRAVA_SETUP.md`) — sans Strava, la
notification part quand même mais indique "aucune séance importée".

Tant que les étapes ci-dessous ne sont pas faites, la cloche 🔔 dans le header
de l'app reste invisible (aucune fonctionnalité cassée, juste masquée).

## 1. Créer les tables Supabase

Dans Supabase → **SQL Editor** → New query → colle le contenu de
`supabase-schema-notifications.sql` → Run.

Ça crée deux tables :
- `push_subscriptions` : un abonnement par appareil installé (jamais lisible
  depuis le navigateur — uniquement via les routes serveur, clé service_role).
- `weekly_recap_log` : empêche un double envoi du récap d'une même semaine.

## 2. Générer une paire de clés VAPID

Ces clés identifient TON serveur auprès des services push des navigateurs
(Google/Mozilla/Apple) — à générer une seule fois, jamais à partager.

```bash
npx web-push generate-vapid-keys
```

Ça affiche deux valeurs : `Public Key` et `Private Key`.

## 3. Variables d'environnement (Vercel → Settings → Environment Variables)

| Variable                        | Valeur                                              |
|----------------------------------|------------------------------------------------------|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`   | la `Public Key` générée à l'étape 2                  |
| `VAPID_PRIVATE_KEY`              | la `Private Key` générée à l'étape 2 (secret, jamais `NEXT_PUBLIC_*`) |
| `VAPID_SUBJECT`                  | `mailto:ton-email@exemple.com` (contact technique exigé par la spec Web Push) |
| `SUPABASE_SERVICE_ROLE_KEY`      | déjà nécessaire pour Strava — réutilisée telle quelle |
| `CRON_SECRET`                    | une chaîne aléatoire longue, ex: générée via `openssl rand -hex 32` |

`CRON_SECRET` sécurise l'endpoint : Vercel ajoute automatiquement l'en-tête
`Authorization: Bearer <CRON_SECRET>` à ses propres appels cron dès que cette
variable existe, ce qui empêche quiconque d'autre de déclencher un envoi en
devinant l'URL.

Redéploie une fois ces variables ajoutées.

## 4. Le déclenchement "dimanche 19h"

Défini dans `vercel.json` (déjà en place, rien à faire) :

```json
"crons": [
  { "path": "/api/notifications/weekly-recap", "schedule": "0 17 * * 0" },
  { "path": "/api/notifications/weekly-recap", "schedule": "0 18 * * 0" }
]
```

Vercel Cron ne connaît que l'UTC, et Paris alterne entre UTC+1 (hiver) et
UTC+2 (été) — d'où deux horaires UTC (17h et 18h), un pour chaque saison.
`pages/api/notifications/weekly-recap.js` vérifie l'heure LOCALE réelle à
Paris à chaque invocation et n'envoie que si elle vaut bien 19h ; l'autre
invocation de la semaine repart sans rien faire. Aucune action nécessaire à
chaque changement d'heure.

**Limite du plan Vercel Hobby** : l'horaire exact d'un cron peut être décalé
de quelques minutes par Vercel (pas de garantie à la seconde près) — sans
impact pratique pour un récap hebdomadaire.

## 5. Utilisation dans l'app

Une fois connecté (compte Supabase), une cloche 🔔 apparaît dans le header,
en haut à droite, avec un point orange tant que le récap n'est pas encore
activé sur cet appareil. Un tap ouvre un petit panneau avec un bouton
"Activer" qui déclenche la demande d'autorisation système (popup natif du
téléphone/navigateur), puis crée l'abonnement.

Chaque appareil installé (téléphone, PC...) a son propre abonnement — activer
sur l'un n'active pas automatiquement les autres.
