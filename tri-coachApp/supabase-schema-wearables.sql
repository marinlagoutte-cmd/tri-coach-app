-- Tri Coach — extension "récupération auto" (HRV/sommeil) du schéma Supabase.
-- À exécuter UNE FOIS dans : Supabase → ton projet → SQL Editor → New query → Run.
-- (En plus de supabase-schema.sql et supabase-schema-strava.sql, déjà en place.)
--
-- Contexte (voir WEARABLES_SETUP.md) : le champ `vfc` du profil (voir lib/defaults.js)
-- était jusqu'ici saisi à la main par l'athlète chaque jour. Cette table stocke les jetons
-- OAuth2 d'un objet connecté (Whoop ou Oura — un seul à la fois par utilisateur, choix
-- fait par l'athlète dans Réglages) pour aller chercher HRV + sommeil automatiquement
-- (voir pages/api/wearables/sync.js). Garmin n'est PAS proposé ici : son "Health API"
-- fonctionne en OAuth 1.0a (jeton non expirable, mécanique différente de Whoop/Oura) et
-- nécessite un accord partenaire Garmin — voir la note dans WEARABLES_SETUP.md plutôt que
-- d'improviser une implémentation non vérifiable.

create table if not exists public.wearable_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  provider      text not null check (provider in ('whoop', 'oura')),
  access_token  text not null,
  refresh_token text,
  expires_at    bigint, -- timestamp unix (secondes) ; null si le fournisseur n'expire pas
  external_id   text,   -- id utilisateur côté fournisseur (diagnostic uniquement)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.wearable_tokens enable row level security;

-- Même garde-fou que strava_tokens : le navigateur (clé anon) ne doit jamais lire/écrire
-- cette table directement, uniquement le serveur (clé service_role, pages/api/wearables/*.js).
drop policy if exists "no client access" on public.wearable_tokens;
create policy "no client access"
  on public.wearable_tokens for all
  using (false)
  with check (false);
