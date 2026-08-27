-- Tri Coach — schéma Supabase pour la synchronisation cloud.
-- À exécuter une fois dans : Supabase → ton projet → SQL Editor → New query → Run.

create table if not exists public.tri_coach_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  snapshot   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tri_coach_data enable row level security;

-- Chaque utilisateur ne peut lire/écrire QUE sa propre ligne (RLS) — indispensable,
-- la clé "anon" utilisée côté navigateur est publique.
drop policy if exists "select own data" on public.tri_coach_data;
create policy "select own data"
  on public.tri_coach_data for select
  using (auth.uid() = user_id);

drop policy if exists "insert own data" on public.tri_coach_data;
create policy "insert own data"
  on public.tri_coach_data for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own data" on public.tri_coach_data;
create policy "update own data"
  on public.tri_coach_data for update
  using (auth.uid() = user_id);
