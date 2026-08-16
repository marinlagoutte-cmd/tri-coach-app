// lib/physiology.js
//
// RÈGLE ABSOLUE : ne JAMAIS inventer de valeur physiologique. Avant, ce module
// dérivait un chiffre plausible mais fictif à partir du seul niveau déclaré 1-5
// (ex: "débutant" → VMA 11.5 km/h) — l'athlète voyait alors une donnée qu'il n'avait
// jamais fournie, ce qui est trompeur et faux. Dorénavant, la seule hiérarchie
// acceptée est :
//   1) valeur mesurée déclarée par l'athlète (ce wizard),
//   2) sinon dérivée d'un chrono récent RÉELLEMENT fourni par l'athlète (calcul,
//      pas une invention — la donnée source est authentique),
//   3) sinon la valeur déjà connue dans son profil existant (saisie précédente),
//   4) sinon **rien** : null, explicitement signalé comme "non renseigné".
// Le prompt de génération adapte alors son discours (repères RPE au lieu de
// vitesses/puissances chiffrées) plutôt que de calculer sur du sable.

function hhmmssToMinutes(str) {
  if (!str) return null;
  const s = String(str).trim();
  const parts = s.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  return Number(s) || null;
}

// Repères classiques coaching : % de la VMA tenu selon la durée/distance de course
// (plus la distance est longue, plus le % de VMA soutenable baisse).
function vmaPercentForDistance(km) {
  if (km <= 3) return 0.97;
  if (km <= 5) return 0.94;
  if (km <= 10) return 0.89;
  if (km <= 15) return 0.86;
  if (km <= 21.5) return 0.83;
  if (km <= 30) return 0.79;
  return 0.75; // marathon et au-delà
}

/** Estime la VMA (km/h) à partir d'un chrono récent RÉEL sur une distance connue. */
export function estimateVmaFromResult(distanceKm, timeStr) {
  const minutes = hhmmssToMinutes(timeStr);
  const km = Number(distanceKm);
  if (!minutes || !km || minutes <= 0 || km <= 0) return null;
  const avgSpeedKmh = km / (minutes / 60);
  const pct = vmaPercentForDistance(km);
  return Math.round((avgSpeedKmh / pct) * 10) / 10;
}

/**
 * Construit le profil physiologique réellement utilisé pour générer le plan.
 * Ne renvoie QUE des valeurs mesurées, dérivées d'une donnée réelle (chrono), ou
 * déjà connues du profil existant. Jamais de valeur devinée à partir du niveau
 * déclaré — un champ non renseigné reste `null` avec une explication claire.
 */
export function resolveAthletePhysiology(wizardData, baseProfile) {
  const known = wizardData?.knownPhysio || {};
  const recent = wizardData?.recentResult || {};
  const estimatedVma = estimateVmaFromResult(recent.distanceKm, recent.time);

  const result = {};

  // --- VMA ---
  if (known.vma && Number(known.vma) > 0) {
    result.vma = Number(known.vma);
    result.vmaSource = 'mesurée (déclarée par l\'athlète)';
  } else if (estimatedVma) {
    result.vma = estimatedVma;
    result.vmaSource = `estimée depuis un chrono récent réellement fourni (${recent.distanceKm}km en ${recent.time})`;
  } else if (baseProfile?.vma) {
    result.vma = baseProfile.vma;
    result.vmaSource = 'valeur déjà connue du profil (saisie précédente)';
  } else {
    result.vma = null;
    result.vmaSource = "non renseignée — l'athlète n'a fourni ni valeur mesurée ni chrono récent";
  }

  // --- FTP (uniquement pertinent si vélo dans le plan) ---
  if (known.ftp && Number(known.ftp) > 0) {
    result.ftp = Number(known.ftp);
    result.ftpSource = 'mesurée (déclarée par l\'athlète, test FTP ou estimation home trainer)';
  } else if (baseProfile?.ftp) {
    result.ftp = baseProfile.ftp;
    result.ftpSource = 'valeur déjà connue du profil (saisie précédente)';
  } else {
    result.ftp = null;
    result.ftpSource = "non renseignée — aucun test FTP fourni";
  }

  // --- CSS natation (uniquement pertinent si natation dans le plan) ---
  if (known.css) {
    result.nat100 = known.css;
    result.nat100Source = 'mesurée (déclarée par l\'athlète, test CSS ou 100m chronométré)';
  } else if (baseProfile?.nat100) {
    result.nat100 = baseProfile.nat100;
    result.nat100Source = 'valeur déjà connue du profil (saisie précédente)';
  } else {
    result.nat100 = null;
    result.nat100Source = "non renseignée — aucune mesure fournie";
  }

  // --- FC max / repos ---
  const age = Number(wizardData?.age);
  if (known.fcMax && Number(known.fcMax) > 0) {
    result.fcMax = Number(known.fcMax);
    result.fcMaxSource = 'mesurée (déclarée par l\'athlète)';
  } else if (age > 0) {
    result.fcMax = Math.round(220 - age);
    result.fcMaxSource = `estimée par la formule 220-âge (âge ${age} ans, donnée réellement fournie) — approximative, un test terrain est plus fiable`;
  } else if (baseProfile?.fcMax) {
    result.fcMax = baseProfile.fcMax;
    result.fcMaxSource = 'valeur déjà connue du profil (saisie précédente)';
  } else {
    result.fcMax = null;
    result.fcMaxSource = 'non renseignée — ni mesure ni âge fournis';
  }

  if (known.fcRepos && Number(known.fcRepos) > 0) {
    result.fcRepos = Number(known.fcRepos);
    result.fcReposSource = 'mesurée (déclarée par l\'athlète)';
  } else if (baseProfile?.fcRepos) {
    result.fcRepos = baseProfile.fcRepos;
    result.fcReposSource = 'valeur déjà connue du profil (saisie précédente)';
  } else {
    result.fcRepos = null;
    result.fcReposSource = 'non renseignée';
  }

  return result;
}

/**
 * Ajuste légèrement la physiologie résolue en fonction de la tendance de ressenti
 * récente (voir lib/feedback.js summarizeFeedbackTrend). Ne s'applique JAMAIS à un
 * champ null (rien à ajuster) ni à une valeur mesurée (jamais on n'écrase une
 * déclaration explicite de l'athlète).
 */
export function applyFeedbackTrendToPhysiology(physio, trend) {
  if (!trend || trend.direction === 'stable' || trend.sampleSize < 3) return physio;
  const adjusted = { ...physio };
  const factor = trend.direction === 'easier' ? 1.03 : 0.97;
  if (physio.vma && !physio.vmaSource?.startsWith('mesurée')) {
    adjusted.vma = Math.round(physio.vma * factor * 10) / 10;
    adjusted.vmaSource = `${physio.vmaSource} + ajustement ${trend.direction === 'easier' ? '+3%' : '-3%'} suite à la tendance de ressenti récente (${trend.label})`;
  }
  if (physio.ftp && !physio.ftpSource?.startsWith('mesurée')) {
    adjusted.ftp = Math.round(physio.ftp * factor);
    adjusted.ftpSource = `${physio.ftpSource} + ajustement ${trend.direction === 'easier' ? '+3%' : '-3%'} suite à la tendance de ressenti récente (${trend.label})`;
  }
  if (physio.nat100 && !physio.nat100Source?.startsWith('mesurée')) {
    const m = String(physio.nat100).match(/(\d+):(\d{2})/);
    if (m) {
      const sec = Number(m[1]) * 60 + Number(m[2]);
      const newSec = trend.direction === 'easier' ? sec * 0.97 : sec * 1.03;
      const min = Math.floor(newSec / 60);
      const s = Math.round(newSec % 60);
      adjusted.nat100 = `${min}:${String(s).padStart(2, '0')}`;
      adjusted.nat100Source = `${physio.nat100Source} + ajustement suite à la tendance de ressenti récente (${trend.label})`;
    }
  }
  return adjusted;
}
