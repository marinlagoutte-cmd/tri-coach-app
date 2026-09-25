-- Tri Coach — extension "notifications push" du schéma Supabase.
-- À exécuter UNE FOIS dans : Supabase → ton projet → SQL Editor → New query → Run.
-- (En plus de supabase-schema.sql, déjà en place pour l'auth/sync cloud.)
-- Voir NOTIFICATIONS_SETUP.md pour la mise en place complète (clés VAPID, cron Vercel).

-- 1) Abonnements Web Push, un par appareil/navigateur installé (un même compte
--    peut avoir plusieurs appareils — chacun reçoit sa propre notification).
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

-- Le navigateur (clé anon) n'a besoin d'AUCUN accès direct : la création/suppression
-- passe toujours par pages/api/notifications/{subscribe,unsubscribe}.js, qui utilisent
-- la clé service_role après avoir vérifié l'identité via le jeton de session (même
-- principe que pages/api/delete-account.js). RLS activée en garde-fou, sans policy
-- client — exactement comme strava_tokens dans supabase-schema-strava.sql.
drop policy if exists "no client access" on public.push_subscriptions;
create policy "no client access"
  on public.push_subscriptions for all
  using (false)
  with check (false);

-- 2) Journal d'envoi, une ligne par (utilisateur, semaine) déjà notifiée — évite un
--    double envoi si les deux horaires cron de vercel.json (couvrant hiver/été,
--    voir NOTIFICATIONS_SETUP.md) tombaient tous les deux à 19h heure de Paris, ou
--    si Vercel réessaie une invocation après un timeout.
create table if not exists public.weekly_recap_log (
  user_id    uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  sent_at    timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table public.weekly_recap_log enable row level security;

drop policy if exists "no client access" on public.weekly_recap_log;
create policy "no client access"
  on public.weekly_recap_log for all
  using (false)
  with check (false);
