import { fetchStravaAthlete, extractStravaGear } from './strava';
import { BIKE_PARTS, legacyUpdatesFor } from './bikeParts';

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
// Pièces par défaut d'un vélo : référentiel documenté dans lib/bikeParts.js (durées de vie en
// km et/ou en mois, critères de remplacement, sources). Seules les colonnes stockées en base
// sont gardées ici ; la durée en mois et le critère sont relus depuis le référentiel.
export const DEFAULT_BIKE_COMPONENTS = BIKE_PARTS.map(({ zone, part_key, name, lifespan_km, cost_eur, mechanicalOnly }) => ({
  zone, part_key, name, lifespan_km, cost_eur, mechanicalOnly: Boolean(mechanicalOnly),
}));

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


// Repère le plus actionnable trouvé (moitié de capacité d'amorti, voir échanges précédents) —
// l'usure réelle n'est pas linéaire (plus marquée sur les 150-240 premiers km) mais un seuil
// unique reste le compromis le plus simple à afficher.
export const DEFAULT_SHOE_COMPONENT = { zone: 'shoe', part_key: 'usure', name: 'Amorti', lifespan_km: 600, cost_eur: 130 };

/**
 * Crée les pièces par défaut absentes pour un matériel donné (nouveau matériel : toutes:
 * matériel déjà connu : seulement celles ajoutées depuis, ou manquantes suite à une
 * précédente erreur d'insertion), et pré-remplit les détails techniques connus quand le
 * matériel est reconnu (voir isAeroad). `baseline_km` d'une pièce de VÉLO nouvellement
 * créée vaut TOUJOURS 0 par défaut (voir commentaire sur `baseline_km` plus bas) — demande
 * explicite de l'athlète, remplace un précédent réglage "usure max" qui donnait un km
 * différent du compteur du vélo pièce par pièce ; pour une chaussure, `baseline_km` =
 * kilométrage total ACTUEL (usure 0%), voir docstring de syncEquipmentFromStrava.
 */
async function backfillComponents(admin, equipmentId, gear) {
  const { data: existingComponents, error: selectError } = await admin
    .from('equipment_components')
    .select('id, part_key, details, cost_eur, lifespan_km, name')
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
  // Câbles de dérailleur : inutiles sur une transmission électronique (Aeroad de l'athlète =
  // SRAM Rival AXS, voir AEROAD_SPEC_DETAILS) — l'athlète peut supprimer la pièce sinon.
  const templates = gear.kind === 'bike'
    ? DEFAULT_BIKE_COMPONENTS.filter((t) => !(t.mechanicalOnly && isAeroad(gear.name)))
    : [DEFAULT_SHOE_COMPONENT];
  const specs = isAeroad(gear.name) ? AEROAD_SPEC_DETAILS : {};
  const totalKm = (gear.distanceM || 0) / 1000;

  const missing = templates.filter((t) => !existingByKey.has(t.part_key));
  if (missing.length > 0) {
    const rows = missing.map((t) => ({
      equipment_id: equipmentId,
      zone: t.zone,
      part_key: t.part_key,
      name: t.name,
      lifespan_km: t.lifespan_km,
      // DEMANDE EXPLICITE DE L'ATHLÈTE (remplace un précédent réglage "usure MAX" qui
      // affichait le km de PLEINE VIE de la pièce — ex. 3000km pour une chaîne — plutôt que
      // le vrai kilométrage du vélo) : chaque pièce de vélo nouvellement suivie démarre avec
      // le MÊME kilométrage que le vélo lui-même (baseline = 0, cf. currentKm dans
      // EquipmentTracker.js : km affiché = totalKm - baseline = totalKm quand baseline=0).
      // Hypothèse : la pièce est sur le vélo depuis le début — l'athlète corrige ensuite au
      // cas par cas (champ km éditable) si une pièce a en fait été changée en cours de route.
      // Chaussures : inchangé (baseline = totalKm, la pièce "Amorti" démarre à 0%) —
      // l'athlète les ajoute généralement neuves.
      baseline_km: gear.kind === 'bike' ? 0 : totalKm,
      details: specs[t.part_key] || '',
      cost_eur: t.cost_eur ?? 0,
    }));
    const { error: insertError } = await admin.from('equipment_components').insert(rows);
    // AVANT : cette erreur n'était pas vérifiée — un échec d'insertion (ex. contrainte
    // `equipment_components_zone_check` pas à jour côté DB, voir
    // supabase-migration-zones-2026-08.sql) passait totalement inaperçu : le matériel
    // apparaissait dans la liste (la ligne `equipment` avait bien été créée) mais restait
    // bloqué indéfiniment sans pièce de suivi ("le suivi d'usure n'a pas encore été créé"),
    // et RE-tentait en silence à CHAQUE synchro sans jamais aboutir ni prévenir personne.
    // Désormais loggé explicitement (Vercel → Deployments → Functions → Logs) pour pouvoir
    // diagnostiquer un futur blocage similaire.
    if (insertError) {
      console.error(
        `[lib/equipment] backfillComponents: échec insertion pièces (equipment_id=${equipmentId}, kind=${gear.kind}, gear="${gear.name}") :`,
        insertError.message
      );
    }
  }

  // Comble les détails vides des pièces déjà existantes (n'écrase jamais un détail que
  // l'athlète aurait déjà renseigné ou modifié lui-même) — et de même pour `cost_eur`,
  // absent (`null`) sur toute pièce créée AVANT ce champ : on applique alors le coût par
  // défaut du template une seule fois, jamais si l'athlète l'a déjà édité (0 est une
  // valeur explicite valide — ex. pièce reçue gratuitement — donc seul `null` déclenche
  // ce remplissage, pas `0`).
  const templateByKey = new Map(templates.map((t) => [t.part_key, t]));
  for (const c of existingComponents || []) {
    // Nouvelles durées de vie documentées (lib/bikeParts.js) appliquées UNIQUEMENT aux pièces
    // qui portent encore l'ancienne valeur par défaut — jamais à une valeur réglée par l'athlète.
    const updates = gear.kind === 'bike' ? { ...legacyUpdatesFor(c) } : {};
    if (!c.details && specs[c.part_key]) updates.details = specs[c.part_key];
    if (c.cost_eur === null || c.cost_eur === undefined) {
      const tpl = templateByKey.get(c.part_key);
      if (tpl && tpl.cost_eur !== undefined) updates.cost_eur = tpl.cost_eur;
    }
    if (Object.keys(updates).length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await admin.from('equipment_components').update(updates).eq('id', c.id);
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
 * BUG RÉEL SIGNALÉ (chaussures bloquées à 0 km en continu, alors que des activités leur sont
 * bien rattachées) : `athlete.shoes[].distance` renvoyé par l'endpoint `/athlete` de Strava
 * est le total déclaré CÔTÉ STRAVA pour ce matériel — et il arrive que ce total reste à 0 ou
 * ne se mette pas à jour pour une paire de chaussures (contrairement aux vélos, où ça n'a pas
 * été observé), typiquement quand le compte a été connecté à l'app AVANT que le scope
 * `profile:read_all` soit demandé (voir lib/stravaClient.js) : Strava ne redonne PAS
 * automatiquement les scopes ajoutés après-coup à un token déjà autorisé, il faut que
 * l'athlète déconnecte/reconnecte Strava pour les obtenir — sans ce scope, `distance` sur le
 * matériel peut rester à 0 silencieusement (pas d'erreur, juste une valeur manquante).
 * Plutôt que de dépendre uniquement de cette valeur potentiellement absente, on la CROISE
 * avec la somme des activités déjà importées localement pour ce gear_id (table
 * `strava_activities`, déjà peuplée par l'import normal des activités — voir
 * pages/api/strava/sync.js et webhook.js) et on retient le PLUS GRAND des deux totaux : le
 * total Strava reste la source de vérité quand il fonctionne (il inclut aussi les activités
 * antérieures à la liaison du compte, que l'app n'a jamais importées), mais s'il est resté
 * bloqué à 0 malgré des activités bien rattachées à ce gear_id, la somme locale prend le
 * relais plutôt que d'afficher un kilométrage manifestement faux.
 *
 * Best-effort : les erreurs Strava/DB sont avalées (retourne { synced: 0 }) pour ne jamais
 * faire échouer l'import d'activités qui déclenche cet appel en tâche de fond.
 *
 * `details` (retourné en plus de `synced`) : diagnostic PAR MATÉRIEL — distance brute
 * renvoyée par Strava, somme locale de repli, et laquelle des deux a été retenue. Ajouté
 * suite à un cas réel où le kilométrage restait bloqué à 0 après plusieurs correctifs :
 * sans ce détail, impossible de savoir depuis l'extérieur si le blocage vient de Strava
 * (scope manquant, `distance` non renvoyé) ou du repli local (aucune activité locale avec
 * ce `gear_id`) — les deux ont le même symptôme mais des causes et corrections différentes.
 * Affiché tel quel dans SettingsModal.js après une synchro.
 */
export async function syncEquipmentFromStrava(admin, userId, accessToken) {
  try {
    const athlete = await fetchStravaAthlete(accessToken);
    const gearList = extractStravaGear(athlete);
    // Diagnostic (26/08, conservé) : montre précisément ce que /athlete a renvoyé, pour
    // distinguer "Strava ne renvoie aucun matériel" (rien enregistré côté Strava) de "le
    // matériel est bien renvoyé mais le backfill des pièces échoue après" (DB) — ce
    // deuxième cas loggue maintenant aussi l'erreur exacte, voir backfillComponents.
    console.log('[lib/equipment] athlete.bikes:', JSON.stringify(athlete?.bikes || []));
    console.log('[lib/equipment] athlete.shoes:', JSON.stringify(athlete?.shoes || []));
    console.log('[lib/equipment] gearList extrait:', JSON.stringify(gearList));
    if (gearList.length === 0) return { synced: 0 };

    // Repli déterministe décrit ci-dessus : somme des activités déjà importées localement,
    // par gear_id, TOUTE PÉRIODE confondue (contrairement à usageRateByGear côté
    // EquipmentTracker.js qui se limite volontairement à 60 jours pour un RYTHME récent —
    // ici on veut le TOTAL, donc pas de fenêtre de date).
    const gearIds = gearList.map((g) => g.stravaGearId).filter(Boolean);
    const localSumByGearId = {};
    if (gearIds.length > 0) {
      const { data: localRows, error: localSumError } = await admin
        .from('strava_activities')
        .select('gear_id, distance_m')
        .eq('user_id', userId)
        .in('gear_id', gearIds);
      if (localSumError) {
        console.error('[lib/equipment] syncEquipmentFromStrava: lecture activités locales (repli km) a échoué :', localSumError.message);
      } else {
        (localRows || []).forEach((r) => {
          if (!r.gear_id || !r.distance_m) return;
          localSumByGearId[r.gear_id] = (localSumByGearId[r.gear_id] || 0) + r.distance_m;
        });
      }
    }

    let synced = 0;
    const details = [];
    for (const rawGear of gearList) {
      const localSumM = localSumByGearId[rawGear.stravaGearId] || 0;
      const correctedDistanceM = Math.max(rawGear.distanceM || 0, localSumM);
      if (localSumM > (rawGear.distanceM || 0)) {
        console.log(`[lib/equipment] ${rawGear.kind} "${rawGear.name}" : total Strava (${rawGear.distanceM || 0}m) < somme locale (${localSumM}m) — repli sur la somme locale.`);
      }
      const gear = { ...rawGear, distanceM: correctedDistanceM };
      details.push({
        kind: gear.kind,
        name: gear.name,
        stravaDistanceM: rawGear.distanceM || 0,
        localSumM,
        appliedDistanceM: correctedDistanceM,
      });

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
    return { synced, details };
  } catch (e) {
    console.error('[lib/equipment] syncEquipmentFromStrava error:', e?.message || e);
    return { synced: 0, error: true };
  }
}
