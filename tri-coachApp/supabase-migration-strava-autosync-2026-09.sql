-- Tri Coach — migration pour la synchro Strava automatique (cron horaire).
-- À exécuter UNE FOIS dans : Supabase → ton projet → SQL Editor → New query → Run.
-- (En plus de supabase-schema-strava.sql, déjà en place.)
--
-- Contexte : jusqu'ici, l'onglet Records ne voyait que les activités déjà importées dans
-- strava_activities, or seul un import MANUEL (bouton Réglages, fenêtre glissante de 12
-- semaines) ou le webhook (nouvelles activités à partir de la liaison du compte) y écrivaient
-- — un athlète lié depuis longtemps avec un vieux record jamais réouvert manuellement ne le
-- voyait donc jamais apparaître. Voir pages/api/strava/auto-sync.js.
--
-- `full_history_synced_at` : NULL tant que l'import historique complet (une seule fois par
-- athlète, toutes pages Strava confondues) n'a pas encore été fait par le cron ; une fois
-- rempli, le cron ne refait plus qu'une synchro incrémentale légère (voir `last_synced_at`).
-- `last_synced_at` : date/heure de la dernière synchro (manuelle OU cron) réussie, utilisée
-- par le cron pour ne relire que les activités depuis cette date (fenêtre courte = peu de
-- requêtes Strava consommées à chaque passage horaire).
alter table if exists public.strava_tokens
  add column if not exists full_history_synced_at timestamptz,
  add column if not exists last_synced_at timestamptz;
