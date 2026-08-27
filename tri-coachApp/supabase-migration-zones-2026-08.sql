-- Migration : scission de la zone "transmission" en "transmission-avant" /
-- "transmission-arriere" (suivi photo par groupe). À exécuter UNE FOIS dans Supabase →
-- SQL Editor, seulement si tu avais déjà exécuté supabase-schema-equipment.sql AVANT ce
-- changement (donc si la table equipment_components existe déjà avec des données).
--
-- Si tu pars d'une base neuve, ignore ce fichier et exécute directement
-- supabase-schema-equipment.sql (déjà à jour avec les 4 zones).
--
-- Ordre important : on retire d'abord la contrainte (qui n'autorisait que 'transmission'),
-- on reclasse les lignes existantes, PUIS on remet une contrainte resserrée aux 5 valeurs
-- valides — sinon la contrainte rejette les UPDATE avant qu'ils n'aient eu lieu.

alter table public.equipment_components
  drop constraint if exists equipment_components_zone_check;

update public.equipment_components set zone = 'transmission-avant'
  where zone = 'transmission' and part_key in ('chaine', 'manivelles', 'pedales');

update public.equipment_components set zone = 'transmission-arriere'
  where zone = 'transmission' and part_key in ('cassette', 'derailleur');

-- Filet de sécurité : une pièce ajoutée manuellement dans l'ancienne zone "transmission"
-- avec un part_key perso (ex: "custom-1234...") ne matche aucun des deux UPDATE ci-dessus.
-- On la range par défaut côté "transmission-avant" plutôt que de laisser une valeur qui
-- ferait échouer la contrainte ajoutée juste après.
update public.equipment_components set zone = 'transmission-avant'
  where zone = 'transmission';

alter table public.equipment_components
  add constraint equipment_components_zone_check
  check (zone in ('transmission-avant', 'transmission-arriere', 'roues', 'cockpit', 'shoe'));
