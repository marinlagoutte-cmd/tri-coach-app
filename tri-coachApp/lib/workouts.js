// lib/workouts.js
import { DAYS_OF_WEEK } from './defaults';

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Repli d'allure course à pied déterministe (utilisé par enrichWorkoutMetrics/
 * checkWorkoutCoherence ci-dessous quand l'IA n'a pas fourni de valeur exploitable).
 * PRIORITÉ aux zones calibrées manuellement par l'athlète (profile.paceZones, voir
 * components/ZoneCharts.js / lib/zones.js:defaultPaceZones) sur le calcul théorique
 * depuis la VMA (75%) — même logique de priorité que lib/gemini.js:computeRunZones
 * côté génération IA, pour que la correction déterministe et la génération IA ne se
 * contredisent jamais entre elles.
 */
function hasValidPaceZones(paceZones) {
  return Array.isArray(paceZones) && paceZones.length === 5
    && paceZones.every((z) => Number.isFinite(Number(z?.min)) && Number(z.min) > 0);
}

/** Vitesse EF (km/h) de repli : milieu de la zone Z2 si calibrée manuellement, sinon 75% VMA. */
function fallbackEfSpeedKmh(profile) {
  if (hasValidPaceZones(profile?.paceZones)) {
    const sorted = [...profile.paceZones].sort((a, b) => Number(a.min) - Number(b.min));
    const z2 = Number(sorted[1]?.min);
    const z3 = Number(sorted[2]?.min);
    if (Number.isFinite(z2) && Number.isFinite(z3)) return (z2 + z3) / 2;
    if (Number.isFinite(z2)) return z2;
  }
  return profile?.vma ? profile.vma * 0.75 : null;
}

/** Bornes de vitesse [lente, rapide] (km/h) tolérées pour une allure course, pour la
 * cohérence : zones calibrées manuellement si présentes, sinon dérivées de la VMA. */
function paceSanityBoundsKmh(profile) {
  if (hasValidPaceZones(profile?.paceZones)) {
    const speeds = profile.paceZones.map((z) => Number(z.min)).filter((v) => v > 0);
    return [Math.min(...speeds) * 0.7, Math.max(...speeds) * 1.15];
  }
  return profile?.vma ? [5, profile.vma * 1.15] : null;
}


/**
 * Vérifie que "desc" respecte le formalisme "feuille de club" imposé au prompt de
 * génération pour la natation (RÈGLE ABSOLUE N°2, lib/gemini.js) : 3 blocs
 * Échauffement / Corps de séance / Total en mètres, avec au moins une série chiffrée
 * en notation compacte "N*Dm" ou "N*(...)". Retourne un message d'anomalie (string)
 * si le format n'est pas respecté, sinon null. Volontairement permissif sur le
 * contenu exact (peu importe le matériel/l'allure choisis, cette fonction ne juge
 * QUE la forme, jamais le fond) — la cohérence physiologique reste du ressort du
 * prompt IA et des autres garde-fous de ce fichier.
 */
function swimDescFormatIssue(desc) {
  const text = String(desc || '').trim();
  if (!text) return 'Description de séance natation vide';
  if (!/échauffement\s*:/i.test(text)) {
    return 'Format natation non conforme : bloc "Échauffement :" manquant';
  }
  if (!/corps de s[ée]ance\s*:/i.test(text)) {
    return 'Format natation non conforme : bloc "Corps de séance :" manquant';
  }
  if (!/total\s*:\s*~?\s*\d{3,5}\s*m\b/i.test(text)) {
    return 'Format natation non conforme : ligne "Total : XXXXm" manquante ou volume non chiffré';
  }
  if (!/\d+\s*[x×*]\s*\d+/i.test(text)) {
    return 'Format natation non conforme : aucune série chiffrée en notation "N*Dm" trouvée';
  }
  return null;
}

// Fourchette de volume total (mètres) par niveau déclaré (voir wizardData.fitnessLevel,
// 1=débutant à 5=expert) — mêmes ordres de grandeur que ceux donnés au prompt IA
// (RÈGLE ABSOLUE N°2) pour que le repli déterministe ci-dessous et la génération IA
// restent cohérents entre eux.
const SWIM_VOLUME_BY_LEVEL = {
  1: 1200, 2: 1500, 3: 2000, 4: 2800, 5: 3200,
};

/**
 * Génère un "desc" de secours au format "feuille de club" (3 blocs + Total chiffré),
 * utilisé UNIQUEMENT quand l'IA n'a pas fourni un format exploitable (voir
 * swimDescFormatIssue ci-dessus + sanitizeWorkout qui réinitialise "desc" à null dans
 * ce cas). Alterne volontairement le matériel (NC/PULL/PLAQ/educ) comme une vraie
 * séance de club plutôt qu'un unique bloc plat — voir lib/gemini.js pour le même
 * principe côté prompt. Le total annoncé est calculé RÉELLEMENT à partir des
 * distances utilisées (jamais recopié/inventé), pour rester exploitable tel quel.
 */
function buildSwimClubDesc(profile, { effortZoneLabel } = {}) {
  const level = clamp(Math.round(Number(profile?.fitnessLevel) || 3), 1, 5);
  const targetTotal = SWIM_VOLUME_BY_LEVEL[level];
  const zone = effortZoneLabel || 'Z2';

  const warmupM = level <= 2 ? 300 : 400;
  const mainSeries = level <= 2
    ? [{ reps: 8, dist: 50, note: `NC ${zone}`, rest: 20 }, { reps: 6, dist: 50, note: 'educ technique', rest: 15 }]
    : level === 3
      ? [{ reps: 6, dist: 100, note: `NC ${zone}`, rest: 15 }, { reps: 8, dist: 50, note: 'PLAQ', rest: 20 }, { reps: 4, dist: 100, note: 'PULL souple', rest: 15 }]
      : [{ reps: 8, dist: 100, note: `NC ${zone}`, rest: 15 }, { reps: 6, dist: 100, note: 'PLAQ', rest: 20 }, { reps: 6, dist: 100, note: 'PULL', rest: 15 }, { reps: 4, dist: 50, note: 'vitesse', rest: 30 }];

  const mainM = mainSeries.reduce((sum, s) => sum + s.reps * s.dist, 0);
  const coolDownM = Math.max(150, targetTotal - warmupM - mainM);
  const totalM = warmupM + mainM + coolDownM;

  const mainLines = mainSeries.map((s) => `${s.reps}*${s.dist}m ${s.note} R : ${s.rest}''`).join('\n');

  return `Échauffement :\n${warmupM}m souple NC + éducatifs\n\nCorps de séance :\n${mainLines}\n\n${coolDownM}m souple retour au calme\nTotal : ${totalM}m`;
}

/**
 * Découpe un "desc" au format "feuille de club" (RÈGLE ABSOLUE N°2, lib/gemini.js —
 * blocs Échauffement / Corps de séance / éventuel Total en mètres pour la natation)
 * en sections exploitables pour un rendu visuel distinct (voir components/
 * WorkoutDetail.js) au lieu d'un bloc de texte brut unique. Retourne null si le texte
 * ne contient pas au moins un bloc "Corps de séance :" reconnaissable — dans ce cas
 * l'appelant doit se rabattre sur un affichage texte brut (ex: séance REPOS, ou texte
 * legacy pré-refonte qui n'a jamais eu ce formalisme).
 */
export function parseClubSessionDesc(desc) {
  const text = String(desc || '').trim();
  if (!text) return null;
  const mainIdx = text.search(/corps de s[ée]ance\s*:/i);
  if (mainIdx === -1) return null;
  const warmup = text.slice(0, mainIdx).replace(/^échauffement\s*:\s*/i, '').trim();
  const rest = text.slice(mainIdx).replace(/^corps de s[ée]ance\s*:\s*/i, '');
  const totalMatch = rest.match(/total\s*:\s*(~?\s*\d[\d.,]*\s*m)\s*$/i);
  const main = (totalMatch ? rest.slice(0, totalMatch.index) : rest).trim();
  const total = totalMatch ? totalMatch[1].replace(/\s+/g, ' ').trim() : null;
  if (!main) return null;
  return { warmup: warmup || null, main, total };
}

export function enrichWorkoutMetrics(workout, profile) {
  if (!workout) return workout;
  let { type, intensity, cadence, cardio, rpe, effortZone, avgBpm, restTime, structure } = workout;
  type = (type || '').toUpperCase();
  // Ne JAMAIS fabriquer une FC max/repos par défaut (190/55) : si l'athlète ne
  // les a pas renseignées, on n'affiche/ne calcule aucun bpm plutôt qu'un chiffre inventé.
  const fcMax = profile?.fcMax || null;
  const fcRepos = profile?.fcRepos || null;
  // Reconnaît "4x100" / "6*100" (notation club plate) ET "4*(3' @85% VMA..."
  // (notation par bloc du formalisme "feuille de club" — parenthèse juste après
  // l'opérateur) : sans le "\(?" optionnel, une séance fractionnée rédigée dans
  // CE format n'était plus détectée comme un intervalle par ce garde-fou.
  const isInterval = /\d+\s*[x×*]\s*\(?\s*\d+/i.test(`${workout.title || ''} ${workout.desc || ''}`);

  if (type.includes('C.A.P') || type.includes('RUN')) {
    // BUG RÉEL CORRIGÉ : `hasValidPace` ne vérifiait QUE le FORMAT de la chaîne
    // ("4:30 /km" est valide syntaxiquement), jamais si l'athlète avait réellement une
    // VMA connue pour justifier ce chiffre. Résultat : quand l'IA ignorait l'instruction
    // du prompt et hallucinait quand même une allure chiffrée malgré une VMA non
    // renseignée, ce garde-fou la laissait passer telle quelle (hasValidPace = true →
    // le bloc de repli RPE ci-dessous n'était jamais atteint) — l'athlète voyait une
    // allure précise sans avoir jamais donné la donnée qui la justifie. On force donc
    // maintenant le repli RPE dès que la VMA est absente, QUELLE QUE SOIT la chaîne déjà
    // présente dans `intensity`, sauf si elle est déjà elle-même du texte RPE/ressenti
    // (dans ce cas rien à corriger).
    const alreadyRpeBased = /ressenti|rpe/i.test(String(intensity || ''));
    const efSpeed = fallbackEfSpeedKmh(profile);
    // BUG RÉEL CORRIGÉ : `hasValidPace` regardait uniquement si `intensity` avait déjà
    // un format d'allure exploitable ("5:07 /km ..."), sans distinguer une allure
    // VOULUE PAR L'IA (à préserver telle quelle) d'une allure que CE fichier avait
    // lui-même calculée en repli (marqueur "(EF, zones calibrées)" / "(75% VMA)", voir
    // plus bas). Conséquence concrète : une fois qu'une séance EF avait déjà été
    // enrichie une première fois avec l'allure de repli, `hasValidPace` restait `true`
    // pour toujours (le format ne change pas) — donc si l'athlète corrigeait ensuite sa
    // zone Z2 dans l'onglet Profil, `sanitizeWorkout` était bien rappelé sur cette
    // séance (voir pages/index.js:handlePaceZonesChange) mais ce garde-fou jugeait
    // l'ancienne allure "déjà valide" et ne la recalculait JAMAIS avec la nouvelle
    // valeur de Z2 — la séance restait figée sur l'ancienne allure indéfiniment. On ne
    // considère donc "déjà valide" QUE si l'allure ne porte pas notre propre marqueur
    // de repli — dans ce cas elle est TOUJOURS recalculée depuis les zones/VMA
    // actuelles, jamais figée après son premier calcul.
    const isOwnFallbackPace = /\(EF, zones calibr[ée]es\)|\(75% VMA\)/i.test(String(intensity || ''));
    const hasValidPace = !alreadyRpeBased
      && !isOwnFallbackPace
      && efSpeed
      && /\d+:\d{2}\s*\/?\s*(min\/)?km/i.test(String(intensity || ''));
    if (!efSpeed && !alreadyRpeBased) {
      intensity = 'Allure selon ressenti (RPE 6/10) — VMA non renseignée';
    } else if (!hasValidPace) {
      const kmhMatch = String(intensity || '').match(/(\d+(?:[.,]\d+)?)\s*k\s*m\s*\/?\s*h/i);
      if (kmhMatch) {
        // L'IA a donné une vitesse en km/h : on la CONVERTIT en min/km au lieu de la
        // jeter, pour préserver l'allure réellement voulue par l'IA pour cette séance.
        const speedKmh = Number(kmhMatch[1].replace(',', '.'));
        const paceMin = 60 / speedKmh;
        const min = Math.floor(paceMin);
        const sec = Math.round((paceMin - min) * 60);
        intensity = `${min}:${String(sec).padStart(2, '0')} /km`;
      } else if (efSpeed) {
        // Repli sur les zones calibrées manuellement si disponibles, sinon 75% VMA —
        // jamais une constante générique (voir fallbackEfSpeedKmh ci-dessus).
        const paceMin = 60 / efSpeed;
        const min = Math.floor(paceMin);
        const sec = Math.round((paceMin - min) * 60);
        const source = hasValidPaceZones(profile?.paceZones) ? '(EF, zones calibrées)' : '(75% VMA)';
        intensity = `${min}:${String(sec).padStart(2, '0')} /km ${source}`;
      } else {
        // VMA non renseignée : on n'invente AUCUN chiffre, on retombe sur un
        // repère RPE (ressenti) au lieu d'une allure calculée sur une valeur fictive.
        intensity = 'Allure selon ressenti (RPE 6/10) — VMA non renseignée';
      }
    }
    cadence = cadence || '175-180 spm';
    effortZone = effortZone || 'Z2-Z3';
    avgBpm = (profile?.fcMax && profile?.fcRepos) ? (avgBpm || `${Math.round(fcRepos + (fcMax - fcRepos) * 0.65)} bpm`) : (avgBpm || null);
    cardio = cardio || (avgBpm ? `${effortZone} (${avgBpm})` : effortZone);
    rpe = rpe || 'RPE 6/10';
    restTime = restTime || (isInterval ? "Récup. trot 1' à 2' entre les répétitions (50-100% du temps d'effort)" : '-');
    structure = structure || (isInterval
      ? `Échauffement 15min Z1-Z2 + corps de séance (allure cible ${intensity}) + retour au calme 10min Z1`
      : `Échauffement 10min progressif puis allure continue ${intensity}, retour au calme 5min`);
  } else if (type.includes('CYCLISME') || type.includes('VELO') || type.includes('BIKE')) {
    // BUG RÉEL CORRIGÉ (même famille que la course à pied ci-dessus) : cette condition ne
    // se déclenchait que si `intensity` était VIDE ou contenait littéralement le mot "FTP"
    // — une valeur déjà chiffrée en watts hallucinée par l'IA (ex: "180W") passait telle
    // quelle même sans FTP connue. On force maintenant le repli RPE dès que la FTP est
    // absente, quelle que soit la valeur déjà présente (sauf si déjà RPE/ressenti).
    const alreadyRpeBasedBike = /ressenti|rpe/i.test(String(intensity || ''));
    if (!profile?.ftp && !alreadyRpeBasedBike) {
      intensity = 'Effort selon ressenti (RPE 6/10) — FTP non renseignée';
    } else if (!intensity || intensity.includes('FTP')) {
      if (profile && profile.ftp) {
        intensity = `${Math.round(profile.ftp * 0.75)}W (75% FTP)`;
      } else {
        intensity = 'Effort selon ressenti (RPE 6/10) — FTP non renseignée';
      }
    }
    cadence = cadence || '85-95 rpm';
    effortZone = effortZone || 'Z2-Z4';
    avgBpm = (profile?.fcMax && profile?.fcRepos) ? (avgBpm || `${Math.round(fcRepos + (fcMax - fcRepos) * 0.6)} bpm`) : (avgBpm || null);
    cardio = cardio || (avgBpm ? `${effortZone} (${avgBpm})` : effortZone);
    rpe = rpe || 'RPE 6/10';
    restTime = restTime || (isInterval ? "Récup. souple 3' à 5' entre les blocs (cadence libre, faible résistance)" : '-');
    structure = structure || (isInterval
      ? `Échauffement 15min progressif + blocs à ${intensity} + retour au calme 10min souple`
      : `Échauffement 10-15min progressif puis allure continue ${intensity}, retour au calme 10min`);
  } else if (type.includes('NATATION') || type.includes('SWIM')) {
    // BUG RÉEL CORRIGÉ (même famille) : `intensity || (...)` ne comblait QUE un champ vide —
    // une allure "1:35 /100m" hallucinée par l'IA sans CSS connue n'était jamais remplacée.
    //
    // BUG RÉEL CORRIGÉ (2e passe) : cette branche ne recalculait JAMAIS l'allure une fois la
    // CSS renseignée APRÈS coup (ex: onglet Profil, une fois une séance déjà générée) — une
    // fois `intensity` fixée au texte RPE ("... — CSS non renseignée"), il restait non-vide,
    // donc `intensity || (...)` gardait ce texte pour toujours, même après ajout de la CSS.
    // Contrairement à la course à pied et au vélo (où le texte de repli contient une chaîne
    // qui retombe dans le calcul par coïncidence), rien ici ne redéclenchait le calcul réel.
    // On distingue maintenant explicitement "déjà une vraie allure CSS" de "repli RPE/vide",
    // et on recalcule dès que la CSS est connue et que ce n'est pas déjà le cas.
    const alreadyRpeBasedSwim = /ressenti|rpe/i.test(String(intensity || ''));
    const hasValidSwimPace = !alreadyRpeBasedSwim && /^\d+:\d{2}/.test(String(intensity || ''));
    if (!profile?.nat100 && !alreadyRpeBasedSwim) {
      intensity = 'Allure confortable selon ressenti — CSS non renseignée';
    } else if (profile?.nat100 && !hasValidSwimPace) {
      intensity = `${profile.nat100} /100m`;
    } else if (!intensity) {
      intensity = 'Allure confortable selon ressenti — CSS non renseignée';
    }
    cadence = cadence || '34-38 mvt/min';
    effortZone = effortZone || 'Z2-Z3';
    cardio = cardio || effortZone;
    rpe = rpe || 'RPE 5/10';
    restTime = restTime || (isInterval ? "15 à 30s de repos entre les séries de 100m" : '-');
    structure = structure || (isInterval
      ? `Échauffement 300-400m souple + série principale à ${intensity} + retour au calme 200m`
      : `Nage continue à allure ${intensity}, technique surveillée`);
    // Repli déterministe "feuille de club" (voir buildSwimClubDesc/swimDescFormatIssue
    // ci-dessus) : ne s'active QUE si "desc" est absent, c'est-à-dire soit jamais fourni,
    // soit réinitialisé par sanitizeWorkout suite à un format non conforme détecté par
    // checkWorkoutCoherence — ne remplace jamais un "desc" déjà correct venant de l'IA.
    workout.desc = workout.desc || buildSwimClubDesc(profile, { effortZoneLabel: effortZone });
  } else {
    intensity = intensity || 'Récupération';
    cadence = cadence || '-';
    effortZone = effortZone || 'Repos';
    cardio = cardio || (fcRepos ? `< ${Math.round(fcRepos + 5)} bpm` : 'Repos');
    rpe = rpe || 'RPE 1/10';
    restTime = restTime || '-';
    structure = structure || 'Repos complet ou mobilité légère / étirements.';
  }

  return { ...workout, intensity, cadence, cardio, rpe, effortZone, avgBpm, restTime, structure };
}

/**
 * DOUBLE CHECK COHÉRENCE : contrôle et corrige automatiquement les valeurs
 * générées par l'IA avant tout affichage (bornes physiologiques réalistes).
 */
export function checkWorkoutCoherence(workout, profile) {
  const issues = [];
  if (!workout) return { valid: false, issues: ['Séance vide'] };
  const type = (workout.type || '').toUpperCase();
  // Pas de FC max/repos par défaut inventée : sans donnée réelle, on ne peut
  // simplement pas juger si un bpm est cohérent, donc on ne tente pas le contrôle.
  const fcMax = profile?.fcMax || null;
  const fcRepos = profile?.fcRepos || null;
  // Une intensité exprimée "selon ressenti / RPE" est le format attendu quand la
  // métrique correspondante (VMA/FTP/CSS) n'est pas renseignée — ce n'est PAS une
  // erreur à corriger, contrairement à un format numérique invalide.
  const isRpeBased = /ressenti|rpe/i.test(String(workout.intensity || ''));

  // Chaque issue est taguée avec le(s) champ(s) fautif(s), pour ne corriger
  // QUE ce qui pose problème (jamais effacer une séance entière déjà correcte).
  if (fcMax && fcRepos) {
    const bpmMatch = String(workout.avgBpm || workout.cardio || '').match(/(\d{2,3})/);
    if (bpmMatch) {
      const bpm = Number(bpmMatch[1]);
      if (bpm < fcRepos - 5 || bpm > fcMax + 5) {
        issues.push({ message: `BPM incohérent (${bpm})`, fields: ['avgBpm', 'cardio'] });
      }
    }
  }

  // GARDE-FOU AJOUTÉ : une valeur chiffrée (watts/allure) SANS que la métrique de
  // référence (FTP/VMA/CSS) soit connue n'est jamais "cohérente" par définition — on ne
  // peut littéralement pas la juger, donc elle est forcément fausse/inventée. Avant, ces
  // 3 contrôles étaient entièrement gardés par `&& profile?.xxx`, donc silencieusement
  // IGNORÉS (pas d'issue levée) dès que la métrique était absente — une allure/puissance
  // hallucinée par l'IA malgré une VMA/FTP/CSS non renseignée n'était jamais détectée ni
  // corrigée. `enrichWorkoutMetrics` ci-dessus corrige déjà ce cas à la source, mais ce
  // filet de sécurité est indépendant (ex: si un champ est réécrit ailleurs) : on
  // détecte ici toute valeur chiffrée orpheline et on la fait réinitialiser.
  if (!isRpeBased && (type.includes('CYCLISME') || type.includes('VELO') || type.includes('BIKE')) && !profile?.ftp) {
    if (/\d{2,4}\s*W\b/i.test(String(workout.intensity || ''))) {
      issues.push({ message: 'Puissance chiffrée présente sans FTP renseignée (valeur non justifiable)', fields: ['intensity'] });
    }
  }
  if (!isRpeBased && (type.includes('CYCLISME') || type.includes('VELO') || type.includes('BIKE')) && profile?.ftp) {
    const wMatch = String(workout.intensity || '').match(/(\d{2,4})\s*W/i);
    if (wMatch && (Number(wMatch[1]) < 40 || Number(wMatch[1]) > profile.ftp * 1.3)) {
      issues.push({ message: `Puissance incohérente (${wMatch[1]}W)`, fields: ['intensity'] });
    }
  }
  if (!isRpeBased && (type.includes('C.A.P') || type.includes('RUN')) && !profile?.vma && !hasValidPaceZones(profile?.paceZones)) {
    if (/\d+:\d{2}\s*\/?\s*(min\/)?km/i.test(String(workout.intensity || ''))) {
      issues.push({ message: 'Allure chiffrée présente sans VMA renseignée (valeur non justifiable)', fields: ['intensity'] });
    }
  }
  if (!isRpeBased && (type.includes('C.A.P') || type.includes('RUN')) && (profile?.vma || hasValidPaceZones(profile?.paceZones))) {
    // Allure attendue au format min/km (ex: "4:30 /km"), jamais en km/h.
    const intensityStr = String(workout.intensity || '');
    const hasKmh = /\d+(?:[.,]\d+)?\s*k\s*m\s*\/?\s*h/i.test(intensityStr);
    const paceMatch = intensityStr.match(/(\d+):(\d{2})\s*\/?\s*(?:min\/)?km/i);
    if (hasKmh || !paceMatch) {
      issues.push({
        message: hasKmh
          ? `Allure donnée en km/h au lieu de min/km (${intensityStr})`
          : 'Format allure course invalide (attendu min/km)',
        fields: ['intensity'],
      });
    } else {
      const paceMin = Number(paceMatch[1]) + Number(paceMatch[2]) / 60;
      const speedKmh = 60 / paceMin;
      const bounds = paceSanityBoundsKmh(profile);
      if (bounds && (speedKmh < bounds[0] || speedKmh > bounds[1])) {
        issues.push({ message: `Allure incohérente (${paceMatch[0]})`, fields: ['intensity'] });
      }
    }
  }
  if (!isRpeBased && (type.includes('NATATION') || type.includes('SWIM')) && profile?.nat100) {
    if (!/^\d:\d{2}/.test(String(workout.intensity || ''))) {
      issues.push({ message: 'Format allure natation invalide (attendu min/100m)', fields: ['intensity'] });
    }
  }
  if (!isRpeBased && (type.includes('NATATION') || type.includes('SWIM')) && !profile?.nat100) {
    if (/^\d:\d{2}/.test(String(workout.intensity || ''))) {
      issues.push({ message: 'Allure natation chiffrée présente sans CSS renseignée (valeur non justifiable)', fields: ['intensity'] });
    }
  }

  // GARDE-FOU AJOUTÉ — FORMALISME "FEUILLE DE CLUB" (natation) : jusqu'ici, le format
  // en 3 blocs (Échauffement / Corps de séance / Total) demandé par le prompt de
  // génération (RÈGLE ABSOLUE N°2, voir lib/gemini.js) reposait UNIQUEMENT sur
  // l'obéissance de l'IA à l'instruction — rien ne le vérifiait ni ne le corrigeait
  // après coup, contrairement à tous les autres garde-fous de cette fonction. Résultat :
  // une séance natation pouvait revenir en prose vague ("Nage 2000m en endurance,
  // varier les allures") sans que ça ne soit jamais détecté. On applique maintenant le
  // même principe de robustesse qu'ailleurs dans ce fichier : on vérifie le format
  // réel du texte, et si besoin `sanitizeWorkout` régénère "desc" via
  // `buildSwimClubDesc` ci-dessous (jamais laissé au hasard de la réponse du modèle).
  if (type.includes('NATATION') || type.includes('SWIM')) {
    const descIssue = swimDescFormatIssue(workout.desc);
    if (descIssue) {
      issues.push({ message: descIssue, fields: ['desc'] });
    }
  }

  // GARDE-FOU EXPERT : une séance par intervalles (ex: "6x800m", "10x30/30") doit
  // impérativement préciser sa structure (échauffement / corps / retour au calme)
  // et un temps de repos explicite entre répétitions — sinon la séance est incomplète
  // pour l'athlète, même si les champs "obligatoires" sont techniquement remplis.
  const isInterval = /\d+\s*[x×*]\s*\(?\s*\d+/i.test(`${workout.title || ''} ${workout.desc || ''}`);
  if (isInterval && (!workout.restTime || workout.restTime === '-')) {
    issues.push({ message: 'Séance par intervalles sans temps de repos précisé', fields: ['restTime'] });
  }
  if (isInterval && (!workout.structure || workout.structure.length < 15)) {
    issues.push({ message: 'Structure de séance manquante ou trop vague', fields: ['structure'] });
  }
  return { valid: issues.length === 0, issues };
}

/**
 * Corrige automatiquement une séance dont la cohérence a échoué,
 * en ne ré-enrichissant QUE les champs fautifs (jamais toute la séance),
 * pour ne pas écraser un contenu généré par l'IA qui était correct.
 */
// BUG RÉEL SUSPECTÉ : clic sur une séance -> erreur ("Application error" côté Next.js,
// pas de error boundary dans l'app). Cause la plus probable : la réponse JSON de l'IA
// ne garantit à AUCUN endroit que les champs textuels (desc, structure, title,
// intensity, cardio, rpe, effortZone, avgBpm, restTime) sont bien des chaînes — un champ
// renvoyé comme objet/array par le modèle (plus probable sur les séances enchaînement/
// brick, plus complexes à structurer) fait planter React au rendu de WorkoutDetail.js
// ("Objects are not valid as a React child"), qui ne s'affiche QUE quand on ouvre le
// détail de LA séance concernée — jamais en survolant juste le calendrier. On force donc
// ICI, avant toute autre logique, chaque champ texte affiché quelque part dans l'app à
// être une vraie chaîne lisible plutôt que de laisser un objet/array remonter jusqu'au
// rendu et casser toute la page.
const TEXT_FIELDS_TO_COERCE = ['title', 'desc', 'structure', 'intensity', 'cardio', 'rpe', 'effortZone', 'avgBpm', 'restTime', 'duration', 'cadence', 'day'];

function toSafeText(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map((v) => toSafeText(v)).join('\n');
  if (typeof value === 'object') {
    // Objet inattendu (ex: {fr: "...", en: "..."} ou {min, sec}) : on tente d'en tirer
    // quelque chose de lisible plutôt que de planter le rendu ou d'afficher "[object Object]".
    const values = Object.values(value).filter((v) => typeof v === 'string' || typeof v === 'number');
    return values.length ? values.join(' ') : JSON.stringify(value);
  }
  return String(value);
}

function sanitizeWorkoutFieldTypes(workout) {
  if (!workout) return workout;
  const safe = { ...workout };
  TEXT_FIELDS_TO_COERCE.forEach((field) => {
    if (field in safe) safe[field] = toSafeText(safe[field]);
  });
  return safe;
}

export function sanitizeWorkout(workout, profile) {
  if (!workout) return workout;
  workout = sanitizeWorkoutFieldTypes(workout);
  // Normalisation du type EN PREMIER : toute la suite (enrichissement, badges,
  // filtres calendrier) se base sur cette valeur canonique — voir classifyDiscipline
  // ci-dessus pour pourquoi c'est nécessaire.
  const canonicalType = classifyDiscipline(workout.type);
  const normalized = canonicalType ? { ...workout, type: canonicalType } : workout;
  const enriched = enrichWorkoutMetrics(normalized, profile);
  const { valid, issues } = checkWorkoutCoherence(enriched, profile);
  if (valid) return enriched;
  const fieldsToReset = new Set(issues.flatMap((i) => i.fields || []));
  const reset = { ...enriched };
  fieldsToReset.forEach((f) => { reset[f] = null; });
  return enrichWorkoutMetrics(reset, profile);
}

const REQUIRED_WORKOUT_FIELDS = ['id', 'day', 'type', 'title', 'duration', 'intensity', 'cadence', 'cardio', 'rpe', 'desc', 'structure'];

export function validateWorkout(workout) {
  const missing = REQUIRED_WORKOUT_FIELDS.filter(
    (field) => !workout || workout[field] === undefined || workout[field] === null || String(workout[field]).trim() === ''
  );
  return { valid: missing.length === 0, missing };
}

/**
 * GARDE-FOU DE BASE (avant même enforceSessionCount, checkSessionCountCoherence,
 * rebalanceSameDisciplineDoubles, dedupeIdenticalSameDaySessions...) : garantit que
 * les 7 jours de DAYS_OF_WEEK sont TOUS représentés dans la semaine, quoi que l'IA
 * ait réellement renvoyé.
 *
 * BUG RÉEL CORRIGÉ ICI : une réponse IA incomplète (ex: seulement 3 jours sur 7 dans
 * le JSON — ça arrive) faisait planter toute la logique de correction en aval, sans
 * qu'aucune fonction ne s'en rende compte : `enforceSessionCount` ne voit QUE les
 * jours présents dans le tableau reçu, donc quand il doit compléter le nombre de
 * séances manquantes, il ne peut les distribuer QUE sur ces quelques jours — d'où
 * un empilement de 5 à 7 séances sur un seul jour visible (ex: samedi) pendant que
 * le reste de la semaine restait vide à l'écran, au lieu d'une vraie répartition sur
 * les 7 jours.
 *
 * Ajoute un REPOS "neutre" pour chaque jour manquant — jamais une vraie séance
 * inventée à sa place — et ne touche JAMAIS aux jours déjà présents. Idempotent :
 * appeler cette fonction plusieurs fois de suite ne change rien après le premier appel.
 */
export function ensureAllDaysPresent(weekWorkouts) {
  const list = Array.isArray(weekWorkouts) ? [...weekWorkouts] : [];
  const presentDays = new Set(list.map((w) => normalizeDayName(w.day, null)).filter(Boolean));
  DAYS_OF_WEEK.forEach((day, idx) => {
    if (!presentDays.has(day)) {
      list.push({
        id: `auto-missing-${day}-${Date.now()}-${idx}`,
        day,
        type: 'REPOS',
        title: 'Repos complet',
        duration: '0 min',
        intensity: 'Récupération',
        modified: false,
        desc: 'Repos.',
      });
    }
  });
  return list;
}

export function ensureCompleteWorkouts(workoutsObj, profile) {
  if (!workoutsObj) return { N: [], 'N+1': [] };
  return {
    N: ensureAllDaysPresent(workoutsObj.N || []).map(w => sanitizeWorkout(w, profile)),
    'N+1': ensureAllDaysPresent(workoutsObj['N+1'] || []).map(w => sanitizeWorkout(w, profile)),
  };
}

export function getIncompleteWorkouts(workoutsObj) {
  const incomplete = [];
  const checkList = [...(workoutsObj.N || []), ...(workoutsObj['N+1'] || [])];
  checkList.forEach(w => {
    const isInterval = /\d+\s*[x×*]\s*\(?\s*\d+/i.test(`${w.title || ''} ${w.desc || ''}`);
    const missingCore = !w.intensity || !w.duration;
    const missingIntervalDetail = isInterval && (!w.restTime || w.restTime === '-' || !w.structure || w.structure.length < 15);
    if (missingCore || missingIntervalDetail) {
      incomplete.push(w);
    }
  });
  return incomplete;
}

// Classification ROBUSTE de la discipline : l'IA ne respecte pas toujours à la
// lettre l'énumération demandée dans le prompt (ex: "C.A.P/RUN" recopié tel quel,
// "Course à pied" en toutes lettres, "running", etc.) — un simple switch sur la
// valeur exacte laissait alors passer un type non reconnu, ce qui cassait ensuite
// TOUT l'affichage de cette séance (badge, filtre par sport, calendrier : une
// séance de type non reconnu n'est filtrée dans AUCUN sport et disparaît du
// calendrier). Cette fonction reconnaît la discipline quel que soit le texte
// exact renvoyé par l'IA et la ramène TOUJOURS vers une des 5 valeurs canoniques
// utilisées partout dans l'app.
export function classifyDiscipline(type) {
  const t = (type || '').toUpperCase();
  if (!t) return null;
  if (t.includes('REPOS') || t.includes('REST') || t.includes('OFF')) return 'REPOS';
  if (t.includes('ENCHA') || t.includes('BRICK')) return 'ENCHAÎNEMENT';
  if (t.includes('NATATION') || t.includes('SWIM') || t.includes('NAGE') || t.includes('NAT')) return 'NATATION';
  if (t.includes('CYCLISME') || t.includes('VELO') || t.includes('VÉLO') || t.includes('BIKE') || t.includes('CYCL')) return 'CYCLISME';
  if (t.includes('C.A.P') || t.includes('CAP') || t.includes('RUN') || t.includes('COURSE') || t.includes('COURIR')) return 'C.A.P';
  return null; // Type vraiment non identifiable : on ne devine pas au hasard.
}

// POIDS D'UNE SÉANCE dans le total "séances/semaine" déclaré au questionnaire (voir RÈGLE
// ABSOLUE N°0 du prompt, lib/gemini.js:buildWorkoutSchema) : une séance d'enchaînement (brick)
// combine PAR CONSTRUCTION 2 disciplines en une seule entrée (1 ligne dans le calendrier) —
// elle compte donc pour DEUX séances dans le total, pas une seule, exactement comme le prompt
// l'indique déjà à l'IA. BUG CORRIGÉ : checkSessionCountCoherence/enforceSessionCount comptaient
// avant un brick comme 1 SEULE entrée (`.filter(w => w.type !== 'REPOS').length`), en désaccord
// avec cette règle envoyée à l'IA — résultat observé : le calcul déterministe croyait qu'il
// manquait des séances alors qu'un brick en avait déjà "payé" deux, et rajoutait des séances
// supplémentaires au mauvais endroit (jour déjà chargé) pendant qu'un autre jour qui aurait dû
// doubler restait simple. Toutes les fonctions qui comptent des séances vs `maxSessionsPerWeek`
// doivent utiliser ce poids, jamais un simple `.length` sur la liste filtrée.
export function sessionWeight(w) {
  return classifyDiscipline(w?.type) === 'ENCHAÎNEMENT' ? 2 : 1;
}

// Libellés courts et cohérents utilisés PARTOUT dans l'app (calendrier, détail, filtres, chat)
export function shortLabel(type) {
  switch (classifyDiscipline(type)) {
    case 'NATATION':
      return 'SWIM';
    case 'CYCLISME':
      return 'BIKE';
    case 'C.A.P':
      return 'RUN';
    case 'ENCHAÎNEMENT':
      return 'BRICK';
    case 'REPOS':
      return 'REPOS';
    default:
      return type?.slice(0, 5) || '-';
  }
}

/**
 * Champs de détail à afficher pour une séance, adaptés à la discipline
 * (RUN : zone d'effort / allure / BPM moyen — BIKE : watts / effort / cardio —
 * SWIM : zone d'effort / allure), avec le temps de repos toujours inclus.
 */
export function getDetailFields(workout) {
  const label = shortLabel(workout.type);
  const rest = { label: 'TEMPS DE REPOS', value: workout.restTime || '-' };  if (label === 'BIKE') {
    return [
      { label: 'WATTS', value: workout.intensity || '-' },
      { label: 'EFFORT (RPE)', value: workout.rpe || '-' },
      { label: 'CARDIO', value: workout.cardio || workout.avgBpm || '-' },
      rest,
    ];
  }
  if (label === 'SWIM') {
    return [
      { label: "ZONE D'EFFORT", value: workout.effortZone || workout.cardio || '-' },
      { label: 'ALLURE', value: workout.intensity || '-' },
      rest,
    ];
  }
  if (label === 'RUN' || label === 'BRICK') {
    return [
      { label: "ZONE D'EFFORT", value: workout.effortZone || '-' },
      { label: 'ALLURE', value: workout.intensity || '-' },
      { label: 'BPM MOYEN', value: workout.avgBpm || '-' },
      rest,
    ];
  }
  return [
    { label: 'INTENSITÉ', value: workout.intensity || '-' },
    { label: 'CARDIO', value: workout.cardio || '-' },
    rest,
  ];
}

// BUG CORRIGÉ : le calendrier (CalendarView) affiche une séance dans une colonne
// UNIQUEMENT si `workout.day` correspond exactement (insensible à la casse) à un des
// 7 jours de DAYS_OF_WEEK. Or le coach IA ne renvoie pas toujours ce format exact pour
// une séance ajoutée via le chat (accents/espaces en trop, abréviation "Lun.", jour mal
// orthographié...). Une telle séance était bien ajoutée en mémoire (donc comptée) mais
// n'apparaissait dans AUCUNE colonne du calendrier — elle semblait "disparaître". On
// normalise donc systématiquement `day` vers une valeur canonique de DAYS_OF_WEEK avant
// de l'enregistrer, avec un repli explicite (jamais un jour perdu silencieusement).
function normalizeDayName(day, fallback = DAYS_OF_WEEK[0]) {
  const raw = String(day || '').trim();
  if (!raw) return fallback;
  const strip = (s) => s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // retire les accents
    .toLowerCase();
  const target = strip(raw);
  const exact = DAYS_OF_WEEK.find((d) => strip(d) === target);
  if (exact) return exact;
  // Repli sur les 3 premières lettres (ex: "Lun", "lundi.", "Lun 12/05") : couvre les
  // abréviations et les jours renvoyés avec une date accolée sans dépendre d'un format précis.
  const prefixMatch = DAYS_OF_WEEK.find((d) => target.startsWith(strip(d).slice(0, 3)));
  return prefixMatch || fallback;
}

/**
 * Applique les patches du coach IA aux séances.
 * - patchMode 'add'    : ajoute TOUJOURS une nouvelle séance (jamais d'écrasement), utile pour un jour double.
 * - patchMode 'modify' (défaut) : remplace la séance existante du jour en conservant l'ancienne
 *   version dans `previous` pour comparaison avant/après.
 */
export function mergeWorkoutPatches(workoutsObj, patches, profile) {
  if (!patches || !Array.isArray(patches)) return workoutsObj;
  const copy = {
    N: [...(workoutsObj.N || [])],
    'N+1': [...(workoutsObj['N+1'] || [])],
  };

  patches.forEach(patch => {
    const weekKey = patch.week || 'N';
    if (!copy[weekKey]) return;
    const mode = patch.patchMode === 'add' ? 'add' : 'modify';
    const normalizedDay = normalizeDayName(patch.day);

    if (mode === 'add') {
      copy[weekKey].push(sanitizeWorkout({
        id: patch.id || 'w_' + Math.random().toString(36).substring(2, 7),
        day: normalizedDay,
        type: patch.type || 'AUTRE',
        title: patch.title || 'Séance ajoutée',
        duration: patch.duration || '45 min',
        desc: patch.desc || 'Séance ajoutée par le coach.',
        modified: true,
        added: true,
        ...patch,
        day: normalizedDay,
      }, profile));
      return;
    }

    const index = copy[weekKey].findIndex(w => w.id === patch.id || w.day?.toLowerCase() === normalizedDay.toLowerCase());
    if (index !== -1) {
      const previous = { ...copy[weekKey][index] };
      copy[weekKey][index] = sanitizeWorkout({
        ...previous,
        ...patch,
        day: normalizeDayName(patch.day, previous.day),
        previous,
        modified: true,
      }, profile);
    } else {
      copy[weekKey].push(sanitizeWorkout({
        id: patch.id || 'w_' + Math.random().toString(36).substring(2, 7),
        day: normalizedDay,
        type: patch.type || 'AUTRE',
        title: patch.title || 'Séance ajustée',
        duration: patch.duration || '1h00',
        desc: patch.desc || '',
        modified: true,
        ...patch,
        day: normalizedDay,
      }, profile));
    }
  });

  return copy;
}

/**
 * Fusionne une réponse de "correction" de l'IA avec la semaine d'origine SANS
 * jamais pouvoir perdre de jour. Avant, une correction (complétion de champs
 * manquants ou ajustement du nombre de séances) remplaçait la semaine entière
 * par ce que l'IA renvoyait (`data.workouts = fixData.workouts`) — si l'IA ne
 * renvoyait qu'un sous-ensemble des 7 jours (ex: seulement les jours corrigés),
 * la moitié de la semaine disparaissait purement et simplement du calendrier.
 * Ici, on fusionne jour par jour : chaque jour présent dans `fixedWeek` remplace
 * le jour correspondant dans `originalWeek`, mais tout jour ABSENT de la réponse
 * de correction conserve sa version d'origine — jamais de perte.
 */
export function mergeWeekFix(originalWeek, fixedWeek) {
  const original = Array.isArray(originalWeek) ? originalWeek : [];
  const fixed = Array.isArray(fixedWeek) ? fixedWeek : [];
  if (fixed.length === 0) return original;

  // BUG RÉEL CORRIGÉ ICI : l'ancienne version indexait les séances UNIQUEMENT par
  // "day" via une Map (clé = jour). Sur un jour simple ça marche, mais sur un jour
  // DOUBLE (ex: samedi = natation + vélo), une Map ne peut garder qu'UNE seule
  // valeur par clé : la 2e séance du jour écrasait la 1re dès la construction de la
  // Map à partir de l'original, puis `original.map(w => byDay.get(w.day) || w)`
  // faisait récupérer aux DEUX positions "samedi" de l'array la MÊME valeur —
  // résultat : les deux séances du jour double devenaient identiques (même
  // discipline, même contenu), et une séance distincte disparaissait purement et
  // simplement. On indexe donc désormais par "id" (présent sur chaque séance,
  // imposé par le schéma envoyé à l'IA) qui reste unique même sur un jour double.
  // Repli par "day" conservé UNIQUEMENT quand ce jour ne contient qu'une seule
  // séance dans l'original (aucune collision possible dans ce cas) — sur un jour
  // double sans id fiable, on préfère garder la séance d'origine plutôt que de
  // risquer de la dupliquer/écraser à l'aveugle.
  const dayCounts = {};
  original.forEach((w) => {
    const key = w.day?.toLowerCase();
    if (key) dayCounts[key] = (dayCounts[key] || 0) + 1;
  });

  const fixedById = new Map(fixed.filter((w) => w?.id).map((w) => [w.id, w]));
  const fixedByDay = new Map(fixed.filter((w) => w?.day).map((w) => [w.day.toLowerCase(), w]));

  const result = original.map((w) => {
    if (w.id && fixedById.has(w.id)) return fixedById.get(w.id);
    const dayKey = w.day?.toLowerCase();
    if (dayKey && dayCounts[dayKey] === 1 && fixedByDay.has(dayKey)) return fixedByDay.get(dayKey);
    return w;
  });

  // Ajoute en fin toute entrée de `fixed` totalement nouvelle (id absent de
  // l'original ET jour absent de l'original) — cas limite.
  const originalIds = new Set(original.filter((w) => w.id).map((w) => w.id));
  const originalDays = new Set(original.map((w) => w.day?.toLowerCase()));
  fixed.forEach((w) => {
    if (w?.id && originalIds.has(w.id)) return; // déjà fusionné ci-dessus
    if (w?.day && !originalDays.has(w.day.toLowerCase())) result.push(w);
  });

  return result;
}

// --- COHÉRENCE NOMBRE DE SÉANCES vs QUESTIONNAIRE ------------------------------
// Avant : rien ne garantissait que le nombre de jours réellement entraînés dans
// le plan généré corresponde à `maxSessionsPerWeek`, ni que le jour de repos
// choisi (`offDays`) soit bien un vrai jour REPOS — le prompt le demandait
// "gentiment" mais rien ne le vérifiait ni ne le corrigeait. Ces fonctions
// contrôlent ET corrigent déterministiquement, en dernier recours, si l'IA
// n'a pas respecté la contrainte après ses tentatives de correction.

/**
 * Vérifie, pour une semaine de séances (7 entrées attendues), que :
 *  - le nombre de jours d'entraînement réel == maxSessionsPerWeek
 *  - le(s) jour(s) de repos obligatoire(s) déclaré(s) sont bien de type REPOS
 * Retourne la liste des problèmes détectés (vide = cohérent).
 */
export function checkSessionCountCoherence(weekWorkouts, maxSessionsPerWeek, offDays) {
  const issues = [];
  const list = Array.isArray(weekWorkouts) ? weekWorkouts : [];
  const target = Number(maxSessionsPerWeek);
  if (!target) return issues;

  const trainingDays = list.filter((w) => w.type !== 'REPOS');
  // Pondéré (voir sessionWeight) : un brick compte pour 2, jamais 1 — sinon ce contrôle
  // déclenche une "correction" (enforceSessionCount) alors que le total est déjà correct.
  const weightedCount = trainingDays.reduce((sum, w) => sum + sessionWeight(w), 0);
  if (weightedCount !== target) {
    issues.push({
      message: `${weightedCount} séance(s) générée(s) (comptage brick=2 inclus) au lieu des ${target} demandées au questionnaire.`,
      actual: weightedCount,
      expected: target,
    });
  }

  const mandatoryOffDays = String(offDays || '').split(',').map((d) => d.trim()).filter(Boolean);
  mandatoryOffDays.forEach((day) => {
    const entry = list.find((w) => w.day?.toLowerCase() === day.toLowerCase());
    if (entry && entry.type !== 'REPOS') {
      issues.push({
        message: `Le ${day} devait être un jour de repos obligatoire mais contient une séance (${entry.type}).`,
        day,
      });
    }
  });

  return issues;
}

/**
 * Correction déterministe de dernier recours (utilisée seulement si l'IA n'a
 * toujours pas respecté la contrainte après une tentative de correction via
 * prompt) : ne supprime ni n'invente jamais une séance sans raison — bascule
 * uniquement les jours en trop / manquants pour respecter le nombre demandé,
 * en gardant toujours le(s) jour(s) de repos obligatoire(s) en REPOS et en
 * conservant les séances les plus longues (généralement les plus structurantes
 * de la semaine) quand il faut réduire.
 */
// Catalogue de séances "complémentaires" VARIÉES par discipline — utilisé quand il
// faut ajouter une séance sur un jour double. Le but : ne JAMAIS proposer deux fois
// la même séance sur un même jour (ce qui donnait par ex. "2x le même footing" en
// mono-discipline course à pied) — chaque entrée a un titre, une durée et une
// intensité différents, pour un vrai travail structuré et réparti.
// Les desc ci-dessous suivent EXACTEMENT le même formalisme "feuille de club" que
// celui imposé à l'IA (RÈGLE ABSOLUE N°2 du prompt, lib/gemini.js) : blocs
// "Échauffement :" / "Corps de séance :" / retour au calme, notation compacte
// "N*(effort - récupération)" (course/vélo, en % VMA/FTP) ou "N*Dm ... R : XX''"
// + "Total : XXXXm" (natation). Objectif : qu'une séance de secours déterministe
// soit visuellement indiscernable d'une séance générée par l'IA — jamais de retour
// à une phrase de prose qui casserait la cohérence visuelle du calendrier.
const COMPLEMENTARY_TEMPLATES = {
  'C.A.P': [
    { title: 'Footing récupération', duration: '25 min', desc: "Échauffement :\n5' marche active + éducatifs légers\nCorps de séance :\n15' continu en Z1, décontraction complète, aucune notion de performance\n5' retour au calme en marche", cardio: 'Z1', rpe: 'RPE 3/10' },
    { title: 'Footing endurance fondamentale', duration: '45 min', desc: "Échauffement :\n10' progressif Z1→Z2\nCorps de séance :\n30' continu en endurance fondamentale (Z2), allure conversationnelle\n5' retour au calme souple", cardio: 'Z2', rpe: 'RPE 5/10' },
    { title: 'Côtes courtes', duration: '35 min', desc: "Échauffement :\n15' progressif Z1-Z2\nCorps de séance :\n8*(20'' côte forte @95% VMA - 1' récup descente souple)\n10' retour au calme", cardio: 'Z4', rpe: 'RPE 7/10' },
    { title: 'Technique de course & gainage', duration: '30 min', desc: "Échauffement :\n10' footing souple\nCorps de séance :\n15' éducatifs de course (montées de genoux, talons-fesses, foulées bondissantes) + circuit gainage\n5' retour au calme", cardio: 'Z1-Z2', rpe: 'RPE 4/10' },
    { title: 'Fractionné court VMA', duration: '40 min', desc: "Échauffement :\n15' progressif Z1-Z2\nCorps de séance :\n8*(30'' @100% VMA - 30'' récup trot souple)\n10' retour au calme", cardio: 'Z5', rpe: 'RPE 8/10' },
  ],
  CYCLISME: [
    { title: 'Vélo récupération active', duration: '30 min', desc: "Échauffement :\n5' très souple\nCorps de séance :\n20' continu en Z1, cadence élevée (>95rpm), zéro friction\n5' retour au calme", cardio: 'Z1', rpe: 'RPE 3/10' },
    { title: 'Vélo endurance', duration: '1h00', desc: "Échauffement :\n10' progressif\nCorps de séance :\n40' continu en Z2, cadence libre, focus posture aérodynamique\n10' retour au calme souple", cardio: 'Z2', rpe: 'RPE 5/10' },
    { title: 'Home trainer — force sous cadence', duration: '40 min', desc: "Échauffement :\n10' progressif\nCorps de séance :\n6*(3' côte simulée @75% FTP, cadence <65rpm - 2' récup souple)\n5' retour au calme", cardio: 'Z3', rpe: 'RPE 6/10' },
    { title: 'Vélo sweetspot', duration: '50 min', desc: "Échauffement :\n10' progressif\nCorps de séance :\n2*(12' @90% FTP (sweetspot) - 5' récup souple)\n6' retour au calme", cardio: 'Z3-Z4', rpe: 'RPE 7/10' },
  ],
  NATATION: [
    { title: 'Natation récupération', duration: '25 min', desc: "Échauffement :\n200 NC souple, focus respiration\nCorps de séance :\n4*100 PULL souple R : 20'' focus glisse\n4*50 educ (battements/doigts traînants) R : 15''\n---\n200 souple\nTotal : 1000m", cardio: 'Z1', rpe: 'RPE 3/10' },
    { title: 'Natation technique', duration: '35 min', desc: "Échauffement :\n200 NC souple\nCorps de séance :\n6*50 educ (battements/catch-up/doigts traînants) R : 20''\n6*100 PULL Z2 R : 15''\n4*50 PLAQ R : 20''\n---\n200 souple\nTotal : 1700m", cardio: 'Z1-Z2', rpe: 'RPE 4/10' },
    { title: 'Natation allure spécifique', duration: '40 min', desc: "Échauffement :\n300 NC souple\nCorps de séance :\n6*100 PLAQ R : 15''\n8*100 all HALF R : 20''\n4*50 palmes vitesse R : 30''\n---\n200 souple\nTotal : 2000m", cardio: 'Z3', rpe: 'RPE 6/10' },
    { title: 'Natation pyramide matériel', duration: '40 min', desc: "Échauffement :\n300 NC souple\nCorps de séance :\n300-200-100 PULL R : 20''\n100-200-300 PLAQ R : 20''\n4*50 palmes vitesse R : 30''\n---\n200 souple\nTotal : 2000m", cardio: 'Z2-Z3', rpe: 'RPE 6/10' },
  ],
};

/**
 * Construit une nouvelle séance "double" cohérente pour `targetDay` et la discipline
 * `nextType` déjà décidée par l'appelant (voir enforceSessionCount) : choisit un type de
 * séance (récupération / endurance / côtes / technique / fractionné) différent de ceux
 * déjà présents ce jour-là pour cette discipline, jamais un doublon du même contenu.
 */
function buildComplementaryWorkout(targetDay, list, nextType, seed) {
  const templates = COMPLEMENTARY_TEMPLATES[nextType] || COMPLEMENTARY_TEMPLATES['C.A.P'];
  // Le pool de titres déjà utilisés est vérifié sur TOUTE LA SEMAINE, pas seulement sur
  // le jour cible : avec beaucoup de séances/semaine, plusieurs ajouts automatiques de
  // la même discipline peuvent tomber sur des jours différents — sans ce garde-fou
  // élargi, le même template ("Footing récupération" par ex.) pouvait se répéter deux
  // fois dans la semaine sur des jours distincts.
  const usedTitles = new Set(
    list.filter((w) => w.type !== 'REPOS' && classifyDiscipline(w.type) === nextType).map((w) => (w.title || '').trim())
  );
  const available = templates.filter((t) => !usedTitles.has(t.title));
  const pool = available.length > 0 ? available : templates;
  const chosen = pool[seed % pool.length];

  return {
    id: `auto-${targetDay}-${Date.now()}-${seed}`,
    day: targetDay,
    type: nextType,
    title: chosen.title,
    duration: chosen.duration,
    cardio: chosen.cardio,
    rpe: chosen.rpe,
    modified: false,
    // Pas de note explicative dans le desc affiché : la séance doit être visuellement
    // indiscernable d'une séance générée par l'IA (voir commentaire du catalogue
    // ci-dessus). Le fait qu'elle ait été ajoutée automatiquement pour un jour double
    // reste tracé via l'id (préfixe "auto-") pour un usage interne/debug uniquement.
    desc: chosen.desc,
  };
}

/**
 * Filet de sécurité final : si — pour n'importe quelle raison, IA comprise — deux
 * séances d'un même jour se retrouvent quasi identiques (même discipline + même
 * titre), on modifie la seconde pour qu'elle ne soit jamais un pur doublon
 * (contenu ET durée différents), plutôt que de laisser deux fois "la même séance"
 * s'afficher dans le calendrier.
 */
export function dedupeIdenticalSameDaySessions(weekWorkouts) {
  const byDay = {};
  const list = weekWorkouts.map((w) => ({ ...w }));
  list.forEach((w) => {
    if (w.type === 'REPOS') return;
    byDay[w.day] = byDay[w.day] || [];
    byDay[w.day].push(w);
  });

  Object.values(byDay).forEach((sessionsOnDay) => {
    const seenPerDiscipline = {};
    sessionsOnDay.forEach((w, idx) => {
      const disc = classifyDiscipline(w.type);
      const key = `${disc}::${(w.title || '').trim().toLowerCase()}`;
      if (!seenPerDiscipline[disc]) seenPerDiscipline[disc] = new Set();
      if (seenPerDiscipline[disc].has(key.split('::')[1])) {
        // Doublon détecté : on remplace par un template complémentaire différent.
        const templates = COMPLEMENTARY_TEMPLATES[disc] || COMPLEMENTARY_TEMPLATES['C.A.P'];
        const usedTitles = new Set(sessionsOnDay.map((s) => (s.title || '').trim().toLowerCase()));
        const alt = templates.find((t) => !usedTitles.has(t.title.toLowerCase())) || templates[(idx + 1) % templates.length];
        w.title = alt.title;
        w.duration = alt.duration;
        w.cardio = alt.cardio;
        w.rpe = alt.rpe;
        w.desc = `${alt.desc}\n\n(Ajusté automatiquement pour éviter un doublon avec une autre séance du même jour.)`;
      }
      seenPerDiscipline[disc].add((w.title || '').trim().toLowerCase());
    });
  });

  return list;
}

/**
 * Filet de sécurité STRUCTUREL (au-delà du doublon "identique" traité par
 * dedupeIdenticalSameDaySessions ci-dessus) : en triathlon, avoir DEUX séances de la
 * MÊME discipline le même jour (ex: 2x natation), même avec des contenus différents,
 * n'a aucun sens — un jour double doit être un enchaînement de disciplines DIFFÉRENTES
 * (brick : nat+vélo, vélo+course...). On déplace la séance en trop vers un autre jour
 * éligible qui n'a pas encore cette discipline (en priorité le jour le moins chargé),
 * sans jamais toucher aux jours de repos obligatoires ni supprimer de séance. En course
 * à pied mono-discipline, où une seule discipline existe, ce cas est inévitable au-delà
 * d'un certain volume/semaine : on ne touche donc à rien (sportType === 'running').
 */
export function rebalanceSameDisciplineDoubles(weekWorkouts, sportType, offDays, maxSessionsPerWeek) {
  if (sportType === 'running') return weekWorkouts;
  const list = weekWorkouts.map((w) => ({ ...w }));
  const mandatoryOffDays = String(offDays || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  const allDays = [...new Set(list.map((w) => w.day))];
  // Journée à TRIPLE séance autorisée uniquement à partir de >12 séances/semaine visées — voir
  // enforceMaxSessionsPerDay pour le détail de cette règle (3 sports différents obligatoires,
  // 3e séance peu intensive via enforceThirdSessionLowIntensity). En dessous de ce seuil, le
  // plafond reste 2, comme avant.
  const dayCapForRebalance = Number(maxSessionsPerWeek) > 12 ? 3 : 2;

  const disciplineOf = (w) => classifyDiscipline(w.type);
  const sessionsOn = (day) => list.filter((w) => w.day === day && w.type !== 'REPOS');

  let guard = 0;
  while (guard < 30) {
    guard += 1;
    // Cherche un jour avec 2+ séances de la même discipline.
    let offender = null;
    for (const day of allDays) {
      const sessions = sessionsOn(day);
      const byDisc = {};
      sessions.forEach((w) => { byDisc[disciplineOf(w)] = (byDisc[disciplineOf(w)] || []).concat(w); });
      const dup = Object.values(byDisc).find((arr) => arr.length > 1);
      if (dup) { offender = dup[dup.length - 1]; break; } // on déplace la dernière (la plus "en trop")
    }
    if (!offender) break;

    const disc = disciplineOf(offender);
    // Jour d'accueil : éligible (≠ repos obligatoire, ≠ jour d'origine), sans cette
    // discipline aujourd'hui, en priorité le moins chargé. BUG RÉEL CORRIGÉ : cette
    // fonction ignorait la règle "un jour de brick ne reçoit AUCUN compagnon" (voir
    // enforceMaxSessionsPerDay) — elle pouvait donc reloger un doublon PILE sur le jour
    // du brick (aucune discipline en double avec le brick lui-même, donc "éligible" à
    // tort), recréant exactement la violation que enforceMaxSessionsPerDay vient de
    // corriger juste avant dans le pipeline (voir lib/gemini.js, ordre des appels).
    const candidates = allDays
      .filter((day) => day !== offender.day)
      .filter((day) => !mandatoryOffDays.includes(String(day).toLowerCase()))
      .filter((day) => !sessionsOn(day).some((w) => disciplineOf(w) === disc))
      .filter((day) => !sessionsOn(day).some((w) => disciplineOf(w) === 'ENCHAÎNEMENT'))
      // Ne recrée jamais la violation de plafond corrigée par enforceMaxSessionsPerDay
      // ailleurs dans le pipeline (voir lib/gemini.js) : un jour déjà au plafond (2, ou 3
      // si >12 séances/semaine visées) n'est pas une destination valable pour ce déplacement.
      .filter((day) => sessionsOn(day).length < dayCapForRebalance)
      .map((day) => ({ day, count: sessionsOn(day).length }))
      .sort((a, b) => a.count - b.count);

    if (candidates.length === 0) break; // aucune destination possible : on laisse tel quel (best effort)

    const destDay = candidates[0].day;
    const restIdx = list.findIndex((w) => w.day === destDay && w.type === 'REPOS');
    const idx = list.findIndex((w) => w.id === offender.id);
    if (idx === -1) break;

    if (restIdx !== -1) {
      // Le jour d'accueil était repos (non obligatoire) : on y déplace directement la séance.
      list[restIdx] = { ...list[idx], day: destDay };
      list.splice(idx, 1);
    } else {
      list[idx] = { ...list[idx], day: destDay };
    }
  }

  return list;
}

/**
 * Filet de sécurité STRUCTUREL n°2 (complémentaire de rebalanceSameDisciplineDoubles
 * ci-dessus, qui ne détecte QUE les doublons de discipline strictement identique) :
 * un jour d'entraînement ne doit JAMAIS accumuler plus de 2 séances réelles, et un
 * jour qui contient déjà un enchaînement (ENCHAÎNEMENT/brick — qui combine par
 * construction 2 disciplines en une seule séance) ne doit recevoir AUCUNE autre
 * séance ce jour-là (bug réel observé : sortie longue course + vélo + natation PUIS
 * brick course sur le même samedi — 4 séances qui font toutes doublon avec le
 * brick, aucune cohérence). On déplace les séances en trop vers le jour éligible le
 * moins chargé (jamais un jour de repos obligatoire), en gardant en priorité les
 * séances les plus longues/structurantes du jour d'origine — sans jamais supprimer
 * ni fusionner de séance.
 *
 * EXCEPTION TRIPLE SÉANCE : au-delà de 12 séances/semaine visées (maxSessionsPerWeek), le
 * plafond passe à 3 séances/jour au lieu de 2 — une journée à triple séance n'est pas un
 * problème en soi tant qu'elle mélange 3 sports DIFFÉRENTS (garanti par
 * rebalanceSameDisciplineDoubles, qui déplace tout doublon de discipline avant/après cette
 * fonction) et que la 3e séance reste peu intensive (voir enforceThirdSessionLowIntensity,
 * appliquée juste après dans le pipeline). En dessous de 13 séances/semaine, le plafond reste
 * 2 comme avant : une triple journée n'a pas de raison d'être imposée à un volume qui ne la
 * justifie pas.
 */
export function enforceMaxSessionsPerDay(weekWorkouts, offDays, sportType, maxSessionsPerWeek) {
  if (!Array.isArray(weekWorkouts) || weekWorkouts.length === 0) return weekWorkouts;
  const list = weekWorkouts.map((w) => ({ ...w }));
  const mandatoryOffDays = String(offDays || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  const allDays = [...new Set(list.map((w) => w.day))];

  const disciplineOf = (w) => classifyDiscipline(w.type);
  const sessionsOn = (day) => list.filter((w) => w.day === day && w.type !== 'REPOS');
  const allowsTripleDay = Number(maxSessionsPerWeek) > 12;
  const dayCap = (day) => {
    if (sessionsOn(day).some((w) => disciplineOf(w) === 'ENCHAÎNEMENT')) return 1;
    return allowsTripleDay ? 3 : 2;
  };

  let guard = 0;
  while (guard < 30) {
    guard += 1;
    const offenderDay = allDays.find((day) => sessionsOn(day).length > dayCap(day));
    if (!offenderDay) break;

    // Parmi les séances du jour en surnombre, on déplace la/les plus courte(s) en
    // priorité (même logique que enforceSessionCount : on garde la structurante).
    const sessions = sessionsOn(offenderDay).sort((a, b) => parseDurationMinutes(b.duration) - parseDurationMinutes(a.duration));
    const cap = dayCap(offenderDay);
    const toMove = sessions.slice(cap)[0];
    if (!toMove) break;

    // BUG RÉEL CORRIGÉ (screenshot utilisateur : brick + natation + course + vélo le même
    // samedi, 4 séances) : l'ancienne version abandonnait ("best effort, on laisse tel quel")
    // dès qu'aucun jour ne respectait à la fois le cap ET l'absence de la même discipline —
    // ce qui arrive vite avec beaucoup de séances/semaine (peu de jours "libres" restants).
    // Résultat concret : la violation (jour à 3-4 séances, ou brick + compagnon) restait
    // affichée telle quelle. On cherche maintenant en plusieurs paliers, du plus strict au
    // plus permissif, et on ne renonce QUE s'il n'existe vraiment aucun jour non-repos-obligatoire
    // disponible (cas extrême, quasiment jamais atteint sur une semaine de 7 jours).
    const baseCandidates = allDays
      .filter((day) => day !== offenderDay)
      .filter((day) => !mandatoryOffDays.includes(String(day).toLowerCase()));

    const tier1 = baseCandidates // strict : respecte le cap ET pas la même discipline déjà présente
      .filter((day) => sessionsOn(day).length < dayCap(day))
      .filter((day) => !sessionsOn(day).some((w) => disciplineOf(w) === disciplineOf(toMove)));
    const tier2 = baseCandidates // relâche la contrainte de discipline, garde le cap
      .filter((day) => sessionsOn(day).length < dayCap(day));
    const tier3 = baseCandidates; // dernier recours : n'importe quel jour non-repos-obligatoire

    const candidates = (tier1.length ? tier1 : tier2.length ? tier2 : tier3)
      .map((day) => ({ day, count: sessionsOn(day).length }))
      .sort((a, b) => a.count - b.count);

    if (candidates.length === 0) break; // vraiment aucune destination possible (best effort).

    const destDay = candidates[0].day;
    const idx = list.findIndex((w) => w.id === toMove.id);
    if (idx === -1) break;
    const restIdx = list.findIndex((w) => w.day === destDay && w.type === 'REPOS');
    if (restIdx !== -1) {
      list[restIdx] = { ...list[idx], day: destDay };
      list.splice(idx, 1);
    } else {
      list[idx] = { ...list[idx], day: destDay };
    }
  }

  return list;
}

/**
 * RÈGLE ATHLÈTE (>12 séances/semaine visées) : une journée à 3 séances est acceptable
 * uniquement si ce sont 3 sports différents (déjà garanti à ce stade du pipeline par
 * rebalanceSameDisciplineDoubles + enforceMaxSessionsPerDay ci-dessus) ET que la 3e séance
 * de la journée reste peu intensive — principe de répartition polarisée 80/20 : au maximum
 * UNE séance dure par jour, jamais deux+ sur une journée à triple séance. On désigne la
 * séance la plus courte des 3 comme "3e séance" (heuristique cohérente avec le reste du
 * fichier : la plus courte est généralement la moins structurante de la journée) et on la
 * force en endurance fondamentale/technique si elle ne l'est pas déjà — même traitement
 * (suffixe "(allégée)", cardio/effortZone Z1-Z2, RPE bas) que enforceDoubleThresholdEligibility
 * pour rester cohérent visuellement avec les autres allègements automatiques du plan.
 * N'agit QUE sur les jours à 3 séances réelles ou plus : ne touche jamais les jours à 1 ou 2
 * séances, qui restent régis par les autres garde-fous (enforceNoConsecutiveHardDays,
 * enforceDoubleThresholdEligibility...).
 */
export function enforceThirdSessionLowIntensity(weekWorkouts) {
  if (!Array.isArray(weekWorkouts) || weekWorkouts.length === 0) return weekWorkouts;
  const list = weekWorkouts.map((w) => ({ ...w }));
  const allDays = [...new Set(list.map((w) => w.day))];
  const sessionsOn = (day) => list.filter((w) => w.day === day && w.type !== 'REPOS');

  allDays.forEach((day) => {
    const sessions = sessionsOn(day);
    if (sessions.length < 3) return; // règle ne concerne que les journées à triple séance

    const sorted = [...sessions].sort((a, b) => parseDurationMinutes(b.duration) - parseDurationMinutes(a.duration));
    const third = sorted[sorted.length - 1];
    if (!third || !isHardSession(third)) return; // déjà peu intensive : rien à corriger

    const idx = list.findIndex((w) => w.id === third.id);
    if (idx === -1) return;
    list[idx] = {
      ...list[idx],
      title: /\(allégée\)/i.test(list[idx].title || '') ? list[idx].title : `${list[idx].title} (allégée)`,
      intensity: 'Endurance fondamentale / technique — 3e séance du jour, volontairement peu intensive',
      effortZone: 'Z1-Z2',
      cardio: 'Z1-Z2',
      rpe: 'RPE 3-4/10',
    };
  });

  return list;
}

export function enforceSessionCount(weekWorkouts, maxSessionsPerWeek, offDays, profile, sportType) {
  const declaredTarget = Number(maxSessionsPerWeek);
  if (!declaredTarget || !Array.isArray(weekWorkouts) || weekWorkouts.length === 0) return weekWorkouts;

  const mandatoryOffDays = String(offDays || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  // GARDE-FOU AJOUTÉ (voir checkPlanCoherence pour l'avertissement correspondant côté
  // questionnaire) : le calendrier plafonne STRICTEMENT à 2 séances réelles/jour
  // (enforceMaxSessionsPerDay), donc un total demandé au questionnaire supérieur à
  // 2 × (jours non-repos) est mathématiquement impossible à atteindre sans violer ce
  // plafond quotidien. On ne cherche donc JAMAIS à dépasser ce maximum réellement
  // atteignable ici, même si le questionnaire en demande plus — sinon cette fonction
  // "réussit" en apparence (le total demandé est atteint) mais force
  // enforceMaxSessionsPerDay, juste après, à se battre contre un total déjà intenable,
  // avec au choix : soit un jour à 3+ séances (violation), soit le total final qui
  // retombe sous la cible malgré tout. Mieux vaut un total légèrement inférieur au
  // questionnaire (signalé à l'athlète) qu'un calendrier structurellement incohérent.
  const availableDays = 7 - mandatoryOffDays.length;
  const target = Math.min(declaredTarget, 2 * availableDays);

  // Défense en profondeur : si l'appelant n'est pas déjà passé par ensureAllDaysPresent
  // (voir sa doc), on le fait ici aussi — sans ça, une semaine reçue avec moins de 7
  // jours forcerait le complètement de séances manquantes à s'empiler sur les quelques
  // jours existants plutôt que de se répartir sur toute la semaine (bug réel observé).
  const list = ensureAllDaysPresent(weekWorkouts).map((w) => ({ ...w }));

  // 1) Le(s) jour(s) de repos obligatoire(s) doivent toujours être REPOS.
  list.forEach((w) => {
    if (mandatoryOffDays.includes(w.day?.toLowerCase()) && w.type !== 'REPOS') {
      w.type = 'REPOS';
      w.title = 'Repos complet';
      w.intensity = 'Récupération';
      w.duration = '0 min';
      w.desc = 'Repos imposé par tes disponibilités (jour de repos obligatoire déclaré au questionnaire).';
    }
  });

  let trainingDays = list.filter((w) => w.type !== 'REPOS');
  // Pondéré (voir sessionWeight) : un brick "coûte" 2 dans le total, jamais 1 — sinon
  // on croit à tort qu'il manque des séances alors qu'un brick en a déjà "payé" deux
  // (bug réel observé : Lundi ne double jamais alors que Samedi accumule 4 séances,
  // le calcul non pondéré ajoutant des séances au mauvais endroit).
  let weightedCount = trainingDays.reduce((sum, w) => sum + sessionWeight(w), 0);

  // 2) Trop de séances (pondéré) : on repasse en REPOS les séances les plus courtes en
  // priorité (on garde les séances longues/structurantes), une par une — jamais un
  // slice figé à l'avance, car démonter UN SEUL brick fait déjà baisser le total de 2.
  if (weightedCount > target) {
    let guardDemote = 0;
    while (weightedCount > target && guardDemote < 30) {
      guardDemote += 1;
      const remaining = list.filter((w) => w.type !== 'REPOS');
      if (remaining.length === 0) break;
      const shortest = [...remaining].sort((a, b) => parseDurationMinutes(a.duration) - parseDurationMinutes(b.duration))[0];
      const idx = list.findIndex((w) => w.id === shortest.id);
      if (idx === -1) break;
      weightedCount -= sessionWeight(list[idx]);
      list[idx] = {
        ...list[idx],
        type: 'REPOS',
        title: 'Repos complet',
        intensity: 'Récupération',
        duration: '0 min',
        desc: "Repos ajouté automatiquement pour respecter le nombre de séances/semaine déclaré au questionnaire.",
      };
    }
  }

  // 3) Pas assez de séances (pondéré — cas fréquent au-delà de ~6-7 séances/semaine :
  // l'IA ne pense pas toujours à doubler des jours) : on complète en ajoutant des
  // séances SUPPLÉMENTAIRES sur les jours déjà entraînés (jours "doubles", ex: brick),
  // jamais sur un jour de repos obligatoire. On ne supprime ni ne remplace jamais une
  // séance existante — uniquement des AJOUTS, en tournant sur la discipline la moins
  // représentée dans la semaine pour garder un minimum d'équilibre. Chaque séance ainsi
  // ajoutée est une séance simple (poids 1, jamais un nouveau brick) : `missing` peut
  // donc être décrémenté de 1 par ajout en toute sécurité.
  if (weightedCount < target) {
    const isRunOnly = sportType === 'running';
    const disciplineCycle = isRunOnly ? ['C.A.P'] : ['C.A.P', 'CYCLISME', 'NATATION'];
    const countByDiscipline = (type) => list.filter((w) => classifyDiscipline(w.type) === type).length;

    // Jours éligibles à recevoir une séance supplémentaire : tous sauf repos obligatoire
    // ET sauf un jour qui contient déjà un brick (ENCHAÎNEMENT) — un brick combine déjà 2
    // disciplines en une seule séance structurée et ne doit JAMAIS recevoir de compagnon
    // le même jour (voir enforceMaxSessionsPerDay pour la même règle appliquée en filet de
    // sécurité final) : autant ne jamais créer ce cas ici plutôt que compter dessus pour
    // le corriger après coup. On répartit en boucle (round-robin) sur les jours ayant le
    // MOINS de séances aujourd'hui, pour éviter d'empiler 3-4 séances sur un seul jour.
    const eligibleDays = [...new Set(list.map((w) => w.day))].filter(
      (day) =>
        !mandatoryOffDays.includes(String(day).toLowerCase()) &&
        !list.some((w) => w.day === day && classifyDiscipline(w.type) === 'ENCHAÎNEMENT')
    );

    let missing = target - weightedCount;
    let guard = 0;
    while (missing > 0 && guard < 30) {
      guard += 1;

      // Discipline la moins représentée cette semaine (parmi celles autorisées) — décidée
      // AVANT le jour, pour pouvoir choisir un jour qui ne l'a pas déjà (vrai enchaînement
      // type brick : natation+vélo, vélo+course... jamais 2x la même discipline un même jour,
      // sauf impossibilité totale — seul cas légitime : plan course à pied mono-discipline).
      const nextType = [...disciplineCycle].sort((a, b) => countByDiscipline(a) - countByDiscipline(b))[0];

      // Jour cible : en priorité un jour éligible qui n'a PAS déjà cette discipline
      // aujourd'hui (pour garantir la variété/brick) ; parmi ceux-là, celui qui a
      // actuellement le moins de séances (pour ne pas empiler 3-4 séances sur un seul jour).
      // Si aucun jour éligible n'est libre de cette discipline (seulement possible en
      // mono-discipline, où il n'y a qu'un seul type disponible), on retombe sur le jour
      // ayant le moins de séances tout court.
      const daysWithoutDiscipline = eligibleDays.filter(
        (day) => !list.some((w) => w.day === day && w.type !== 'REPOS' && classifyDiscipline(w.type) === nextType)
      );
      const pool = daysWithoutDiscipline.length > 0 ? daysWithoutDiscipline : eligibleDays;

      const sessionsPerDay = pool.map((day) => ({
        day,
        count: list.filter((w) => w.day === day && w.type !== 'REPOS').length,
      }));
      sessionsPerDay.sort((a, b) => a.count - b.count);
      const targetDay = sessionsPerDay[0]?.day;
      if (!targetDay) break;

      const restIdx = list.findIndex((w) => w.day === targetDay && w.type === 'REPOS');
      const newWorkout = buildComplementaryWorkout(targetDay, list, nextType, guard);

      if (restIdx !== -1) {
        // Le jour choisi était un jour de repos NON obligatoire : on le remplace.
        list[restIdx] = newWorkout;
      } else {
        // Le jour a déjà au moins une séance : on ajoute une vraie séance double.
        list.push(newWorkout);
      }
      missing -= 1;
    }
  }

  // Filet de sécurité final, quelle que soit la branche exécutée ci-dessus (et même
  // si aucune correction de quota n'a été nécessaire) : jamais deux séances de la même
  // discipline (rebalance) ni deux séances identiques (dedupe) sur le même jour.
  const rebalanced = rebalanceSameDisciplineDoubles(list, sportType, offDays);
  return dedupeIdenticalSameDaySessions(rebalanced).map((w) => sanitizeWorkout(w, profile));
}

// BUG CORRIGÉ : l'ancienne implémentation cherchait un motif "chiffres + m" totalement
// indépendant du motif "chiffres + h", donc un format ultra-courant dans l'app comme
// "1h30" (sans le mot "min" ni un "m" isolé) ne matchait JAMAIS le second regex — les
// minutes étaient silencieusement remises à 0 (ex: "2h45" -> 120min au lieu de 165min,
// "1h20" -> 60min au lieu de 80min). Sur une semaine complète, cette perte se cumule sur
// toutes les séances formatées "XhYY" et rend le volume affiché (graphe "Volume prévu"
// de l'onglet Profil, sortie longue de 21km, etc.) nettement sous-estimé et incohérent.
// On capture maintenant les minutes DANS LA MÊME EXPRESSION que les heures (juste après
// le "h"), qu'elles soient suivies ou non de "m"/"min" — et seulement une valeur "m"/"min"
// isolée (sans "h" avant) est traitée comme des minutes pures.
export function parseDurationMinutes(duration) {
  const str = String(duration || '').trim();
  if (!str) return 0;

  const hAndM = str.match(/(\d+(?:[.,]\d+)?)\s*h\s*(\d{1,2})?/i);
  if (hAndM) {
    const hours = Number(String(hAndM[1]).replace(',', '.')) || 0;
    const mins = hAndM[2] ? Number(hAndM[2]) : 0;
    return Math.round(hours * 60 + mins);
  }

  const minOnly = str.match(/(\d+(?:[.,]\d+)?)\s*(?:min|m)\b/i);
  if (minOnly) return Math.round(Number(String(minOnly[1]).replace(',', '.')) || 0);

  return Number(str.replace(',', '.')) || 0;
}

export function computeRaceStats(trainingPlan) {
  // trainingPlan.date = date de l'objectif/course (compte à rebours).
  // trainingPlan.startDate = date de début du plan (sert uniquement à calculer la progression).
  // Format attendu : ISO (YYYY-MM-DD), seul format que `new Date()` parse de façon fiable
  // et identique dans tous les navigateurs (un format texte comme "15 Juin 2026" donne une
  // Date invalide -> NaN -> compteur silencieusement figé à 0, sans erreur visible).
  const raceDateStr = trainingPlan?.date || '2026-05-01';
  const startDateStr = trainingPlan?.startDate;

  const raceTimeMs = new Date(raceDateStr).getTime();
  const dateIsValid = !Number.isNaN(raceTimeMs);
  const nowMs = Date.now();
  const diffDays = dateIsValid ? Math.ceil((raceTimeMs - nowMs) / (1000 * 60 * 60 * 24)) : null;
  const daysLeft = dateIsValid ? Math.max(0, diffDays) : null;
  const weeksLeft = dateIsValid ? Math.ceil(daysLeft / 7) : null;

  let progressPct = 0;
  const startTimeMs = startDateStr ? new Date(startDateStr).getTime() : NaN;
  if (dateIsValid && !Number.isNaN(startTimeMs) && raceTimeMs > startTimeMs) {
    const totalDuration = raceTimeMs - startTimeMs;
    const elapsed = nowMs - startTimeMs;
    progressPct = Math.round(clamp((elapsed / totalDuration) * 100, 0, 100));
  }

  return {
    daysLeft,
    weeksLeft,
    progressPct,
    dateIsValid,
  };
}

// --- CONSEILS DE COHÉRENCE "COACH EXPERT" ---
// Repères de préparation classiques (littérature coaching triathlon/course à pied) :
// nombre de séances/semaine minimum pour toucher les 3 disciplines correctement,
// volume horaire minimum réaliste, et durée de préparation minimum recommandée.
// Ce ne sont pas des limites strictes (chacun est différent) mais des seuils sous
// lesquels la préparation devient statistiquement risquée (blessure/sous-préparation)
// ou irréaliste vu la charge technique/physiologique du format visé.
const TRIATHLON_DIFFICULTY = {
  XS: { minSessions: 3, minHours: 3, minWeeks: 4, label: 'Format découverte (XS)' },
  S: { minSessions: 4, minHours: 4, minWeeks: 6, label: 'Format S (sprint)' },
  M: { minSessions: 5, minHours: 6, minWeeks: 8, label: 'Format M (olympique)' },
  L: { minSessions: 6, minHours: 8, minWeeks: 12, label: 'Format L (half-distance / 70.3)' },
  XL: { minSessions: 7, minHours: 12, minWeeks: 16, label: 'Format XL (Ironman / distance complète)' },
};

const RUNNING_DIFFICULTY = {
  '5km': { minSessions: 3, minHours: 2, minWeeks: 4 },
  '10km': { minSessions: 3, minHours: 3, minWeeks: 6 },
  'Semi-marathon': { minSessions: 4, minHours: 4, minWeeks: 8 },
  Marathon: { minSessions: 5, minHours: 5, minWeeks: 12 },
};

export function checkPlanCoherence(wizardData) {
  const warnings = [];
  if (!wizardData) return warnings;

  const hours = Number(wizardData.hoursPerWeek) || 0;
  const sessions = Number(wizardData.maxSessionsPerWeek) || 0;
  const fitnessLevel = Number(wizardData.fitnessLevel) || 3;

  if (hours > 15) {
    warnings.push('Volume horaire très élevé (>15h), attention au surentraînement.');
  }

  // GARDE-FOU AJOUTÉ (bug réel identifié) : le calendrier applique une règle STRICTE et non
  // négociable de maximum 2 séances réelles par jour (voir enforceMaxSessionsPerDay dans ce
  // même fichier — un jour de repos obligatoire ne peut jamais en recevoir, et un jour de brick
  // ne peut en recevoir qu'UNE seule, poids 2). Le nombre de séances/semaine demandé au
  // questionnaire est donc mathématiquement plafonné à 2 × (7 - nb de jours de repos
  // obligatoires) — au-delà, il est structurellement IMPOSSIBLE de respecter à la fois le
  // total demandé ET ce plafond quotidien, quoi que fasse l'IA ou les garde-fous déterministes
  // (l'un des deux sera nécessairement rogné). Sans ce garde-fou, le total déclaré était
  // silencieusement recopié tel quel, menant à des semaines avec des jours à 3-4 séances
  // (violant le cap) ou un total final inférieur à celui demandé (l'algorithme cherchant en
  // vain une case libre) — jamais signalé à l'athlète comme la VRAIE cause du problème.
  const offDaysCount = String(wizardData.offDays || '').split(',').map((d) => d.trim()).filter(Boolean).length;
  const maxFeasibleSessions = 2 * (7 - offDaysCount);
  if (sessions > maxFeasibleSessions) {
    warnings.push(
      `${sessions} séances/semaine demandées avec ${offDaysCount} jour(s) de repos obligatoire(s) : le calendrier ne peut jamais dépasser 2 séances réelles par jour (règle de sécurité anti-surcharge), soit un maximum absolu de ${maxFeasibleSessions} séances/semaine dans ta configuration actuelle. Réduis le nombre de séances visées, ou libère un jour de repos obligatoire, pour que le plan généré puisse vraiment respecter ce total sans empiler plus de 2 séances le même jour.`
    );
  }

  const weeksToRace = wizardData.targetDate
    ? Math.max(0, Math.round((new Date(wizardData.targetDate).getTime() - Date.now()) / (7 * 24 * 3600 * 1000)))
    : null;

  if (wizardData.sportType === 'triathlon') {
    const fmt = wizardData.triathlonFormat;
    const rules = TRIATHLON_DIFFICULTY[fmt];
    if (rules) {
      if (sessions < rules.minSessions) {
        warnings.push(
          `${rules.label} avec seulement ${sessions} séance(s)/semaine : il faut idéalement au moins ${rules.minSessions} séances pour travailler correctement les 3 disciplines (natation, vélo, course) sans négliger l'une d'elles.`
        );
      }
      if (hours > 0 && hours < rules.minHours) {
        warnings.push(
          `${rules.label} : un volume d'au moins ~${rules.minHours}h/semaine est en général nécessaire pour arriver prêt. ${hours}h risque d'être insuffisant.`
        );
      }
      if (weeksToRace !== null && weeksToRace < rules.minWeeks) {
        warnings.push(
          `Il te reste ${weeksToRace} semaine(s) avant l'objectif — une préparation ${rules.label.toLowerCase()} se construit en général sur au moins ${rules.minWeeks} semaines (base + travail spécifique) pour progresser sans te blesser.`
        );
      }
      if ((fmt === 'L' || fmt === 'XL') && fitnessLevel <= 2) {
        warnings.push(
          `Ton niveau de forme actuel (${fitnessLevel}/5) associé à un ${rules.label.toLowerCase()} demande une vigilance particulière : envisage un format inférieur ou une préparation plus longue et progressive pour limiter le risque de blessure.`
        );
      }
    }
  } else if (wizardData.sportType === 'running') {
    if (wizardData.runningSubtype === 'trail') {
      const km = Number(wizardData.trailKm) || 0;
      if (km >= 80 && sessions < 6) {
        warnings.push(`Un ultra-trail de ${km}km demande en général 6 séances/semaine minimum, avec du dénivelé spécifique régulier.`);
      } else if (km >= 42 && sessions < 5) {
        warnings.push(`Un trail de ${km}km demande en général 5 séances/semaine minimum.`);
      } else if (km >= 21 && sessions < 4) {
        warnings.push(`Un trail de ${km}km demande en général 4 séances/semaine minimum.`);
      }
    } else {
      const rules = RUNNING_DIFFICULTY[wizardData.distance];
      if (rules) {
        if (sessions < rules.minSessions) {
          warnings.push(
            `Pour un ${wizardData.distance}, ${rules.minSessions} séances/semaine minimum sont recommandées pour bien répartir endurance, allure spécifique et récupération. Avec ${sessions} séance(s), la préparation sera limitée.`
          );
        }
        if (hours > 0 && hours < rules.minHours) {
          warnings.push(`Pour un ${wizardData.distance}, prévois plutôt ${rules.minHours}h/semaine minimum.`);
        }
        if (weeksToRace !== null && weeksToRace < rules.minWeeks) {
          warnings.push(`Il te reste ${weeksToRace} semaine(s) — une préparation ${wizardData.distance} classique recommande au moins ${rules.minWeeks} semaines.`);
        }
      }
    }
  }

  return warnings;
}

// --- GARDE-FOU DÉTERMINISTE : PROGRESSIVITÉ POUR UN NIVEAU DE FORME FAIBLE ---
// Même principe que enforceSessionCount / phasesToCycles : le prompt IA demande déjà
// (lib/gemini.js -> describeFitnessAdaptation) une charge très prudente pour un niveau
// débutant/novice (fitnessLevel <= 2), mais on ne peut pas dépendre uniquement de
// l'obéissance du modèle — un débutant niveau 2/5 qui reçoit une séance de seuil
// 3x10min et une sortie longue de 2h dès la phase de base est un vrai risque de
// blessure/décrochage. On corrige donc ICI, de façon déterministe, les séances qui
// dépassent des bornes de durée raisonnables pour ce profil, en phase base/développement
// (jamais en phase "peak"/"taper" où l'intensité proche de l'objectif est normale).
const BEGINNER_DURATION_CAPS_MIN = {
  'C.A.P': { hard: 40, long: 75 }, // séance à haute intensité (Z4/Z5/seuil) / sortie longue
  CYCLISME: { hard: 50, long: 120 },
  NATATION: { hard: 40, long: 60 },
};

// Rang numérique de l'expérience d'entraînement déclarée au questionnaire (axe distinct de la
// forme physique du moment — voir describeAthleteAdaptation dans lib/gemini.js pour le détail du
// raisonnement). Une expérience non reconnue est traitée comme "intermédiaire" par défaut.
const EXPERIENCE_RANK = { debutant: 1, novice: 2, intermediaire: 3, confirme: 4, expert: 5 };

export function isHardSession(workout) {
  // GARDE-FOU CASCADE : une séance déjà allégée par un garde-fou précédent (enforceBeginnerProgression,
  // enforceDoubleThresholdEligibility, enforceTaperVolume, applyFatigueAutoRegulation...) porte
  // TOUJOURS le suffixe "(allégée)" dans son titre (voir ces fonctions) — sans ce court-circuit, le
  // titre/desc d'origine ("Séance de seuil...") continuerait de matcher les mots-clés ci-dessous même
  // après avoir été rebasculée en endurance fondamentale (cardio Z2), ce qui ferait ré-alléger la même
  // séance en boucle par plusieurs garde-fous successifs (empilement de notes redondantes dans desc) et
  // fausserait enforceNoConsecutiveHardDays (une séance déjà easy resterait comptée "difficile").
  if (/\(allégée\)/i.test(workout.title || '')) return false;
  const cardio = String(workout.cardio || workout.effortZone || '').toUpperCase();
  const label = `${workout.title || ''} ${workout.desc || ''}`.toLowerCase();
  return /Z4|Z5/.test(cardio) || /seuil|vma|sweetspot|fractionn/i.test(label);
}

export function isLongSession(workout) {
  const label = `${workout.title || ''}`.toLowerCase();
  return /longue|long\b/.test(label);
}

// --- GARDE-FOUS DÉTERMINISTES SUPPLÉMENTAIRES (physiologie de l'entraînement) ---
// Même logique que enforceBeginnerProgression ci-dessus : les règles d'expert injectées dans le
// prompt (lib/gemini.js -> buildEnduranceExpertRules) donnent le cadre à l'IA, mais rien ne
// garantit qu'elle les respecte à 100%. Ces fonctions vérifient/corrigent le JSON généré, APRÈS
// coup, de façon fiable — indépendamment de l'obéissance du modèle.

/**
 * Aucune séance difficile (Z4/Z5, seuil, VMA...) ne doit suivre directement une autre séance
 * difficile de la veille — principe de récupération entre séances à haute intensité. Opère sur
 * les 14 jours (N puis N+1) dans l'ordre chronologique, y compris à la frontière dimanche N /
 * lundi N+1, pour ne pas laisser passer un enchaînement à cheval sur les deux semaines.
 */
/**
 * Enchaînement de deux séances difficiles sur des jours calendaires réellement
 * consécutifs (y compris à cheval sur la frontière semaine N / N+1). On compare ICI
 * par le champ `day` de chaque séance sur une séquence de 14 jours calendaires
 * (Lundi..Dimanche de N, puis Lundi..Dimanche de N+1) — jamais par la position dans
 * le tableau d'entrée : celui-ci peut être scrambled par les étapes précédentes du
 * pipeline (jours manquants complétés en fin de liste par ensureAllDaysPresent,
 * séances "jour double" ajoutées en fin de liste par enforceSessionCount...), ce qui
 * ne correspond plus forcément à l'enchaînement réel des jours une fois la semaine
 * chargée (beaucoup de séances/semaine = beaucoup d'ajouts = tableau très scrambled).
 * Deux séances difficiles le MÊME jour (brick) ne sont volontairement jamais
 * comparées ici : c'est le rôle d'enforceDoubleThresholdEligibility.
 */
export function enforceNoConsecutiveHardDays(weekN, weekNPlus1) {
  const resultN = (weekN || []).map((w) => ({ ...w }));
  const resultNPlus1 = (weekNPlus1 || []).map((w) => ({ ...w }));
  const getList = (week) => (week === 'N' ? resultN : resultNPlus1);

  const orderedDays = [
    ...DAYS_OF_WEEK.map((day) => ({ week: 'N', day })),
    ...DAYS_OF_WEEK.map((day) => ({ week: 'N+1', day })),
  ];

  // Recalculé dynamiquement à chaque itération (jamais mis en cache) pour que
  // l'allègement d'un jour se répercute correctement sur la comparaison du jour
  // suivant en cas de 3 jours difficiles enchaînés ou plus.
  const dayHasHard = (week, day) => getList(week).some((w) => w.day === day && w.type !== 'REPOS' && isHardSession(w));

  for (let i = 1; i < orderedDays.length; i += 1) {
    const prev = orderedDays[i - 1];
    const cur = orderedDays[i];
    if (!dayHasHard(prev.week, prev.day) || !dayHasHard(cur.week, cur.day)) continue;
    const curList = getList(cur.week);
    const idx = curList.findIndex((w) => w.day === cur.day && w.type !== 'REPOS' && isHardSession(w));
    if (idx === -1) continue;
    curList[idx] = {
      ...curList[idx],
      title: `${curList[idx].title} (allégée)`,
      intensity: 'Endurance fondamentale (allégé automatiquement)',
      effortZone: 'Z2',
      cardio: 'Z2',
      desc: curList[idx].desc || '',
    };
  }

  return { N: resultN, 'N+1': resultNPlus1 };
}

/**
 * Un double seuil (2 séances de qualité seuil/intensité la même journée) n'est physiologiquement
 * pertinent que pour un profil confirmé avec un volume suffisant pour l'absorber (voir
 * buildEnduranceExpertRules). Si l'IA en propose un hors de ces critères, on allège la seconde
 * séance difficile du jour concerné.
 */
export function enforceDoubleThresholdEligibility(weekWorkouts, fitnessLevel, hoursPerWeek, trainingExperience) {
  const expRank = EXPERIENCE_RANK[trainingExperience] || 3;
  const eligible = (Number(fitnessLevel) || 3) >= 4 && expRank >= 4 && Number(hoursPerWeek) >= 8;
  if (eligible || !Array.isArray(weekWorkouts)) return weekWorkouts;
  const byDay = {};
  weekWorkouts.forEach((w) => { (byDay[w.day] = byDay[w.day] || []).push(w); });
  const secondHardIds = new Set();
  Object.values(byDay).forEach((dayList) => {
    const hard = dayList.filter((w) => w.type !== 'REPOS' && isHardSession(w));
    if (hard.length >= 2) secondHardIds.add(hard[1].id);
  });
  if (secondHardIds.size === 0) return weekWorkouts;
  return weekWorkouts.map((w) => (secondHardIds.has(w.id) ? {
    ...w,
    title: `${w.title} (allégée)`,
    intensity: 'Endurance fondamentale (allégé automatiquement)',
    effortZone: 'Z2',
    cardio: 'Z2',
    desc: `${w.desc || ''}`.trim(),
  } : w));
}

/**
 * En phase d'affûtage, le volume doit chuter nettement (40-60%) tout en gardant quelques touches
 * d'intensité courtes — jamais forcé côté prompt seul. On réduit ici, de façon déterministe, la
 * durée des séances (hors REPOS et hors séances déjà courtes ≤25min, pour ne jamais supprimer les
 * touches d'intensité) jusqu'à viser ~50% du volume hebdo déclaré.
 */
export function enforceTaperVolume(weekWorkouts, phaseKey, hoursPerWeek) {
  if (phaseKey !== 'taper' || !Array.isArray(weekWorkouts) || !hoursPerWeek) return weekWorkouts;
  const targetMin = Number(hoursPerWeek) * 60 * 0.5;
  const totalMin = weekWorkouts.reduce((s, w) => s + (w.type !== 'REPOS' ? parseDurationMinutes(w.duration) : 0), 0);
  if (!totalMin || totalMin <= targetMin) return weekWorkouts;
  const ratio = targetMin / totalMin;
  return weekWorkouts.map((w) => {
    if (w.type === 'REPOS') return w;
    const currentMin = parseDurationMinutes(w.duration);
    if (currentMin <= 25) return w;
    const newMin = Math.max(20, Math.round(currentMin * ratio));
    if (newMin >= currentMin) return w;
    const h = Math.floor(newMin / 60);
    const m = newMin % 60;
    return {
      ...w,
      duration: h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`,
      desc: w.desc || '',
    };
  });
}

/**
 * Filet de sécurité "signal de fatigue" : si le ressenti récent indique que l'athlète trouve
 * ses séances plus dures que prévu (voir summarizeFeedbackTrend) ET/OU que sa VFC récente est
 * en baisse notable vs sa propre moyenne (voir summarizeHrvTrend dans lib/feedback.js), on ne
 * dépend pas uniquement du prompt — on allège directement la séance difficile la moins
 * structurante de la semaine s'il y en a plus d'une.
 *
 * Les deux signaux sont volontairement des booléens déjà tranchés en amont (pas de logique de
 * seuil ici) : cette fonction ne fait qu'AGIR sur un signal de fatigue, peu importe sa source —
 * ressenti déclaré, VFC, ou les deux à la fois (OR, pas AND : chaque signal est indépendamment
 * suffisant, comme avant l'ajout de la VFC pour le ressenti seul).
 */
export function applyFatigueAutoRegulation(weekWorkouts, { trendHarder = false, hrvLow = false } = {}) {
  if ((!trendHarder && !hrvLow) || !Array.isArray(weekWorkouts)) return weekWorkouts;
  const hard = weekWorkouts.filter((w) => w.type !== 'REPOS' && isHardSession(w));
  if (hard.length <= 1) return weekWorkouts;
  const toEase = [...hard].sort((a, b) => parseDurationMinutes(a.duration) - parseDurationMinutes(b.duration))[0];
  return weekWorkouts.map((w) => (w.id === toEase.id ? {
    ...w,
    title: `${w.title} (allégée)`,
    intensity: 'Endurance fondamentale (allégé automatiquement)',
    effortZone: 'Z2',
    cardio: 'Z2',
    desc: w.desc || '',
  } : w));
}

// --- AVERTISSEMENTS (non bloquants, non corrigés automatiquement) ---
// Ces vérifications signalent un risque plausible sans modifier le plan : une correction
// automatique serait ici trop hasardeuse (ex: redécouper un volume horaire au hasard), mieux
// vaut remonter l'info que l'IA/l'utilisateur pourra objectiver.

export function checkWeeklyVolumeWarning(weekWorkouts, hoursPerWeek, weekLabel) {
  if (!Array.isArray(weekWorkouts) || !hoursPerWeek) return null;
  const totalMin = weekWorkouts.reduce((s, w) => s + (w.type !== 'REPOS' ? parseDurationMinutes(w.duration) : 0), 0);
  const targetMin = Number(hoursPerWeek) * 60;
  if (!targetMin) return null;
  const deltaPct = ((totalMin - targetMin) / targetMin) * 100;
  if (Math.abs(deltaPct) > 15) {
    return `Semaine ${weekLabel} : volume généré (~${Math.round((totalMin / 60) * 10) / 10}h) s'écarte de plus de 15% des ${hoursPerWeek}h déclarées (${deltaPct > 0 ? '+' : ''}${Math.round(deltaPct)}%).`;
  }
  return null;
}

export function checkWeekSimilarityWarning(weekN, weekNPlus1) {
  const signature = (week) => (week || [])
    .map((w) => `${w.type}:${Math.round(parseDurationMinutes(w.duration) / 15) * 15}:${(w.intensity || '').slice(0, 6)}`)
    .join('|');
  const sigN = signature(weekN);
  const sigN1 = signature(weekNPlus1);
  if (sigN && sigN === sigN1) {
    return "Les semaines N et N+1 semblent quasi identiques (mêmes types/durées/intensités) : pas de réelle progression ni variation détectée entre les deux semaines.";
  }
  return null;
}

function sessionLoad(w) {
  if (w.type === 'REPOS') return 0;
  const durMin = parseDurationMinutes(w.duration) || 30;
  let factor = isHardSession(w) ? 1.5 : 0.8;
  if (isLongSession(w)) factor += 0.3;
  return Math.round(durMin * factor);
}

/**
 * Monotonie d'entraînement (indice de Foster : charge moyenne / écart-type des charges
 * journalières). Une monotonie élevée (jours quasi tous identiques en charge) est associée à un
 * risque accru de surcharge/blessure même quand le volume total semble raisonnable.
 */
export function checkMonotonyWarning(weekWorkouts, weekLabel) {
  if (!Array.isArray(weekWorkouts) || weekWorkouts.length < 5) return null;
  const loads = weekWorkouts.map(sessionLoad);
  const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
  if (mean === 0) return null;
  const variance = loads.reduce((s, v) => s + (v - mean) ** 2, 0) / loads.length;
  const stddev = Math.sqrt(variance);
  const monotony = stddev === 0 ? mean : mean / stddev;
  if (monotony > 2.5) {
    return `Semaine ${weekLabel} : charge d'entraînement peu variée entre les jours (monotonie élevée) — plus de contraste entre séances faciles et difficiles limiterait le risque de surcharge (indice de Foster).`;
  }
  return null;
}

function intensityBucket(w) {
  // Même garde-fou cascade que isHardSession ci-dessus : une séance déjà allégée reste classée
  // "low" même si son titre d'origine contenait un mot-clé d'intensité (le cardio a réellement
  // été rebasculé en Z2 par le garde-fou qui l'a allégée).
  if (/\(allégée\)/i.test(w.title || '')) return 'low';
  const cardio = String(w.cardio || w.effortZone || '').toUpperCase();
  const label = `${w.title || ''} ${w.desc || ''}`.toLowerCase();
  if (/Z3|Z4|Z5|Z6/.test(cardio) || /seuil|vma|sweetspot|fractionn|tempo/i.test(label)) return 'high';
  return 'low';
}

/**
 * Vérifie le VRAI ratio 80/20 (endurance fondamentale vs intensité Z3+) sur le plan réellement
 * généré, pondéré par la durée de chaque séance — le prompt le demande déjà à l'IA (voir
 * buildWorkoutSchema), mais comme pour le volume total, rien ne garantissait jusqu'ici que le
 * JSON reçu le respecte vraiment. Volontairement asymétrique : on n'alerte que sur un EXCÈS
 * d'intensité (risque de surcharge), jamais sur un déficit (rester trop en endurance fondamentale
 * n'est jamais dangereux, seulement sous-optimal).
 */
export function checkPolarizationWarning(weekWorkouts, weekLabel) {
  if (!Array.isArray(weekWorkouts)) return null;
  const training = weekWorkouts.filter((w) => w.type !== 'REPOS');
  const totalMin = training.reduce((s, w) => s + parseDurationMinutes(w.duration), 0);
  if (!totalMin) return null;
  const highMin = training
    .filter((w) => intensityBucket(w) === 'high')
    .reduce((s, w) => s + parseDurationMinutes(w.duration), 0);
  const highPct = (highMin / totalMin) * 100;
  if (highPct > 35) {
    return `Semaine ${weekLabel} : part d'intensité (Z3+) trop élevée (~${Math.round(highPct)}% du volume) — le principe 80/20 recommande de garder l'essentiel du volume en endurance fondamentale, même en phase avancée de la préparation.`;
  }
  return null;
}

// --- GARDE-FOU DÉTERMINISTE : COHÉRENCE DU DÉNIVELÉ (D+) EN TRAIL ---
// Même logique que checkPolarizationWarning ci-dessus : le prompt demande déjà (voir
// buildEnduranceExpertRules -> trailBlock dans lib/gemini.js) une sortie longue avec un dénivelé
// cohérent avec l'objectif et jamais deux sorties à fort D+ consécutives, mais rien ne garantit
// que l'IA respecte ces deux invariants dans le JSON réellement généré. Aucun champ structuré
// dédié au dénivelé n'existe dans le schéma des séances : on l'extrait donc du titre/desc par
// regex, comme le fait déjà checkZoneRangeWarnings pour la FC. Non bloquant et non corrigé
// automatiquement (au même titre que checkPolarizationWarning) : une correction à l'aveugle du
// dénivelé texte serait trop hasardeuse, mieux vaut remonter l'info à l'utilisateur/l'IA.
function extractElevationM(workout) {
  const label = `${workout?.title || ''} ${workout?.desc || ''}`;
  // Le nombre peut se trouver avant OU après le marqueur ("600m D+" comme "D+ 600m" ou "D+600m"),
  // et le marqueur textuel peut être "D+" ou "dénivelé" (positif) — on essaie les 4 ordres possibles
  // et on garde la première correspondance valide.
  const patterns = [
    /(\d{2,5})\s*m?\s*(?:de\s*)?d\s*\+/i,
    /(\d{2,5})\s*m?\s*(?:de\s*)?d[ée]nivel[ée]\w*/i,
    /d\s*\+\s*:?\s*(\d{2,5})\s*m?/i,
    /d[ée]nivel[ée]\w*\s*(?:positif\s*)?:?\s*(\d{2,5})\s*m?/i,
  ];
  for (const re of patterns) {
    const m = label.match(re);
    if (m && Number(m[1])) return Number(m[1]);
  }
  return 0;
}

/**
 * TRAIL uniquement (sportType 'running' + runningSubtype 'trail') : vérifie sur les deux semaines
 * assemblées (comme enforceNoConsecutiveHardDays, pour ne pas laisser passer un enchaînement à
 * cheval sur la frontière dimanche N / lundi N+1) que :
 * 1. Au moins une séance des deux semaines porte un dénivelé (D+) chiffré — une préparation trail
 *    sans aucun D+ mentionné ne prépare pas au dénivelé cumulé réel de la course.
 * 2. Deux sorties à fort dénivelé (seuil arbitraire mais raisonnable : ≥400m D+, pour ne pas
 *    déclencher sur une simple sortie vallonnée) ne s'enchaînent jamais sur deux jours consécutifs
 *    (récupération musculaire excentrique, spécifique à la descente, nécessaire entre deux sorties
 *    à fort D+).
 */
export function checkTrailElevationWarning(weekN, weekNPlus1, sportType, runningSubtype) {
  if (sportType !== 'running' || runningSubtype !== 'trail') return null;
  if (!Array.isArray(weekN) || !Array.isArray(weekNPlus1)) return null;

  const seq = [...weekN, ...weekNPlus1];
  const training = seq.filter((w) => w.type !== 'REPOS');
  if (training.length === 0) return null;

  const elevations = seq.map(extractElevationM);
  const hasAnyElevation = elevations.some((e) => e > 0);
  if (!hasAnyElevation) {
    return "Trail : aucune séance des semaines N/N+1 ne mentionne de dénivelé (D+) chiffré — une préparation trail devrait intégrer au moins une sortie avec un dénivelé cumulé cohérent avec l'objectif de course (D+/D- déclarés au questionnaire).";
  }

  const SIGNIFICANT_ELEVATION_M = 400;
  for (let i = 1; i < seq.length; i += 1) {
    const prev = seq[i - 1];
    const cur = seq[i];
    if (prev.type === 'REPOS' || cur.type === 'REPOS') continue;
    if (elevations[i - 1] >= SIGNIFICANT_ELEVATION_M && elevations[i] >= SIGNIFICANT_ELEVATION_M) {
      return `Trail : deux sorties à fort dénivelé (≥${SIGNIFICANT_ELEVATION_M}m D+ chacune) s'enchaînent sur deux jours consécutifs (${prev.day || '?'} → ${cur.day || '?'}) — la récupération musculaire spécifique à la descente (travail excentrique) recommande d'espacer ces sorties.`;
    }
  }
  return null;
}

/**
 * Plafonne la durée des séances trop exigeantes pour un athlète débutant/novice
 * (fitnessLevel déclaré <= 2) en phase base/développement. Ne touche JAMAIS aux
 * séances déjà dans des bornes raisonnables, ni aux niveaux >= 3, ni aux phases
 * peak/taper (où une charge plus proche de l'objectif est normale et attendue).
 */
/**
 * Plafonne la durée des séances trop exigeantes pour un profil peu progressif — déclenché si la
 * FORME actuelle est faible (fitnessLevel <=2) OU si l'EXPÉRIENCE d'entraînement est faible
 * (trainingExperience débutant/novice), la plus prudente des deux règles prime (voir
 * describeAthleteAdaptation dans lib/gemini.js). Ne touche JAMAIS aux séances déjà dans des
 * bornes raisonnables, ni aux profils confirmés, ni aux phases peak/taper (où une charge plus
 * proche de l'objectif est normale et attendue).
 */
// Volume de natation minimum (mètres) attendu par niveau/expérience — cohérent avec les
// standards d'entraînement triathlon (plans structurés type USA Triathlon / British
// Triathlon pour ces tranches). Utilisé comme PLANCHER, jamais comme valeur imposée pour
// une séance de récupération explicitement légère.
const SWIM_VOLUME_FLOOR_M = {
  debutant: 1200,
  novice: 1500,
  intermediaire: 2000,
  confirme: 2800,
  expert: 3200,
};

function parseSwimTotalMeters(desc) {
  const m = String(desc || '').match(/Total\s*:\s*~?(\d[\d\s.,]*)\s*m\b/i);
  if (!m) return null;
  return Number(m[1].replace(/[\s.,]/g, '')) || null;
}

/**
 * GARDE-FOU AJOUTÉ : le prompt (voir lib/gemini.js, bloc "--- NATATION ---") donne déjà des
 * fourchettes de volume par niveau, mais rien ne garantissait qu'elles soient respectées —
 * observé en pratique : une séance "expert" à peine plus longue qu'un échauffement (~800-1000m)
 * malgré l'instruction. On complète donc ici, de façon déterministe, toute séance de natation
 * (hors récupération explicite) dont le volume total annoncé est en dessous du plancher attendu
 * pour ce niveau, en ajoutant un bloc aérobie supplémentaire au corps de séance plutôt qu'en
 * régénérant toute la séance (préserve le travail technique/spécifique déjà proposé par l'IA).
 */
export function enforceSwimVolumeFloor(weekWorkouts, fitnessLevel, trainingExperience, phaseKey) {
  if (!Array.isArray(weekWorkouts)) return weekWorkouts;
  if (phaseKey === 'taper') return weekWorkouts; // volume réduit voulu en affûtage, ne pas contrecarrer
  const floor = SWIM_VOLUME_FLOOR_M[trainingExperience] || SWIM_VOLUME_FLOOR_M.intermediaire;

  return weekWorkouts.map((w) => {
    if (classifyDiscipline(w.type) !== 'NATATION') return w;
    if (/récup|souple|technique légère/i.test(w.title || '') && parseDurationMinutes(w.duration) <= 30) return w; // séance volontairement courte, ne pas gonfler
    const total = parseSwimTotalMeters(w.desc);
    if (total === null || total >= floor) return w;

    const missing = floor - total;
    const extraSets = Math.max(1, Math.round(missing / 200));
    const extraM = extraSets * 200;
    const newTotal = total + extraM;
    const desc = String(w.desc || '');
    const extraLine = `${extraSets}*200 NC souple R : 20''`;
    // Insère le bloc complémentaire dans le CORPS DE SÉANCE, avant le séparateur "---" qui
    // introduit le retour au calme (format en 3 blocs imposé par le prompt) — jamais après,
    // pour ne pas faire suivre un retour au calme par un bloc d'effort supplémentaire.
    let newDesc;
    if (/\n---\n/.test(desc)) {
      newDesc = desc.replace(/\n---\n/, `\n${extraLine}\n---\n`);
    } else if (/Total\s*:/i.test(desc)) {
      newDesc = desc.replace(/(\n?)(Total\s*:\s*~?\d[\d\s.,]*\s*m\b.*)/i, `\n${extraLine}\n$2`);
    } else {
      newDesc = `${desc}\n${extraLine}`;
    }
    // Met à jour (ou ajoute) la ligne "Total :" pour qu'elle corresponde au volume réel après ajout.
    const finalDesc = /Total\s*:\s*~?\d[\d\s.,]*\s*m\b/i.test(newDesc)
      ? newDesc.replace(/Total\s*:\s*~?\d[\d\s.,]*\s*m\b/i, `Total : ~${newTotal}m`)
      : `${newDesc}\nTotal : ~${newTotal}m`;

    const durMin = parseDurationMinutes(w.duration) || 45;
    const addedMin = Math.round(extraM / 33); // ~33m/min de nage aérobie continue, approximation raisonnable
    const newDurMin = durMin + addedMin;
    const h = Math.floor(newDurMin / 60);
    const mnt = newDurMin % 60;
    const newDuration = h > 0 ? `${h}h${String(mnt).padStart(2, '0')}` : `${mnt} min`;

    return {
      ...w,
      duration: newDuration,
      desc: finalDesc,
    };
  });
}

// Fraction du volume/nombre de séances CIBLE à appliquer sur les toutes premières semaines
// d'un débutant complet/novice sans aucun historique — montée en charge progressive plutôt
// que d'imposer d'emblée le volume déclaré au questionnaire (qui reste l'objectif à MOYEN
// terme, pas le point de départ). Semaine N plus prudente que N+1, elle-même sous la cible.
const BEGINNER_RAMP_FACTOR = { N: 0.7, 'N+1': 0.82 };

/**
 * ROBUSTESSE AJOUTÉE : réduit proportionnellement le volume (durée de chaque séance non-REPOS)
 * des semaines N/N+1 d'un TOUT PREMIER plan pour un profil débutant complet/novice — la
 * progressivité doit aussi jouer sur le total hebdomadaire, pas seulement séance par séance
 * (voir enforceBeginnerProgression, qui plafonne mais ne réduit pas un volume déjà dans les
 * clous). Ne s'applique JAMAIS s'il existe déjà un historique de ressenti (l'athlète a déjà au
 * moins une semaine derrière lui, la progressivité doit alors suivre son ressenti réel via
 * applyEasierTrendProgression / applyFatigueAutoRegulation plutôt qu'un facteur générique figé).
 */
export function applyBeginnerFirstPlanRamp(weekWorkouts, fitnessLevel, trainingExperience, feedbackHistory, weekKey) {
  const level = Number(fitnessLevel) || 3;
  const expRank = EXPERIENCE_RANK[trainingExperience] || 3;
  if (level > 2 || expRank > 2) return weekWorkouts;
  if (Array.isArray(feedbackHistory) && feedbackHistory.length > 0) return weekWorkouts;
  if (!Array.isArray(weekWorkouts)) return weekWorkouts;
  const factor = BEGINNER_RAMP_FACTOR[weekKey] || 1;
  if (factor >= 1) return weekWorkouts;

  return weekWorkouts.map((w) => {
    if (w.type === 'REPOS') return w;
    const currentMin = parseDurationMinutes(w.duration);
    if (!currentMin) return w;
    const newMin = Math.max(15, Math.round((currentMin * factor) / 5) * 5); // arrondi au multiple de 5 le plus proche
    if (newMin >= currentMin) return w;
    const h = Math.floor(newMin / 60);
    const m = newMin % 60;
    const newDuration = h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
    return {
      ...w,
      duration: newDuration,
      desc: w.desc || '',
    };
  });
}

/**
 * ROBUSTESSE AJOUTÉE : symétrique de applyFatigueAutoRegulation. Quand le ressenti récent est
 * nettement PLUS FACILE que prévu (ex: séance de fractionné jugée 2/10 au lieu des 6/10
 * attendus, de façon répétée — voir summarizeFeedbackTrend), on densifie DÉTERMINISTIQUEMENT
 * une séance clé de la semaine plutôt que de laisser la seule mention textuelle du prompt
 * ("densifier/intensifier progressivement") à la discrétion de l'IA, qui ne le faisait pas de
 * façon fiable en pratique.
 */
export function applyEasierTrendProgression(weekWorkouts, trendDirection) {
  if (trendDirection !== 'easier' || !Array.isArray(weekWorkouts)) return weekWorkouts;
  const eligible = weekWorkouts.filter((w) => w.type !== 'REPOS' && !isHardSession(w) && !/\(allégée\)/i.test(w.title || ''));
  if (eligible.length === 0) return weekWorkouts;
  // Cible la séance la plus longue parmi les non-difficiles : c'est la plus susceptible d'être
  // une sortie d'endurance fondamentale où une densification (bloc de tempo/seuil ajouté) a du
  // sens sans transformer toute la semaine.
  const toIntensify = [...eligible].sort((a, b) => parseDurationMinutes(b.duration) - parseDurationMinutes(a.duration))[0];
  return weekWorkouts.map((w) => (w.id === toIntensify.id ? {
    ...w,
    title: `${w.title} (densifiée)`,
    desc: w.desc || '',
  } : w));
}

export function enforceBeginnerProgression(weekWorkouts, fitnessLevel, phaseKey, trainingExperience) {
  const level = Number(fitnessLevel) || 3;
  const expRank = EXPERIENCE_RANK[trainingExperience] || 3;
  if (level > 2 && expRank > 2) return weekWorkouts;
  if (!Array.isArray(weekWorkouts)) return weekWorkouts;
  if (phaseKey === 'peak' || phaseKey === 'taper') return weekWorkouts;

  return weekWorkouts.map((w) => {
    const discipline = classifyDiscipline(w.type);
    const caps = BEGINNER_DURATION_CAPS_MIN[discipline];
    if (!caps) return w;

    const currentMin = parseDurationMinutes(w.duration);
    let capMin = null;
    if (isHardSession(w) && currentMin > caps.hard) capMin = caps.hard;
    else if (isLongSession(w) && currentMin > caps.long) capMin = caps.long;
    if (capMin === null) return w;

    const h = Math.floor(capMin / 60);
    const m = capMin % 60;
    const newDuration = h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
    return {
      ...w,
      duration: newDuration,
      desc: w.desc || '',
    };
  });
}

// --- GARDE-FOU DÉTERMINISTE : PLANCHER DE DURÉE POUR LES SORTIES LONGUES (niveaux confirmé/expert) ---
// Symétrique du plafond débutant ci-dessus, dans l'autre sens : le prompt IA (voir
// buildEnduranceExpertRules dans lib/gemini.js) donne déjà une indication de durée minimum
// pour un profil confirmé/expert, mais rien ne garantissait qu'elle soit respectée — observé
// en pratique : une "sortie longue vélo" pour un profil expert plafonnée à 2h, alors qu'une
// vraie sortie longue à ce niveau (préparation format L/Half ou XL/Ironman) tourne plutôt
// autour de 2h30-3h en phase de base et peut monter à 3-4h en fin de préparation. Sur la
// course à pied, le plancher réaliste à ce niveau est d'environ 1h40-2h. Ces repères
// correspondent aux standards de préparation triathlon longue distance (plans type British
// Triathlon / USA Triathlon 70.3-Ironman pour ces tranches d'expérience).
const LONG_SESSION_FLOOR_MIN = {
  'C.A.P': { debutant: 45, novice: 60, intermediaire: 75, confirme: 100, expert: 120 },
  CYCLISME: { debutant: 60, novice: 90, intermediaire: 105, confirme: 150, expert: 180 },
};

/**
 * GARDE-FOU AJOUTÉ : relève la durée (et étoffe le corps de séance en conséquence) de toute
 * sortie longue course/vélo dont la durée annoncée est en dessous du plancher attendu pour
 * l'expérience déclarée. Ne touche jamais aux séances déjà au-dessus du plancher (l'IA peut
 * tout à fait proposer plus long, notamment en fin de préparation format L/XL — voir
 * describeSessionAllocation) ni à la phase d'affûtage (volume réduit voulu). Le bloc ajouté
 * suit le même principe que enforceSwimVolumeFloor : on complète le corps de séance existant
 * (bloc continu supplémentaire en endurance fondamentale Z2) plutôt que de régénérer toute la
 * séance, pour préserver le contenu déjà proposé par l'IA.
 */
export function enforceLongSessionFloor(weekWorkouts, trainingExperience, phaseKey) {
  if (!Array.isArray(weekWorkouts)) return weekWorkouts;
  if (phaseKey === 'taper') return weekWorkouts; // volume réduit voulu en affûtage, ne pas contrecarrer
  const expKey = EXPERIENCE_RANK[trainingExperience] ? trainingExperience : 'intermediaire';

  return weekWorkouts.map((w) => {
    const discipline = classifyDiscipline(w.type);
    const floors = LONG_SESSION_FLOOR_MIN[discipline];
    if (!floors) return w; // ne concerne pas la natation (plancher déjà géré en mètres par enforceSwimVolumeFloor)
    if (!isLongSession(w)) return w;

    const floorMin = floors[expKey] ?? floors.intermediaire;
    const currentMin = parseDurationMinutes(w.duration);
    if (!currentMin || currentMin >= floorMin) return w;

    const addedMin = floorMin - currentMin;
    const h = Math.floor(floorMin / 60);
    const m = floorMin % 60;
    const newDuration = h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;

    const extraLine = `+${addedMin}' supplémentaires en endurance fondamentale (Z2), allure conversationnelle`;
    const lines = String(w.desc || '').split('\n').filter(Boolean);
    // Insère juste avant la dernière ligne (le retour au calme, toujours en dernière position
    // dans le formalisme imposé par le prompt — voir lib/gemini.js, bloc "COURSE À PIED & VÉLO").
    const newDesc = lines.length > 0
      ? [...lines.slice(0, -1), extraLine, lines[lines.length - 1]].join('\n')
      : extraLine;

    return {
      ...w,
      duration: newDuration,
      desc: newDesc,
    };
  });
}

// Protocoles de test terrain standards — permettent d'obtenir une VMA/FTP/CSS RÉELLE en une
// seule séance, plutôt que de laisser l'athlète sans aucune donnée chiffrée pendant toute la
// préparation. Contenu volontairement complet (structure + explication du calcul) puisque
// c'est la seule séance de la semaine que sanitizeWorkout ne doit PAS réécrire en RPE.
const PHYSIO_TEST_TEMPLATES = {
  'C.A.P': {
    title: 'Test terrain — VMA (demi-Cooper)',
    duration: '35 min',
    intensity: 'Effort maximal soutenable sur 6 min — RPE 9-10/10',
    cadence: '175-180 spm',
    cardio: 'Z5 (effort maximal)',
    rpe: 'RPE 9/10',
    effortZone: 'Z5',
    restTime: '-',
    structure: 'Échauffement 15min progressif + 6min à allure maximale soutenable (demi-Cooper) + retour au calme 10-15min souple',
    desc: 'Échauffement :\n15min progressif Z1→Z2 + 3-4 accélérations progressives de 20s\nCorps de séance :\nCourir la plus grande distance possible en 6min, à allure MAXIMALE mais soutenable sur toute la durée (ne pas partir trop vite) — note la distance parcourue.\n---\n10-15min souple Z1\nTotal : ~35min\n\n📊 Calcul de ta VMA : VMA (km/h) = distance parcourue en 6min (mètres) × 0,01 × 6. Exemple : 1400m en 6min → VMA ≈ 14 km/h. Renseigne cette valeur dans ton profil pour que les prochains plans calculent des allures précises.',
  },
  // Vélo : DEUX variantes du même protocole (20min), au choix selon l'équipement
  // réellement disponible pour l'athlète (voir formData.bikeTestEquipment, WizardModal
  // étape 4) — un test qui suppose un capteur de puissance que l'athlète n'a pas serait
  // inutilisable, d'où la distinction explicite plutôt qu'un seul template générique.
  CYCLISME_HOMETRAINER: {
    title: 'Test terrain — FTP (20 min, home trainer)',
    duration: '55 min',
    intensity: 'Effort maximal soutenable sur 20 min — RPE 9/10',
    cadence: '85-95 rpm',
    cardio: 'Z4-Z5 (effort maximal)',
    rpe: 'RPE 9/10',
    effortZone: 'Z5',
    restTime: '-',
    structure: 'Échauffement 20min progressif avec 3x1min à haute intensité + 20min effort maximal soutenable (puissance) + retour au calme 10-15min souple',
    desc: "Échauffement :\n20min progressif + 3*1min à haute intensité (R : 2min souple) pour bien s'ouvrir les jambes\nCorps de séance :\nSur home trainer, avec capteur de puissance : 20min à la puissance MAXIMALE que tu peux maintenir sur toute la durée (effort régulier, pas un sprint puis une chute) — note la puissance moyenne (W) affichée à l'écran.\n---\n10-15min souple\nTotal : ~55min\n\n📊 Calcul de ta FTP : FTP (W) = puissance moyenne sur les 20min × 0,95. Renseigne cette valeur dans ton profil pour que les prochains plans calculent des zones de puissance précises.",
  },
  CYCLISME_ROUTE: {
    title: 'Test terrain — FTP (20 min, route)',
    duration: '55 min',
    intensity: 'Effort maximal soutenable sur 20 min — RPE 9/10',
    cadence: '85-95 rpm',
    cardio: 'Z4-Z5 (effort maximal)',
    rpe: 'RPE 9/10',
    effortZone: 'Z5',
    restTime: '-',
    structure: 'Échauffement 20min progressif avec 3x1min à haute intensité + 20min effort maximal soutenable sur route plate/faux-plat, sans vent ni feux + retour au calme 10-15min souple',
    desc: "Échauffement :\n20min progressif + 3*1min à haute intensité (R : 2min souple) pour bien s'ouvrir les jambes\nCorps de séance :\nSur route, choisis un tronçon plat ou en faux-plat montant, peu fréquenté (pas de feux/stops), si possible sans vent : 20min à l'effort MAXIMAL que tu peux maintenir sur toute la durée.\n— Avec capteur de puissance : note la puissance moyenne (W).\n— Sans capteur de puissance : note la vitesse moyenne (km/h) et la FC moyenne sur les 20min — ça ne donne pas une FTP en watts, mais une VITESSE et une FC seuil réutilisables pour caler tes allures/zones cardio vélo, à réévaluer sur le même tronçon pour suivre ta progression.\n---\n10-15min souple\nTotal : ~55min\n\n📊 Si tu as un capteur : FTP (W) = puissance moyenne sur les 20min × 0,95. Sinon, renseigne la vitesse/FC moyenne dans ton profil comme repère de niveau vélo actuel.",
  },
  NATATION: {
    title: 'Test terrain — CSS (2x400m/200m)',
    duration: '45 min',
    intensity: 'Effort maximal soutenable sur chaque distance — RPE 9/10',
    cadence: '34-38 mvt/min',
    cardio: 'Z4-Z5 (effort maximal)',
    rpe: 'RPE 9/10',
    effortZone: 'Z5',
    restTime: "10min de récupération complète entre les deux blocs",
    structure: 'Échauffement 400m souple + 400m chronométré à effort maximal + 10min récup + 200m chronométré à effort maximal + retour au calme',
    desc: "Échauffement :\n400m souple (NC) + educ technique 4*50m\nCorps de séance :\n400m à effort MAXIMAL soutenable, chronométré — note ton temps (T400)\n10min de récupération complète\n200m à effort MAXIMAL soutenable, chronométré — note ton temps (T200)\n---\n200 souple\nTotal : ~1400m\n\n📊 Calcul de ta CSS : CSS (allure /100m) = (T400 − T200) / 4. Renseigne cette valeur dans ton profil pour que les prochains plans calculent des allures de nage précises.",
  },
};

/**
 * Injecte une VRAIE séance de test terrain (VMA/FTP/CSS) en semaine N quand la métrique
 * correspondante n'est pas renseignée, au lieu de compter uniquement sur l'IA pour le
 * SUGGÉRER dans une description (ce qu'elle ne fait pas de façon fiable — voir le prompt
 * dans lib/gemini.js). Remplace la séance la plus "neutre" déjà présente pour cette
 * discipline (ni difficile, ni longue, ni déjà un test) plutôt que d'ajouter une 8e séance,
 * pour ne jamais casser le nombre de séances/semaine déclaré par l'athlète. Si aucune séance
 * de cette discipline n'est présente en semaine N (discipline non incluse dans le format visé
 * cette semaine-là), ne force rien — la suggestion textuelle du prompt reste alors le seul
 * repère, ce n'est pas grave puisque la discipline n'est de toute façon pas sollicitée.
 */
export function injectPhysioTestSessions(weekWorkouts, missingMetrics, options = {}) {
  if (!Array.isArray(weekWorkouts) || !missingMetrics?.length) return weekWorkouts;
  // Équipement déclaré au questionnaire (WizardModal étape 4) pour choisir la bonne variante
  // du test vélo — 'home_trainer' | 'route' (par défaut si non précisé : variante route, qui
  // couvre aussi le cas "sans capteur de puissance", plus fréquent que le home trainer).
  const bikeTemplateKey = options.bikeTestEquipment === 'home_trainer' ? 'CYCLISME_HOMETRAINER' : 'CYCLISME_ROUTE';
  let list = [...weekWorkouts];
  missingMetrics.forEach((discipline) => {
    const template = discipline === 'CYCLISME' ? PHYSIO_TEST_TEMPLATES[bikeTemplateKey] : PHYSIO_TEST_TEMPLATES[discipline];
    if (!template) return;
    const alreadyHasTest = list.some((w) => classifyDiscipline(w.type) === discipline && /test terrain/i.test(w.title || ''));
    if (alreadyHasTest) return;
    const candidates = list.filter((w) => classifyDiscipline(w.type) === discipline && !isHardSession(w) && !isLongSession(w));
    if (candidates.length === 0) return;
    const target = candidates[0];
    list = list.map((w) => (w.id === target.id ? {
      ...w,
      ...template,
      id: w.id,
      day: w.day,
      type: w.type,
    } : w));
  });
  return list;
}
