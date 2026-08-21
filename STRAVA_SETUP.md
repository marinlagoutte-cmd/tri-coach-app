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

## 3. Ajouter les variables dans Vercel

Vercel → ton projet → **Settings → Environment Variables** :

| Nom | Valeur |
|---|---|
| `NEXT_PUBLIC_STRAVA_CLIENT_ID` | le Client ID Strava (étape 1) |
| `STRAVA_CLIENT_SECRET` | le Client Secret Strava (étape 1) |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | une chaîne que tu inventes toi-même (ex: un mot de passe aléatoire), sert uniquement à vérifier que les appels au webhook viennent bien de Strava |
| `SUPABASE_SERVICE_ROLE_KEY` | si pas déjà fait pour `/api/delete-account` : Supabase → Project Settings → API → `service_role` (secret, jamais public) |

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

## Bon à savoir

- **Une seule tentative de correspondance automatique par activité**, basée
  sur le jour réel + le sport (voir le commentaire en tête de
  `lib/stravaMatch.js`) : si ton plan de la semaine ne correspond pas au jour
  calendaire réel (ex. tu as pris de l'avance), corrige-la manuellement depuis
  le détail de l'activité — un simple menu déroulant.
- **Le détail (carte, allure, FC, puissance)** n'est chargé que quand tu ouvres
  une activité, pour ménager le quota Strava (100 requêtes/15 min, 1000/jour
  par défaut) — ensuite mis en cache, donc gratuit à réouvrir.
- **L'analyse IA** se lance automatiquement à la réception de chaque activité
  (webhook). Si tu modifies une activité sur Strava après coup (titre, type…),
  l'app la remet à jour et relance une nouvelle analyse — ce qui consomme un
  appel IA supplémentaire à chaque modification, pas seulement au premier
  upload.
- **Déconnecter Strava** (réglages) coupe le lien et arrête les futurs imports,
  mais conserve l'historique déjà importé.
