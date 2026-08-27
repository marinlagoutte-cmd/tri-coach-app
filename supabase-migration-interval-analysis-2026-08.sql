-- supabase-migration-interval-analysis-2026-08.sql
--
-- Ajoute 2 champs à strava_activities pour l'analyse IA PAR INTERVALLES (demande
-- explicite de l'athlète, 27/08/2026 — voir lib/intervals.js et
-- pages/api/strava/webhook.js:coAnalyzeStravaActivity) :
--   - ai_seance_detectee : description courte de ce que l'IA a compris de la
--     structure réelle de la séance (ex: "3x10min au seuil, récup 3min"), déduite
--     du découpage par intervalles plutôt que de la seule moyenne globale.
--   - ai_respecte_plan   : verdict booléen (conforme / non conforme au plan prévu),
--     null si aucune séance prévue n'a pu être associée à l'activité (rien à
--     comparer). Permet de filtrer/afficher ce verdict sans reparser le texte libre
--     de ai_analysis.
-- À exécuter une fois dans Supabase (SQL Editor), APRÈS avoir déjà exécuté
-- supabase-schema-strava.sql au moins une fois.
--
-- Sans risque à ré-exécuter (idempotent grâce à `if not exists`).

alter table if exists public.strava_activities
  add column if not exists ai_seance_detectee text,
  add column if not exists ai_respecte_plan boolean;
