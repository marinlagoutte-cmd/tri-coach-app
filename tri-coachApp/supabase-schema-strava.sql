-- Tri Coach — extension Strava du schéma Supabase.
-- À exécuter UNE FOIS dans : Supabase → ton projet → SQL Editor → New query → Run.
-- (En plus de supabase-schema.sql, déjà en place pour l'auth/sync cloud.)

-- MIGRATION (si la table strava_activities existe déjà depuis une version antérieure) :
-- "create table if not exists" ci-dessous n'ajoute PAS de colonne à une table déjà
-- créée — cette ligne comble le vide pour les installations existantes. Sans effet
-- (et sans erreur) sur une base neuve, où la table n'existe pas encore à ce stade.
alter table if exists public.strava_activities
  add column if not exists match_confirmed boolean not null default false;

-- Idem pour `laps` (voir supabase-migration-strava-laps-2026-09.sql) : sans effet sur
-- une base neuve où la colonne est déjà créée par le "create table" plus bas.
alter table if exists public.strava_activities
  add column if not exists laps jsonb;

-- 1) Jetons Strava par utilisateur : un seul compte Strava lié par utilisateur Tri Coach.
--    access_token / refresh_token ne sont JAMAIS envoyés au navigateur (lus uniquement
--    par les routes serveur pages/api/strava/*.js, via la clé service_role).
create table if not exists public.strava_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  athlete_id    bigint not null unique,
  access_token  text not null,
  refresh_token text not null,
  expires_at    bigint not null, -- timestamp unix (secondes), tel que renvoyé par Strava
  scope         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.strava_tokens enable row level security;

-- Le navigateur (clé anon) ne doit JAMAIS pouvoir lire/écrire cette table directement —
-- uniquement le serveur (clé service_role, qui contourne RLS). On active quand même RLS
-- avec des policies qui n'autorisent rien côté client, en garde-fou.
drop policy if exists "no client access" on public.strava_tokens;
create policy "no client access"
  on public.strava_tokens for all
  using (false)
  with check (false);

-- 2) Activités Strava importées, une ligne par activité.
create table if not exists public.strava_activities (
  id                 bigint primary key, -- id d'activité Strava (déjà unique globalement)
  user_id            uuid not null references auth.users(id) on delete cascade,
  sport_type         text,
  name               text,
  start_date         timestamptz not null,
  start_date_local   timestamptz not null,
  timezone           text,
  distance_m         double precision,
  moving_time_s       integer,
  elapsed_time_s      integer,
  total_elevation_m  double precision,
  average_speed_ms   double precision,
  max_speed_ms       double precision,
  average_heartrate  double precision,
  max_heartrate      double precision,
  average_watts      double precision,
  max_watts          double precision,
  summary_polyline   text,
  -- Correspondance avec le plan Tri Coach : renseignée automatiquement (jour de semaine
  -- réel + sport), corrigeable manuellement ensuite (voir pages/api/strava/match.js).
  matched_week_key   text,        -- 'N' | 'N+1' | null si pas de correspondance
  matched_workout_id text,        -- id de la séance dans workouts[weekKey], ou null
  match_source       text default 'auto', -- 'auto' | 'manual' | 'none'
  -- Tant que false : l'activité et la séance prévue restent affichées comme deux
  -- pastilles séparées dans le calendrier (association proposée mais pas confirmée
  -- par l'athlète). Passé à true (bouton "Confirmer" dans ActivityDetail.js) : les
  -- deux fusionnent en une seule pastille dans CalendarView.js, pour ne pas avoir
  -- une séance "prévue" ET une séance "réalisée" en double sur le même jour.
  match_confirmed    boolean not null default false,
  -- Streams (courbes temporelles : latlng, allure, FC, puissance) chargées à la
  -- demande depuis Strava (voir pages/api/strava/streams.js) puis mises en cache ici
  -- pour ne pas re-consommer le quota Strava à chaque ouverture.
  streams            jsonb,
  -- Laps (tours) bruts Strava (voir fetchStravaActivityLaps, lib/strava.js), utilisés
  -- pour l'analyse IA décortiquée lap par lap (voir lib/lapsAnalysis.js). Récupérés
  -- uniquement sur événement webhook temps réel (une activité à la fois).
  laps               jsonb,
  -- Analyse IA (prévu vs réalisé), générée automatiquement à la réception de l'activité.
  ai_analysis        text,
  ai_analysis_status text default 'pending', -- 'pending' | 'ok' | 'error' | 'skipped'
  created_at         timestamptz not null default now()
);

create index if not exists strava_activities_user_id_idx on public.strava_activities(user_id);
create index if not exists strava_activities_start_date_idx on public.strava_activities(start_date);

alter table public.strava_activities enable row level security;

-- Chaque utilisateur ne peut lire/modifier QUE ses propres activités. Les INSERT se
-- font uniquement côté serveur (clé service_role, webhook Strava) donc pas de policy
-- "insert" pour le client ; en revanche le client a besoin de UPDATE pour la correction
-- manuelle d'une correspondance (matched_week_key / matched_workout_id / match_source).
drop policy if exists "select own activities" on public.strava_activities;
create policy "select own activities"
  on public.strava_activities for select
  using (auth.uid() = user_id);

drop policy if exists "update own match" on public.strava_activities;
create policy "update own match"
  on public.strava_activities for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
