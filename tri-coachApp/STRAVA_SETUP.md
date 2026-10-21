# Connecter Strava (activités auto + analyse IA)

Nécessite que Supabase soit déjà configuré (voir `SUPABASE_SETUP.md`) : les
comptes Strava sont liés à un compte Tri Coach, donc à une session Supabase.

Tant que ces étapes ne sont pas faites, le bloc "Strava" reste simplement
masqué dans les réglages de l'app — rien d'autre ne change.

## 1. Créer une app Strava

1. https://www.strava.com/settings/api → crée une application (nom libre,
   "Website" = l'URL de ton app Vercel, "Authorization Callback Domain" =
   le domaine de ton app **sans** `https://` ni chemin, ex: `ton-app.vercel.app`).
2. Note deux valeurs :
   - `Client ID` → ce sera `NEXT_PUBLIC_STRAVA_CLIENT_ID`
   - `Client Secret` → ce sera `STRAVA_CLIENT_SECRET` (ne JAMAIS le mettre dans
     une variable `NEXT_PUBLIC_*`, ni le committer)

## 2. Créer les tables Supabase

Dans Supabase → **SQL Editor** → New query → colle le contenu du fichier
`supabase-schema-strava.sql` fourni avec l'app → Run.

Ça crée deux tables : `strava_tokens` (jetons, jamais lisibles depuis le
navigateur) et `strava_activities` (tes activités importées, visibles
seulement par toi via RLS).

**Étape supplémentaire obligatoire (suivi matériel) :** exécute ENSUITE, dans
le même SQL Editor, le contenu de `supabase-schema-equipment.sql`. Sans cette
étape, non seulement l'onglet Outils > Matériel ne fonctionne pas, mais
**l'import de séances dans le calendrier échoue aussi silencieusement**
(la colonne `gear_id` que ce fichier ajoute à `strava_activities` est requise
par chaque insertion d'activité).

**Étape supplémentaire obligatoire (synchro automatique / onglet Records) :**
exécute ENSUITE le contenu de `supabase-migration-strava-autosync-2026-09.sql`
(ajoute deux colonnes de suivi à `strava_tokens`). Sans cette étape, le cron
horaire décrit à l'étape 4bis plantera silencieusement à chaque passage (les
colonnes qu'il essaie de lire/écrire n'existeront pas), et l'onglet Records
continuera à ne connaître que les activités déjà importées manuellement.

## 3. Ajouter les variables dans Vercel

Vercel → ton projet → **Settings → Environment Variables** :

| Nom | Valeur |
|---|---|
| `NEXT_PUBLIC_STRAVA_CLIENT_ID` | le Client ID Strava (étape 1) |
| `STRAVA_CLIENT_SECRET` | le Client Secret Strava (étape 1) |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | une chaîne que tu inventes toi-même (ex: un mot de passe aléatoire), sert uniquement à vérifier que les appels au webhook viennent bien de Strava |
| `SUPABASE_SERVICE_ROLE_KEY` | si pas déjà fait pour `/api/delete-account` : Supabase → Project Settings → API → `service_role` (secret, jamais public) |
| `CRON_SECRET` | si pas déjà fait pour le récap hebdo (`NOTIFICATIONS_SETUP.md`) : une chaîne aléatoire longue (ex: `openssl rand -hex 32`) — sécurise le cron horaire de synchro automatique décrit à l'étape 4bis, inutile de la redéfinir si déjà en place |

Redéploie une fois ces variables ajoutées (elles ne sont lues qu'au build/
démarrage de la fonction).

## 4. Créer l'abonnement webhook Strava (une seule fois)

Strava n'a pas d'interface graphique pour ça — c'est un unique appel API à
faire depuis ton ordinateur (terminal), une fois l'app déployée en prod avec
les variables ci-dessus :

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=TON_CLIENT_ID \
  -F client_secret=TON_CLIENT_SECRET \
  -F callback_url=https://ton-app.vercel.app/api/strava/webhook \
  -F verify_token=LE_MEME_STRAVA_WEBHOOK_VERIFY_TOKEN_QUE_DANS_VERCEL
```

Strava va immédiatement appeler `callback_url` en GET pour vérifier
(`pages/api/strava/webhook.js` y répond automatiquement) — si ça échoue,
vérifie que le déploiement est bien en ligne et que les 3 valeurs
correspondent exactement à ce que tu as mis dans Vercel.

Une réponse `{"id": ...}` confirme que l'abonnement est actif. À partir de là,
**chaque activité que tu uploades sur Strava est automatiquement poussée vers
ton app** (calendrier + analyse IA), sans rien à refaire.

Pour vérifier l'abonnement plus tard : `curl -G https://www.strava.com/api/v3/push_subscriptions -d client_id=TON_CLIENT_ID -d client_secret=TON_CLIENT_SECRET`.

## 5. Se connecter dans l'app

Réglages (⚙️) → section **Strava** → "Connecter Strava" → autorise l'accès
sur la page Strava qui s'ouvre → tu es redirigé vers l'app, connecté.

## 4bis. Synchro automatique horaire (onglet Records)

Depuis la migration `supabase-migration-strava-autosync-2026-09.sql` (étape 2
ci-dessus) et `pages/api/strava/auto-sync.js`, un cron Vercel (`vercel.json`,
`0 * * * *`) tient à jour l'historique Strava de chaque athlète lié **sans
qu'il ait besoin de cliquer sur "Actualiser"** :

- La première fois qu'un athlète est lié, le cron importe TOUT son historique
  Strava en arrière-plan, par petits blocs répartis sur plusieurs passages
  horaires (pour ménager le quota Strava — voir budget dans le fichier).
  Tant que ce n'est pas fini, l'onglet Records peut encore manquer d'anciens
  records ; un message dans l'onglet l'indique.
- Une fois l'historique complet importé, le cron ne fait plus qu'une synchro
  légère (nouvelles activités depuis le dernier passage) à chaque heure.

**Limite du plan Vercel Hobby :** les Cron Jobs y sont limités à 1
exécution/JOUR maximum par entrée. Si le déploiement du cron horaire est
refusé pour cette raison, deux options : passer au plan Pro (fréquence
illimitée), ou assouplir l'horaire dans `vercel.json` (ex: `"0 */6 * * *"` =
toutes les 6h) — rien d'autre à changer côté code dans ce cas.

Rien à faire côté athlète : ce cron tourne pour tous les comptes Strava liés,
automatiquement, dès que la migration SQL est en place.

## 6. Se connecter dans l'app

Réglages (⚙️) → section **Strava** → "Connecter Strava" → autorise l'accès
sur la page Strava qui s'ouvre → tu es redirigé vers l'app, connecté.

## Bon à savoir

- **Une seule tentative de correspondance automatique par activité**, basée
  sur le jour réel + le sport (voir le commentaire en tête de
  `lib/stravaMatch.js`) : si ton plan de la semaine ne correspond pas au jour
  calendaire réel (ex. tu as pris de l'avance), corrige-la manuellement depuis
  le détail de l'activité — un simple menu déroulant.
- **Le détail (carte, allure, FC, puissance)** n'est chargé que quand tu ouvres
  une activité, pour ménager le quota Strava (100 requêtes/15 min, 1000/jour
  par défaut) — ensuite mis en cache, donc gratuit à réouvrir.
- **L'historique complet et les records** se synchronisent désormais tout
  seuls en arrière-plan (voir étape 4bis) — le bouton "Importer mes activités
  récentes" reste utile pour forcer un rattrapage immédiat (ex: juste après
  avoir lié le compte), mais n'est plus indispensable au quotidien.
- **L'analyse IA** se lance automatiquement à la réception de chaque activité
  (webhook). Si tu modifies une activité sur Strava après coup (titre, type…),
  l'app la remet à jour et relance une nouvelle analyse — ce qui consomme un
  appel IA supplémentaire à chaque modification, pas seulement au premier
  upload.
- **Déconnecter Strava** (réglages) coupe le lien et arrête les futurs imports,
  mais conserve l'historique déjà importé.
