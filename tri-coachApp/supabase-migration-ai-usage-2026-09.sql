-- supabase-migration-ai-usage-2026-09.sql
--
-- Quota quotidien persistant des appels IA par compte (voir lib/aiGuard.js).
-- À exécuter une fois : Supabase → SQL Editor → coller ce fichier → Run.
-- Sans cette table, l'app fonctionne quand même : seul le quota quotidien est inactif
-- (l'authentification et la limite par minute restent en place).

create table if not exists public.ai_usage (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  route text not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_user_created_idx
  on public.ai_usage (user_id, created_at desc);

-- RLS activée SANS aucune policy : seul le serveur (clé service_role) lit et écrit.
-- Un utilisateur ne peut ni lire ni effacer son propre compteur depuis le navigateur.
alter table public.ai_usage enable row level security;

-- Optionnel : purge des entrées de plus de 30 jours (à relancer de temps en temps).
-- delete from public.ai_usage where created_at < now() - interval '30 days';
