-- supabase-fix-shoe-sync-2026-08.sql
--
-- À exécuter dans Supabase → SQL Editor pour débloquer une paire de chaussures dont le
-- suivi d'usure reste bloqué sur "n'a pas encore été créé" malgré plusieurs synchros.
--
-- Cause la plus probable : la ligne `equipment` de la chaussure a bien été créée (elle
-- apparaît dans la liste, avec son kilométrage), mais l'insertion de sa pièce de suivi
-- ("Amorti") dans `equipment_components` échoue silencieusement à chaque synchro — par
-- exemple si la contrainte equipment_components_zone_check en base n'autorise pas encore
-- la zone 'shoe' (schéma appliqué avant l'ajout des chaussures, ou migration jamais
-- exécutée). lib/equipment.js loggue maintenant cette erreur explicitement (Vercel →
-- Deployments → Functions → Logs) au prochain essai — si tu peux la consulter, elle
-- confirmera la cause exacte avant de lancer ce script.
--
-- Étape 1 — Diagnostic (à lancer d'abord, aucune modification) --------------------------

-- 1a. Zones actuellement autorisées par la contrainte — doit inclure 'shoe'.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conname = 'equipment_components_zone_check';

-- 1b. Tes chaussures et leur(s) pièce(s) de suivi (une chaussure "coincée" a une ligne
-- equipment mais ZÉRO ligne equipment_components associée).
select e.id as equipment_id, e.name, e.total_distance_m, c.id as component_id, c.part_key
from public.equipment e
left join public.equipment_components c on c.equipment_id = e.id
where e.kind = 'shoe'
order by e.name;

-- Étape 2 — Corriger la contrainte si 'shoe' n'y figure pas (sans risque à relancer,
-- idempotent) ------------------------------------------------------------------------
alter table public.equipment_components
  drop constraint if exists equipment_components_zone_check;

alter table public.equipment_components
  add constraint equipment_components_zone_check
  check (zone in ('transmission-avant', 'transmission-arriere', 'roues', 'cockpit', 'shoe'));

-- Étape 3 — Réinitialiser une chaussure encore coincée après l'étape 2 -------------------
-- Remplace <EQUIPMENT_ID> par l'id trouvé en 1b (colonne equipment_id, pour la ligne dont
-- component_id est NULL). Supprime ses éventuelles pièces orphelines/dupliquées pour
-- repartir propre — le prochain "Actualiser depuis Strava" dans l'app la recrée avec
-- l'usure à son défaut (100%, voir lib/equipment.js) que tu pourras ensuite corriger.
--
-- delete from public.equipment_components where equipment_id = '<EQUIPMENT_ID>';
--
-- Après avoir lancé (au besoin) l'étape 3, retourne dans l'app et touche
-- "↻ Actualiser depuis Strava" dans Outils > Matériel.
