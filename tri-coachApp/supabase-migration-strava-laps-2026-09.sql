-- Tri Coach — migration : stockage des laps Strava par activité.
-- À exécuter UNE FOIS dans : Supabase → ton projet → SQL Editor → New query → Run.
--
-- Contexte : jusqu'ici, l'analyse IA d'une séance (voir pages/api/strava/webhook.js
-- + lib/gemini.js:analyzeStravaActivity) ne se basait que sur les moyennes globales
-- de l'activité (FC moy/max, watts moy/max, vitesse moyenne). Cette colonne stocke
-- désormais les laps bruts renvoyés par Strava (GET /activities/{id}/laps) — FC,
-- puissance, cadence, vitesse, dénivelé PAR LAP — pour permettre une analyse
-- décortiquée (répétitions, effort vs récupération) via lib/lapsAnalysis.js.
--
-- Mis en cache ici pour la même raison que la colonne `streams` existante : ne pas
-- re-consommer le quota Strava à chaque ouverture/ré-analyse de l'activité.
alter table if exists public.strava_activities
  add column if not exists laps jsonb;
