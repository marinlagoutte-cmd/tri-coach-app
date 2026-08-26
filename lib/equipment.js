// lib/equipment.js
//
// Logique serveur partagée pour le suivi d'usure matériel (onglet Outils > Matériel) :
// modèles de pièces par défaut pour un vélo neuf détecté, et synchronisation du
// kilométrage total depuis Strava (source de vérité, voir lib/strava.js:extractStravaGear).
//
// Seuils par défaut (route/gravel, usage normal) — repères issus de recherches publiques
// (fabricants + retours d'expérience), volontairement modifiables pièce par pièce ensuite
// dans l'app plutôt que figés : l'usure réelle varie fortement (pluie/gravier ÷2 environ).
//
// Zones "transmission-avant" (pédalier/chaîne/pédales) et "transmission-arriere"
// (cassette/dérailleur) séparées depuis l'intégration des photos personnelles — avant
// il n'y avait qu'une seule zone "transmission". Pour du matériel synchronisé AVANT ce
// changement, il faut une migration sur les lignes existantes (voir message associé) :
//   UPDATE equipment_components SET zone = 'transmission-avant'
//     WHERE zone = 'transmission' AND part_key IN ('chaine','manivelles','pedales');
//   UPDATE equipment_components SET zone = 'transmission-arriere'
//     WHERE zone = 'transmission' AND part_key IN ('cassette','derailleur');
export const DEFAULT_BIKE_COMPONENTS = [
  { zone: 'transmission-avant', part_key: 'chaine', name: 'Chaîne', lifespan_km: 3000 },
  { zone: 'transmission-avant', part_key: 'manivelles', name: 'Manivelles / plateau', lifespan_km: 20000 },
  { zone: 'transmission-avant', part_key: 'pedales', name: 'Pédales', lifespan_km: 12000 },
  { zone: 'transmission-avant', part_key: 'derailleur-avant', name: 'Dérailleur avant', lifespan_km: 15000 },
  { zone: 'transmission-avant', part_key: 'boitier-pedalier', name: 'Boîtier de pédalier', lifespan_km: 12000 },
  // lifespan_km: 0 = pièce "de référence" (ne s'use pas au sens usuel) : elle apparaît
  // toujours en "bon état" et sert surtout à porter les détails (marque/modèle/n° de
  // série) via DetailsField plutôt qu'une vraie barre d'usure.
  { zone: 'transmission-avant', part_key: 'accumulateur', name: 'Batterie transmission (AXS)', lifespan_km: 0 },
  { zone: 'transmission-arriere', part_key: 'cassette', name: 'Cassette', lifespan_km: 9000 },
  { zone: 'transmission-arriere', part_key: 'derailleur', name: 'Dérailleur arrière', lifespan_km: 15000 },
  { zone: 'roues', part_key: 'pneu-av', name: 'Pneu avant', lifespan_km: 4000 },
  { zone: 'roues', part_key: 'pneu-ar', name: 'Pneu arrière', lifespan_km: 3500 },
  { zone: 'roues', part_key: 'plaquettes', name: 'Plaquettes de frein', lifespan_km: 4000 },
  { zone: 'roues', part_key: 'disques', name: 'Disques de frein', lifespan_km: 6500 },
  { zone: 'roues', part_key: 'roues', name: 'Roues (moyeu / tension)', lifespan_km: 25000 },
  { zone: 'roues', part_key: 'axes', name: 'Axes traversants', lifespan_km: 0 },
  { zone: 'cockpit', part_key: 'ruban', name: 'Ruban de cintre', lifespan_km: 6000 },
  { zone: 'cockpit', part_key: 'durites', name: 'Durites de frein', lifespan_km: 15000 },
  { zone: 'cockpit', part_key: 'cintre', name: 'Cintre / potence', lifespan_km: 30000 },
  { zone: 'cockpit', part_key: 'selle', name: 'Selle', lifespan_km: 20000 },
  { zone: 'cockpit', part_key: 'levier-frein', name: 'Leviers de frein / dérailleur', lifespan_km: 0 },
  { zone: 'cockpit', part_key: 'cadre', name: 'Cadre', lifespan_km: 0 },
  { zone: 'cockpit', part_key: 'fourche', name: 'Fourche', lifespan_km: 0 },
  { zone: 'cockpit', part_key: 'tige-selle', name: 'Tige de selle', lifespan_km: 0 },
  { zone: 'cockpit', part_key: 'serrage-selle', name: 'Serrage de tige de selle', lifespan_km: 0 },
];

// Fiche technique Canyon Aeroad CF SLX de l'athlète (fournie le 26/08/2026) — pré-remplit
// le champ "détails" de chaque pièce correspondante, mais UNIQUEMENT quand le nom du
// matériel Strava contient "aeroad" (voir isAeroad plus bas) : on ne veut pas que ces
// specs se retrouvent collées sur un futur 2e vélo différent.
const AEROAD_SPEC_DETAILS = {
  cadre: "Canyon Aeroad CF SLX\nDimension de l'axe : 12x142 mm\nEspace pour les pneus : 32 mm\nMatériau : Carbone (CF)\nPoids : 1050 g",
  fourche: "Canyon FK0137 CF Disc\nDimension de l'axe : 12x100 mm\nDiamètre du tube de direction : 1 1/8\"\nEspace pour les pneus : 32 mm\nMatériau : Carbone (CF)\nPoids : 401 g",
  'serrage-selle': "Canyon EP2352-01 Saddle Clamp for saddles with 7x7 mm steel rails",
  accumulateur: "SRAM Powerpack",
  derailleur: "SRAM Rival AXS Groupset\nPoids : 312 g",
  'derailleur-avant': "SRAM Rival AXS E1\nPoids : 254 g",
  cassette: "SRAM Rival XG-1250, 12 vitesses, 10-36\nNombre de pignons : 12\nPlage : 10-36",
  manivelles: "SRAM Rival AXS Crankset with Powermeter\nNombre de plateaux : 2",
  'boitier-pedalier': "SRAM DUB Pressfit\nStandard : PF 86,5\nPoids : 67 g",
  chaine: "SRAM Rival E1",
  'levier-frein': "SRAM Rival AXS HRD (x2)\nNombre de pistons : 2\nPoids : 383 g (par levier)",
  disques: "SRAM Paceline\nAvant : 160 mm, 139 g — Arrière : 140 mm, 136 g",
  roues: "Avant : DT Swiss ARC 1600 — axe 12x100 mm, jante carbone 55 mm, largeur interne 22 mm, 776 g\nArrière : DT Swiss ARC 1600 Dicut — axe 12x142 mm, jante carbone 55 mm, largeur interne 22 mm, 860 g\nFixation disque : Center Lock",
  'pneu-av': "Continental Grand Prix 5000 S TR, 28 mm — 294 g",
  'pneu-ar': "Continental Aero 111, 26 mm — 246 g",
  axes: "Avant : DT Swiss through axle w/ lever, 12x100 mm\nArrière : DT Swiss through axle removable lever, 12x142 mm",
  cintre: "Cintre de route Classic Drops (configuration standard)\n\nUnité cockpit : Canyon CP0048 PACE T-Bar — carbone, réglable en largeur (jusqu'à 50 mm) et hauteur (jusqu'à 20 mm), 12 configurations — 224 g",
  ruban: "Canyon Ergospeed Gel — ruban adhérent, confort haut de gamme — coloris noir",
  durites: "Durites SRAM Rival AXS HRD (voir Leviers de frein)",
  selle: "Selle Italia SLR Advan Saddle — largeur 130 mm, unisexe, 190 g",
  'tige-selle': "Canyon SP0077 — carbone, réglage indépendant du recul et de l'inclinaison, recul 10 mm, 160 g",
};
const isAeroad = (name) => /aeroad/i.test(name || '');

import { fetchStravaAthlete, extractStravaGear } from './strava';

// Repère le plus actionnable trouvé (moitié de capacité d'amorti, voir échanges précédents) —
// l'usure réelle n'est pas linéaire (plus marquée sur les 150-240 premiers km) mais un seuil
// unique reste le compromis le plus simple à afficher.
export const DEFAULT_SHOE_COMPONENT = { zone: 'shoe', part_key: 'usure', name: 'Amorti', lifespan_km: 600 };

/**
 * Crée les pièces par défaut absentes pour un matériel donné (nouveau matériel : toutes:
 * matériel déjà connu : seulement celles ajoutées depuis, ou manquantes suite à une
 * précédente erreur d'insertion), et pré-remplit les détails techniques connus quand le
 * matériel est reconnu (voir isAeroad). `baseline_km` d'une pièce nouvellement créée =
 * kilométrage total ACTUEL du matériel (pas 0), voir docstring de syncEquipmentFromStrava.
 */
async function backfillComponents(admin, equipmentId, gear) {
  const { data: existingComponents, error: selectError } = await admin
    .from('equipment_components')
    .select('id, part_key, details')
    .eq('equipment_id', equipmentId);
  // Important : si cette requête échoue (ex. colonne `details` pas encore migrée, voir
  // supabase-migration-details-2026-08.sql), on doit s'ARRÊTER ici plutôt que traiter
  // `existingComponents` comme "vide" — sinon on rêinsérerait en double TOUTES les pièces
  // par défaut à chaque synchro (aucune contrainte unique sur equipment_id+part_key).
  if (selectError) {
    console.error('[lib/equipment] backfillComponents: lecture composants existants a échoué (migration details manquante ?) :', selectError.message);
    return;
  }
  const existingByKey = new Map((existingComponents || []).map((c) => [c.part_key, c]));
  const templates = gear.kind === 'bike' ? DEFAULT_BIKE_COMPONENTS : [DEFAULT_SHOE_COMPONENT];
  const specs = isAeroad(gear.name) ? AEROAD_SPEC_DETAILS : {};
  const baselineKm = (gear.distanceM || 0) / 1000;

  const missing = templates.filter((t) => !existingByKey.has(t.part_key));
  if (missing.length > 0) {
    const rows = missing.map((t) => ({
      equipment_id: equipmentId,
      zone: t.zone,
      part_key: t.part_key,
      name: t.name,
      lifespan_km: t.lifespan_km,
      baseline_km: baselineKm,
      details: specs[t.part_key] || '',
    }));
    await admin.from('equipment_components').insert(rows);
  }

  // Comble les détails vides des pièces déjà existantes (n'écrase jamais un détail que
  // l'athlète aurait déjà renseigné ou modifié lui-même).
  if (Object.keys(specs).length > 0) {
    for (const c of existingComponents || []) {
      if (!c.details && specs[c.part_key]) {
        // eslint-disable-next-line no-await-in-loop
        await admin.from('equipment_components').update({ details: specs[c.part_key] }).eq('id', c.id);
      }
    }
  }
}

/**
 * Synchronise la liste de matériel Strava (bikes/shoes) d'un athlète vers les tables
 * equipment / equipment_components : met à jour le kilométrage total des matériels déjà
 * connus, et crée les nouveaux avec leurs pièces par défaut. `baseline_km` d'une pièce
 * nouvellement créée = kilométrage total ACTUEL du matériel (pas 0) : la pièce "part de 0"
 * dans l'app dès aujourd'hui, indépendamment du kilométrage déjà accumulé sur Strava avant
 * son suivi ici — l'athlète peut ensuite corriger cette base au cas par cas (pièce déjà usée
 * à l'ajout) via l'historique.
 *
 * Best-effort : les erreurs Strava/DB sont avalées (retourne { synced: 0 }) pour ne jamais
 * faire échouer l'import d'activités qui déclenche cet appel en tâche de fond.
 */
export async function syncEquipmentFromStrava(admin, userId, accessToken) {
  try {
    const athlete = await fetchStravaAthlete(accessToken);
    const gearList = extractStravaGear(athlete);
    if (gearList.length === 0) return { synced: 0 };

    let synced = 0;
    for (const gear of gearList) {
      // eslint-disable-next-line no-await-in-loop
      const { data: existing } = await admin
        .from('equipment')
        .select('id')
        .eq('user_id', userId)
        .eq('strava_gear_id', gear.stravaGearId)
        .maybeSingle();

      let equipmentId = existing?.id;
      if (existing) {
        // eslint-disable-next-line no-await-in-loop
        await admin.from('equipment').update({
          name: gear.name,
          total_distance_m: gear.distanceM,
          retired: gear.retired,
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id);
      } else {
        // Nouveau matériel jamais vu.
        // eslint-disable-next-line no-await-in-loop
        const { data: created, error: createError } = await admin.from('equipment').insert({
          user_id: userId,
          strava_gear_id: gear.stravaGearId,
          kind: gear.kind,
          name: gear.name,
          total_distance_m: gear.distanceM,
          retired: gear.retired,
        }).select('id').single();
        if (createError || !created) continue;
        equipmentId = created.id;
      }

      // Complète les pièces par défaut manquantes (matériel neuf ET matériel déjà connu :
      // ça répare aussi tout seul un matériel dont l'insertion initiale des pièces avait
      // échoué — ex. colonne pas encore migrée — sans que l'athlète ait à intervenir).
      // eslint-disable-next-line no-await-in-loop
      await backfillComponents(admin, equipmentId, gear);
      synced += 1;
    }
    return { synced };
  } catch (e) {
    console.error('[lib/equipment] syncEquipmentFromStrava error:', e?.message || e);
    return { synced: 0, error: true };
  }
}
