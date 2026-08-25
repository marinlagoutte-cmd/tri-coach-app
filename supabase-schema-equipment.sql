-- Tri Coach — extension "Matériel" du schéma Supabase (suivi d'usure vélo/chaussures).
-- À exécuter UNE FOIS dans : Supabase → ton projet → SQL Editor → New query → Run.
-- (En plus de supabase-schema.sql et supabase-schema-strava.sql, déjà en place.)
--
-- Pourquoi des tables normalisées plutôt que le snapshot cloud (tri_coach_data) comme le
-- reste de l'app : le kilométrage doit être mis à jour par les routes SERVEUR
-- (pages/api/strava/sync.js, webhook.js) qui n'ont pas accès au localStorage du navigateur.
-- Un blob JSON unique par utilisateur créerait un risque d'écrasement entre une écriture
-- serveur (nouveau kilométrage) et une écriture client (renommage, seuil modifié) proches
-- dans le temps — comme strava_activities, on isole donc ça dans ses propres tables.

-- gear_id Strava par activité : permet de savoir plus tard quelle sortie a été faite avec
-- quel vélo/quelle paire de chaussures (affichage détail d'activité, filtre, etc.) — le
-- kilométrage lui-même vient du total Strava par matériel (voir equipment.total_distance_m
-- ci-dessous), pas d'une somme des activités locales (qui ne couvrent que depuis la liaison
-- du compte, voir commentaire d'en-tête de pages/api/strava/sync.js).
alter table if exists public.strava_activities
  add column if not exists gear_id text;

-- 1) Un matériel = un "gear" Strava (vélo ou paire de chaussures), une ligne par matériel.
create table if not exists public.equipment (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  strava_gear_id    text,              -- id Strava (ex: "b12345678"), null si créé manuellement
  kind              text not null check (kind in ('bike', 'shoe')),
  name              text not null,
  total_distance_m  double precision not null default 0, -- total Strava (à vie), mis à jour par le serveur
  retired           boolean not null default false,
  updated_at        timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create unique index if not exists equipment_user_strava_gear_idx
  on public.equipment(user_id, strava_gear_id) where strava_gear_id is not null;
create index if not exists equipment_user_id_idx on public.equipment(user_id);

alter table public.equipment enable row level security;

drop policy if exists "own equipment" on public.equipment;
create policy "own equipment"
  on public.equipment for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2) Pièces suivies pour un matériel donné. Pour un vélo : plusieurs lignes (une par pièce,
--    regroupées par `zone`). Pour une paire de chaussures : une seule ligne (zone = 'shoe').
--    Usure = (equipment.total_distance_m / 1000 - baseline_km), jamais négatif.
--    `baseline_km` est le kilométrage TOTAL du matériel au moment où la pièce a été posée /
--    remise à zéro — pas un compteur indépendant — pour rester toujours cohérent avec le
--    total Strava, y compris après un rafraîchissement.
create table if not exists public.equipment_components (
  id             uuid primary key default gen_random_uuid(),
  equipment_id   uuid not null references public.equipment(id) on delete cascade,
  zone           text not null check (zone in ('transmission', 'roues', 'cockpit', 'shoe')),
  part_key       text not null,   -- identifiant stable ('chaine', 'cassette', ... ) pour les hotspots UI
  name           text not null,
  lifespan_km    double precision not null,
  baseline_km    double precision not null default 0,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index if not exists equipment_components_equipment_id_idx
  on public.equipment_components(equipment_id);

alter table public.equipment_components enable row level security;

drop policy if exists "own equipment components" on public.equipment_components;
create policy "own equipment components"
  on public.equipment_components for all
  using (exists (
    select 1 from public.equipment e
    where e.id = equipment_components.equipment_id and e.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.equipment e
    where e.id = equipment_components.equipment_id and e.user_id = auth.uid()
  ));

-- 3) Historique des changements d'une pièce (une ligne par remplacement/entretien noté).
create table if not exists public.equipment_component_history (
  id            uuid primary key default gen_random_uuid(),
  component_id  uuid not null references public.equipment_components(id) on delete cascade,
  changed_at    timestamptz not null default now(),
  km_at_change  double precision not null, -- kilométrage total du matériel à ce moment-là
  note          text,
  created_at    timestamptz not null default now()
);

create index if not exists equipment_component_history_component_id_idx
  on public.equipment_component_history(component_id);

alter table public.equipment_component_history enable row level security;

drop policy if exists "own equipment history" on public.equipment_component_history;
create policy "own equipment history"
  on public.equipment_component_history for all
  using (exists (
    select 1 from public.equipment_components c
    join public.equipment e on e.id = c.equipment_id
    where c.id = equipment_component_history.component_id and e.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.equipment_components c
    join public.equipment e on e.id = c.equipment_id
    where c.id = equipment_component_history.component_id and e.user_id = auth.uid()
  ));
