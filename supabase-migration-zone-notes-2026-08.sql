-- supabase-migration-zone-notes-2026-08.sql
--
-- Refonte UX du suivi matériel (26/08) : remplace les fiches "détails" pièce par pièce
-- par UNE zone de texte libre par zone du vélo (transmission avant/arrière, roues &
-- freins, cockpit), éditable directement depuis l'app. Voir le commentaire d'en-tête de
-- components/EquipmentTracker.js pour le pourquoi.
--
-- À exécuter une fois dans Supabase (SQL Editor), APRÈS avoir déjà exécuté
-- supabase-schema-equipment.sql et supabase-migration-details-2026-08.sql au moins une
-- fois. Sans risque à ré-exécuter (idempotent grâce à `if not exists` / `on conflict`).

alter table if exists public.equipment
  add column if not exists zone_notes jsonb not null default '{}'::jsonb;

-- Best-effort : reprend les "détails" déjà saisis pièce par pièce (surtout utile pour
-- les pièces "de référence" comme cadre/fourche/batterie AXS, qui n'apparaissent plus
-- comme cartes à part dans la nouvelle vue zone) et les regroupe dans zone_notes, un
-- texte par zone, pour qu'aucune info déjà renseignée ne soit perdue. N'écrase jamais
-- une zone déjà remplie (ex. si tu relances cette migration par erreur, ou si tu as déjà
-- commencé à remplir zone_notes à la main).
with agg as (
  select
    equipment_id,
    zone,
    string_agg(name || case when details is not null and details <> '' then e'\n' || details else '' end, e'\n\n' order by name) as notes
  from public.equipment_components
  where zone <> 'shoe'
  group by equipment_id, zone
)
update public.equipment e
set zone_notes = e.zone_notes || jsonb_build_object(agg.zone, agg.notes)
from agg
where agg.equipment_id = e.id
  and coalesce(e.zone_notes ->> agg.zone, '') = '';
