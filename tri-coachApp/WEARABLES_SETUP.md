# Récupération automatique (VFC/sommeil) — Whoop / Oura

Nécessite que Supabase soit déjà configuré (voir `SUPABASE_SETUP.md`), même
principe que Strava (`STRAVA_SETUP.md`) : les comptes Whoop/Oura sont liés à un
compte Tri Coach, donc à une session Supabase.

Tant que ces étapes ne sont pas faites, les boutons "Connecter Whoop/Oura"
restent simplement désactivés dans l'onglet Profil — rien d'autre ne change,
la saisie manuelle de VFC continue de fonctionner comme avant.

**Garmin n'est volontairement pas proposé ici.** Son "Garmin Health API"
fonctionne en OAuth 1.0a (mécanique différente de Whoop/Oura, qui sont en
OAuth2 standard) et nécessite un accord partenaire Garmin (candidature,
validation manuelle côté Garmin) — pas quelque chose qu'on peut activer
soi-même en quelques minutes comme Whoop/Oura. Si tu obtiens cet accès un
jour, `lib/wearablesServer.js` est déjà organisé pour qu'ajouter un
adaptateur `garmin` se limite à écrire ses fonctions `exchangeCode` /
`refreshToken` / `fetchDaily`, sans toucher aux routes API ni à l'UI.

## 1. Créer une app développeur Whoop et/ou Oura

**Whoop** : https://developer.whoop.com → crée une app → "Redirect URI" =
`https://ton-app.vercel.app/api/wearables/callback` → note :
- `Client ID` → `NEXT_PUBLIC_WHOOP_CLIENT_ID`
- `Client Secret` → `WHOOP_CLIENT_SECRET`

**Oura** : https://cloud.ouraring.com/oauth/applications → crée une
application → même "Redirect URI" → note :
- `Client ID` → `NEXT_PUBLIC_OURA_CLIENT_ID`
- `Client Secret` → `OURA_CLIENT_SECRET`

Tu peux configurer un seul des deux fournisseurs (l'autre bouton reste
simplement désactivé), ou les deux — l'athlète choisit lequel connecter, un
seul à la fois par compte.

## 2. Créer la table Supabase

Supabase → ton projet → **SQL Editor** → New query → colle le contenu de
`supabase-schema-wearables.sql` → Run.

## 3. Ajouter les variables dans Vercel

Vercel → ton projet → **Settings → Environment Variables** :

| Nom | Valeur |
|---|---|
| `NEXT_PUBLIC_WHOOP_CLIENT_ID` | Client ID Whoop (si utilisé) |
| `WHOOP_CLIENT_SECRET` | Client Secret Whoop (si utilisé) |
| `NEXT_PUBLIC_OURA_CLIENT_ID` | Client ID Oura (si utilisé) |
| `OURA_CLIENT_SECRET` | Client Secret Oura (si utilisé) |
| `SUPABASE_SERVICE_ROLE_KEY` | déjà requis pour Strava — inchangé |
| `NEXT_PUBLIC_SITE_URL` | URL publique de ton app (ex: `https://ton-app.vercel.app`), utilisée pour reconstruire le `redirect_uri` exact au retour du fournisseur |

Redéploie une fois ces variables ajoutées.

## 4. Se connecter dans l'app

Onglet **Profil** → section "💍 Récupération automatique (VFC/sommeil)" →
"Connecter Whoop" ou "Connecter Oura" → autorise l'accès sur la page qui
s'ouvre → tu es redirigé vers l'app, connecté.

Ensuite, "↻ Synchroniser maintenant" va chercher les 14 derniers jours de VFC
et de sommeil et les ajoute à ton historique (graphe Profil) + met à jour la
valeur "actuelle" affichée. Ce n'est **pas automatique en tâche de fond** pour
l'instant (pas de webhook côté Whoop/Oura branché) : il faut retaper sur
"Synchroniser" de temps en temps (par exemple à chaque ouverture de l'app) —
une amélioration possible plus tard serait un cron Vercel qui appelle
`/api/wearables/sync` pour chaque utilisateur connecté une fois par jour.

## Bon à savoir

- **Déconnecter** (bouton dans la même section) coupe le lien mais conserve
  l'historique VFC/sommeil déjà synchronisé.
- Les champs exacts renvoyés par les API Whoop/Oura peuvent évoluer avec le
  temps — si une synchronisation échoue avec une erreur inattendue après une
  mise à jour de leur API, seules les fonctions `normalize*` de
  `lib/wearablesServer.js` ont besoin d'être ajustées, le reste de l'app ne
  connaît que le format normalisé `{ date, vfcMs, sleepHours, sleepScore }`.
