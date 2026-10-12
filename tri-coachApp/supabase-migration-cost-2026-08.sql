-- Tri Coach — Point 6 : coût du matériel dans le suivi d'usure.
-- À exécuter UNE FOIS dans : Supabase → ton projet → SQL Editor → New query → Run.
-- (En plus de supabase-schema-equipment.sql et supabase-migration-details-2026-08.sql,
-- déjà en place — voir STRAVA_SETUP.md pour l'ordre complet des migrations.)
--
-- Ajoute le prix (EUR) de chaque pièce suivie dans l'onglet Outils > Matériel, pour
-- calculer un budget d'entretien prévisionnel ("chaîne à changer dans ~2 mois, ~35€") —
-- voir lib/equipment.js (valeurs par défaut par pièce) et components/EquipmentTracker.js
-- (affichage + édition manuelle).

alter table public.equipment_components
  add column if not exists cost_eur numeric(10, 2);

comment on column public.equipment_components.cost_eur is
  'Prix indicatif de remplacement de la pièce, en euros — pré-rempli avec une estimation par défaut (voir lib/equipment.js:DEFAULT_BIKE_COMPONENTS), toujours éditable par l''athlète.';
