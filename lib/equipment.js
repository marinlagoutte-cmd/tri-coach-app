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
  { zone: 'transmission-arriere', part_key: 'cassette', name: 'Cassette', lifespan_km: 9000 },
  { zone: 'transmission-arriere', part_key: 'derailleur', name: 'Dérailleur arrière', lifespan_km: 15000 },
  { zone: 'roues', part_key: 'pneu-av', name: 'Pneu avant', lifespan_km: 4000 },
  { zone: 'roues', part_key: 'pneu-ar', name: 'Pneu arrière', lifespan_km: 3500 },
  { zone: 'roues', part_key: 'plaquettes', name: 'Plaquettes de frein', lifespan_km: 4000 },
  { zone: 'roues', part_key: 'disques', name: 'Disques de frein', lifespan_km: 6500 },
  { zone: 'roues', part_key: 'roues', name: 'Roues (moyeu / tension)', lifespan_km: 25000 },
  { zone: 'cockpit', part_key: 'ruban', name: 'Ruban de cintre', lifespan_km: 6000 },
  { zone: 'cockpit', part_key: 'durites', name: 'Durites de frein', lifespan_km: 15000 },
  { zone: 'cockpit', part_key: 'cintre', name: 'Cintre / potence', lifespan_km: 30000 },
  { zone: 'cockpit', part_key: 'selle', name: 'Selle', lifespan_km: 20000 },
];

import { fetchStravaAthlete, extractStravaGear } from './strava';

// Repère le plus actionnable trouvé (moitié de capacité d'amorti, voir échanges précédents) —
// l'usure réelle n'est pas linéaire (plus marquée sur les 150-240 premiers km) mais un seuil
// unique reste le compromis le plus simple à afficher.
export const DEFAULT_SHOE_COMPONENT = { zone: 'shoe', part_key: 'usure', name: 'Amorti', lifespan_km: 600 };

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

      if (existing) {
        // eslint-disable-next-line no-await-in-loop
        await admin.from('equipment').update({
          name: gear.name,
          total_distance_m: gear.distanceM,
          retired: gear.retired,
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id);
        synced += 1;
        continue;
      }

      // Nouveau matériel jamais vu : on le crée avec ses pièces par défaut.
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

      const baselineKm = gear.distanceM / 1000;
      const templates = gear.kind === 'bike' ? DEFAULT_BIKE_COMPONENTS : [DEFAULT_SHOE_COMPONENT];
      const componentRows = templates.map((t) => ({
        equipment_id: created.id,
        zone: t.zone,
        part_key: t.part_key,
        name: t.name,
        lifespan_km: t.lifespan_km,
        baseline_km: baselineKm,
      }));
      // eslint-disable-next-line no-await-in-loop
      await admin.from('equipment_components').insert(componentRows);
      synced += 1;
    }
    return { synced };
  } catch (e) {
    console.error('[lib/equipment] syncEquipmentFromStrava error:', e?.message || e);
    return { synced: 0, error: true };
  }
}
