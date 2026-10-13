-- supabase-migration-mise-a-niveau-2026-10.sql
--
-- MISE À NIVEAU UNIQUE de la base Supabase de TRI COACH : regroupe toutes les migrations
-- dont l'app a besoin (août → octobre 2026). Sûr à exécuter plusieurs fois : n'ajoute que ce
-- qui manque, ne supprime ni n'écrase aucune donnée.
--
-- Utilisation : Supabase > SQL Editor > New query > coller tout ce fichier > Run.
--
-- Corrige notamment :
--   « Could not find the 'cost_eur' column of 'equipment_components' in the schema cache »
--   (migration du coût des pièces jamais appliquée → les pièces ne pouvaient pas être ajoutées).

-- 1. Pièces de matériel : coût et détails
alter table if exists public.equipment_components
  add column if not exists cost_eur numeric(10, 2),
  add column if not exists details text not null default '',
  add column if not exists updated_at timestamptz not null default now();

-- 2. Matériel : notes libres par zone
alter table if exists public.equipment
  add column if not exists zone_notes jsonb not null default '{}'::jsonb;

-- 3. Zones des pièces (transmission avant / arrière, roues, cockpit, chaussures)
update public.equipment_components set zone = 'transmission-avant'
  where zone = 'transmission' and part_key in ('chaine', 'manivelles', 'pedales');
update public.equipment_components set zone = 'transmission-arriere'
  where zone = 'transmission' and part_key in ('cassette', 'derailleur');
update public.equipment_components set zone = 'transmission-avant'
  where zone = 'transmission';
alter table if exists public.equipment_components
  drop constraint if exists equipment_components_zone_check;
alter table if exists public.equipment_components
  add constraint equipment_components_zone_check
  check (zone in ('transmission-avant', 'transmission-arriere', 'roues', 'cockpit', 'shoe')) not valid;
-- « not valid » : la règle s'applique aux nouvelles pièces sans revalider les anciennes, pour
-- que le script ne puisse pas échouer sur une pièce historique rangée dans une zone ancienne.

-- 4. Jetons Strava : autorisation accordée et suivi de synchro
alter table if exists public.strava_tokens
  add column if not exists scope text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists full_history_synced_at timestamptz,
  add column if not exists last_synced_at timestamptz;

-- 5. Activités Strava : association aux séances, tours, analyse IA
alter table if exists public.strava_activities
  add column if not exists matched_week_key text,
  add column if not exists matched_workout_id text,
  add column if not exists match_source text default 'auto',
  add column if not exists match_confirmed boolean not null default false,
  add column if not exists laps jsonb,
  add column if not exists ai_analysis text,
  add column if not exists ai_analysis_status text default 'pending';

-- 6. Compteur d'appels IA (protection des routes IA)
create table if not exists public.ai_usage (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  route text not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_created_idx
  on public.ai_usage (user_id, created_at desc);
alter table public.ai_usage enable row level security;

-- 7. Recharge le cache de schéma de l'API (cause directe du message « schema cache »)
notify pgrst, 'reload schema';

-- 8. Contrôle : colonnes présentes et autorisation Strava enregistrée
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (table_name, column_name) in (
    ('equipment_components', 'cost_eur'), ('equipment_components', 'details'),
    ('equipment', 'zone_notes'), ('strava_tokens', 'scope'), ('strava_activities', 'ai_analysis')
  )
order by table_name, column_name;
select scope, updated_at from public.strava_tokens;
