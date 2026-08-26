-- supabase-migration-details-2026-08.sql
--
-- Ajoute le champ "détails" (marque / modèle / année / numéro de série / specs libres)
-- sur chaque pièce suivie, éditable par l'athlète dans l'onglet Outils > Matériel.
-- À exécuter une fois dans Supabase (SQL Editor), APRÈS avoir déjà exécuté
-- supabase-schema-equipment.sql (ou supabase-migration-zones-2026-08.sql) au moins une fois.
--
-- Sans risque à ré-exécuter (idempotent grâce à `if not exists`).

alter table if exists public.equipment_components
  add column if not exists details text not null default '';
