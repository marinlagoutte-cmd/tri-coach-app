// lib/racePredictor.js
//
// Prédicteur de temps de course : la synthèse finale qui manquait entre le profil
// physiologique RÉSOLU (VMA / FTP / CSS, voir lib/physiology.js:resolveAthletePhysiology,
// stocké tel quel dans `profile`) et la forme actuelle (TSB, voir
// lib/analytics.js:computeTrainingLoadSeries) : "avec ta forme actuelle, tu es sur un
// chrono estimé de X sur ton format". Répond à la question inverse de
// resolveTargetPhysiology (qui donne le niveau à ATTEINDRE pour tenir un temps VISÉ) — ici
// on part du niveau ACTUEL pour en déduire le temps qu'il laisse attendre aujourd'hui.
//
// RÈGLE IDENTIQUE au reste de l'app : chaque segment n'est estimé QUE si sa donnée source
// existe réellement (VMA/CSS mesurées ou dérivées d'un chrono réel ; vitesse vélo dérivée de
// VRAIES sorties Strava comparables, jamais un modèle watts→vitesse inventé — voir le
// commentaire de resolveTargetPhysiology sur ce point précis). Un segment non estimable
// reste `null`, signalé explicitement plutôt que masqué ou deviné.
import { vmaPercentForDistance } from './physiology';

/**
 * Ajustement de la prédiction selon la forme (TSB = CTL − ATL, voir lib/analytics.js).
 * Bornes volontairement modestes (+/-3% max) : la forme influence la performance réelle,
 * mais un seul indicateur ne doit jamais produire une fausse promesse de chrono.
 */
function formFactorFromTsb(tsb) {
  if (tsb === null || tsb === undefined || Number.isNaN(tsb)) {
    return { factor: 1, label: "forme non disponible (pas assez d'historique Strava pour calculer un TSB)" };
  }
  if (tsb >= 10) return { factor: 1.03, label: `forme fraîche (TSB ${tsb.toFixed(0)}) : +3% appliqué` };
  if (tsb >= -5) return { factor: 1, label: `forme neutre (TSB ${tsb.toFixed(0)})` };
  if (tsb >= -20) return { factor: 0.98, label: `charge d'entraînement en cours (TSB ${tsb.toFixed(0)}) : -2% appliqué` };
  return { factor: 0.97, label: `fatigue marquée (TSB ${tsb.toFixed(0)}) : -3% appliqué — un peu de repos avant l'échéance rapprocherait ce chrono du potentiel réel` };
}

function swimPaceSecPer100(nat100) {
  const m = String(nat100 || '').match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Temps de nage prédit (s) à partir du CSS/allure /100m mesurée sur une distance de
 * référence (400m, distance usuelle d'un test CSS) — légère dégradation d'allure au-delà
 * (exposant 1.02, doux : l'eau lisse l'effet de la fatigue comparé à la course à pied, mais
 * la dérive existe bel et bien sur une distance longue type 3.8km).
 */
function predictSwimTimeS(nat100, distanceM) {
  const paceSec = swimPaceSecPer100(nat100);
  if (!paceSec || !distanceM) return null;
  const refDistanceM = 400;
  const refTimeS = paceSec * (refDistanceM / 100);
  return Math.round(refTimeS * (distanceM / refDistanceM) ** 1.02);
}

/** Temps course à pied prédit (s) à partir de la VMA — même référentiel %VMA/distance que
 * le reste de l'app (lib/physiology.js:vmaPercentForDistance), donc cohérent avec les
 * allures déjà utilisées pour générer les séances du plan. */
function predictRunTimeS(vma, distanceKm) {
  if (!vma || !distanceKm) return null;
  const speedKmh = vma * vmaPercentForDistance(distanceKm);
  return Math.round((distanceKm / speedKmh) * 3600);
}

/**
 * Temps vélo prédit (s) à partir de la vitesse moyenne RÉELLEMENT tenue par l'athlète sur
 * ses propres sorties Strava les plus comparables en intensité (PAS un modèle watts→vitesse
 * inventé : aéro/poids/position inconnus, voir lib/physiology.js pour cette même limite déjà
 * assumée ailleurs dans l'app). Retourne `null` si aucune sortie comparable n'est encore
 * synchronisée — jamais une vitesse théorique de repli.
 */
function predictBikeTime(distanceKm, activities, ftp) {
  if (!distanceKm || !Array.isArray(activities) || activities.length === 0) return null;
  const rides = (activities || []).filter((a) => /ride|bike|cycl/i.test(a.sport_type || a.type || '') && a.distance_m > 15000 && a.moving_time_s > 0);
  if (rides.length === 0) return null;

  const withSpeed = rides.map((a) => ({
    avgSpeedKmh: (a.distance_m / 1000) / (a.moving_time_s / 3600),
    // Intensité relative au FTP connu (fraction) — sert uniquement à repérer les sorties
    // "à allure course" plutôt qu'une récup ou une sortie à bloc de 30s ; reste `null` (et
    // donc ignorée comme filtre) si le FTP n'est pas connu.
    intensity: ftp && a.average_watts ? a.average_watts / ftp : null,
  }));

  const raceLike = ftp
    ? withSpeed.filter((a) => a.intensity !== null && a.intensity >= 0.65 && a.intensity <= 0.98)
    : withSpeed;
  const pool = raceLike.length > 0 ? raceLike : withSpeed;

  // Moyenne des 5 meilleures vitesses du pool (lisse le bruit météo/terrain d'une sortie
  // isolée) plutôt qu'une unique sortie ou une valeur théorique.
  const top = [...pool].sort((a, b) => b.avgSpeedKmh - a.avgSpeedKmh).slice(0, 5);
  const avgSpeedKmh = top.reduce((s, a) => s + a.avgSpeedKmh, 0) / top.length;
  return { timeS: Math.round((distanceKm / avgSpeedKmh) * 3600), basedOnRides: top.length, avgSpeedKmh: Math.round(avgSpeedKmh * 10) / 10 };
}

export function formatHms(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || Number.isNaN(totalSeconds)) return '—';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}min${String(s).padStart(2, '0')}` : `${m}min${String(s).padStart(2, '0')}`;
}

/**
 * Fonction principale. `physio` = profil courant (profile.vma / profile.ftp /
 * profile.nat100 — les valeurs RÉSOLUES stockées dans le profil, voir
 * lib/physiology.js:resolveAthletePhysiology). `distances` = { run } (course seule/trail) ou
 * { swim, bike, run } en km (triathlon). `activities` = activités Strava synchronisées
 * (pour le segment vélo). `tsb` = forme actuelle (lib/analytics.js, `current.tsb`).
 */
export function predictRaceTime({ sportType, distances, physio, activities, tsb }) {
  const form = formFactorFromTsb(tsb);

  if (sportType !== 'triathlon') {
    const km = distances?.run;
    const baseS = predictRunTimeS(physio?.vma, km);
    if (!baseS) {
      return { available: false, reason: !physio?.vma ? 'VMA non renseignée — un test VMA (ex: demi-Cooper) débloquerait cette estimation.' : 'Distance de course non renseignée.' };
    }
    const totalS = Math.round(baseS / form.factor);
    return { available: true, partial: false, missing: [], totalS, formLabel: form.label, splits: { run: { km, timeS: totalS } } };
  }

  const swimKm = distances?.swim;
  const bikeKm = distances?.bike;
  const runKm = distances?.run;

  const swimBaseS = predictSwimTimeS(physio?.nat100, (swimKm || 0) * 1000);
  const runBaseS = predictRunTimeS(physio?.vma, runKm);
  const bike = predictBikeTime(bikeKm, activities, physio?.ftp);

  const missing = [];
  if (!swimBaseS) missing.push('natation (CSS non renseignée)');
  if (!bike) missing.push('vélo (pas encore assez de sorties Strava comparables synchronisées)');
  if (!runBaseS) missing.push('course à pied (VMA non renseignée)');

  if (!swimBaseS && !bike && !runBaseS) {
    return { available: false, reason: `Aucune donnée suffisante pour estimer un chrono (manque : ${missing.join(', ')}).` };
  }

  const swimS = swimBaseS ? Math.round(swimBaseS / form.factor) : null;
  const runS = runBaseS ? Math.round(runBaseS / form.factor) : null;
  const bikeS = bike ? Math.round(bike.timeS / form.factor) : null;
  // Transitions T1/T2 : 2min chacune, repère générique affiché comme tel (pas une mesure) —
  // ajoutées seulement si au moins 2 des 3 segments sont estimés (sinon la notion même de
  // "transition entre segments" n'a pas de sens sur une estimation partielle à 1 segment).
  const segmentsAvailable = [swimS, bikeS, runS].filter(Boolean).length;
  const transitionsS = segmentsAvailable >= 2 ? 240 : 0;
  const totalS = (swimS || 0) + (bikeS || 0) + (runS || 0) + transitionsS;

  return {
    available: totalS > 0,
    partial: missing.length > 0,
    missing,
    totalS: totalS > 0 ? totalS : null,
    formLabel: form.label,
    transitionsS,
    splits: {
      swim: swimS ? { km: swimKm, timeS: swimS } : null,
      bike: bikeS ? { km: bikeKm, timeS: bikeS, avgSpeedKmh: bike?.avgSpeedKmh, basedOnRides: bike?.basedOnRides } : null,
      run: runS ? { km: runKm, timeS: runS } : null,
    },
  };
}
