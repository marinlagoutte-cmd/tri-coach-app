# Connecter Supabase (compte + sync cloud multi-appareils)

Tant que ces étapes ne sont pas faites, l'app fonctionne exactement comme avant
(localStorage sur l'appareil uniquement, pas d'écran de connexion).

## 1. Créer le projet Supabase

1. https://supabase.com → New project (gratuit pour démarrer).
2. Une fois créé, note deux valeurs dans **Project Settings → API** :
   - `Project URL` → ce sera `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → ce sera `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     (cette clé est publique par design, la sécurité vient des policies RLS, voir étape 2)

## 2. Créer la table (sync cloud)

Dans Supabase → **SQL Editor** → New query → colle le contenu du fichier
`supabase-schema.sql` fourni avec l'app → Run.

Ça crée une table `tri_coach_data` (une ligne par utilisateur, protégée par Row Level
Security : personne ne peut lire les données d'un autre compte) et rien d'autre.

## 3. Activer la connexion Google

1. Dans Supabase → **Authentication → Providers → Google** → active-le.
2. Il te faut un Client ID + Client Secret Google OAuth : dans
   https://console.cloud.google.com/apis/credentials → Create credentials →
   OAuth client ID → type "Web application".
   - **Authorized redirect URI** à ajouter côté Google : l'URL de callback donnée
     par Supabase sur cette même page (`https://<ton-projet>.supabase.co/auth/v1/callback`).
3. Colle le Client ID + Secret dans Supabase, Save.
4. Dans Supabase → **Authentication → URL Configuration** :
   - Site URL : l'URL de ton app en prod (ex: `https://ton-app.vercel.app`)
   - Redirect URLs : ajoute la même URL (et `http://localhost:3000` si tu testes en local).

## 4. Ajouter les clés dans Vercel

Vercel → ton projet → **Settings → Environment Variables** :

| Nom | Valeur |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | l'URL du projet (étape 1) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | la clé `anon public` (étape 1) |

Puis **redéploie**. Dès que ces variables sont présentes, l'écran de connexion Google
apparaît automatiquement au lancement de l'app.

## Comment ça marche ensuite

- Tant qu'aucun compte n'est connecté (ou si l'athlète choisit "Continuer sans
  compte"), l'app tourne uniquement en local — rien ne change par rapport à avant.
- Une fois connecté : l'app va chercher les données déjà présentes en base et les
  applique dans le navigateur (recharge automatique une fois), puis CHAQUE
  sauvegarde locale (profil, plan, séances, chat, nutrition…) déclenche
  automatiquement une sauvegarde cloud (avec un léger délai pour grouper les
  écritures rapides).
- Se connecter avec le même compte Google sur un deuxième appareil retrouve
  exactement les mêmes données, même après avoir fermé le navigateur.
- En local pour tester : crée un fichier `.env.local` à la racine avec les deux
  mêmes variables (voir `.env.local.example`).
