// lib/physiology.js
//
// Avant : generatePlanWithAI utilisait TOUJOURS profile.vma / profile.ftp / profile.nat100,
// qui valaient les constantes génériques de lib/defaults.js (16.5 km/h, 280W, 1:35/100m)
// pour absolument tous les athlètes, quel que soit leur niveau déclaré au wizard —
// un FTP de 280W (cycliste bien entraîné) était par exemple injecté dans le plan
// d'un débutant. Ce module calcule une valeur adaptée à CET athlète :
//   1) valeur mesurée déclarée par l'athlète (fiabilité "mesurée") si fournie,
//   2) sinon estimée depuis un chrono récent qu'il a renseigné ("estimée"),
//   3) sinon dérivée de son niveau de forme déclaré 1-5 ("approximation par niveau"),
// avec un tag de fiabilité explicite transmis à l'IA pour qu'elle module sa confiance.

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

/** Estime la VMA (km/h) à partir d'un chrono récent sur une distance connue. */
export function estimateVmaFromResult(distanceKm, timeStr) {
  const minutes = hhmmssToMinutes(timeStr);
  const km = Number(distanceKm);
  if (!minutes || !km || minutes <= 0 || km <= 0) return null;
  const avgSpeedKmh = km / (minutes / 60);
  const pct = vmaPercentForDistance(km);
  return Math.round((avgSpeedKmh / pct) * 10) / 10;
}

// Défauts dérivés du niveau de forme déclaré (1-5) plutôt qu'une seule valeur
// unique pour tout le monde — approximation grossière mais bien plus honnête
// qu'une constante fixe quand l'athlète n'a fourni ni test ni chrono.
const VMA_BY_LEVEL = { 1: 11.5, 2: 13, 3: 14.5, 4: 16.5, 5: 18.5 }; // km/h
const FTP_WKG_BY_LEVEL = { 1: 1.8, 2: 2.2, 3: 2.7, 4: 3.3, 5: 4.0 }; // W/kg
const CSS_BY_LEVEL = { 1: '2:15', 2: '1:55', 3: '1:40', 4: '1:28', 5: '1:15' }; // min:ss /100m
const FCMAX_DEFAULT = 190;
const FCREPOS_BY_LEVEL = { 1: 65, 2: 60, 3: 56, 4: 50, 5: 45 };

function cssToSeconds(str) {
  const m = hhmmssToMinutes(str);
  return m ? m * 60 : null;
}
function secondsToCss(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Construit le profil physiologique réellement utilisé pour générer le plan,
 * à partir : des valeurs mesurées déclarées (wizardData.knownPhysio), d'un
 * chrono récent (wizardData.recentResult), et à défaut du niveau de forme.
 * Retourne aussi `reliability` par métrique pour informer le prompt IA.
 */
export function resolveAthletePhysiology(wizardData, baseProfile) {
  const level = Number(wizardData?.fitnessLevel) || 3;
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
    result.vmaSource = `estimée depuis un chrono récent (${recent.distanceKm}km en ${recent.time})`;
  } else {
    result.vma = VMA_BY_LEVEL[level];
    result.vmaSource = `approximation générique basée sur le niveau déclaré (${level}/5) — AUCUNE mesure fournie, à considérer avec prudence`;
  }

  // --- FTP (uniquement pertinent si vélo dans le plan) ---
  const weight = Number(wizardData?.weight || baseProfile?.weight) || 70;
  if (known.ftp && Number(known.ftp) > 0) {
    result.ftp = Number(known.ftp);
    result.ftpSource = 'mesurée (déclarée par l\'athlète, test FTP ou estimation home trainer)';
  } else {
    result.ftp = Math.round(FTP_WKG_BY_LEVEL[level] * weight);
    result.ftpSource = `approximation générique (${FTP_WKG_BY_LEVEL[level]}W/kg pour le niveau ${level}/5 × ${weight}kg) — AUCUN test FTP fourni, à considérer avec prudence`;
  }

  // --- CSS natation (uniquement pertinent si natation dans le plan) ---
  if (known.css) {
    result.nat100 = known.css;
    result.nat100Source = 'mesurée (déclarée par l\'athlète, test CSS ou 100m chronométré)';
  } else {
    result.nat100 = CSS_BY_LEVEL[level];
    result.nat100Source = `approximation générique basée sur le niveau déclaré (${level}/5) — AUCUNE mesure fournie, à considérer avec prudence`;
  }

  // --- FC max / repos ---
  const age = Number(wizardData?.age);
  if (known.fcMax && Number(known.fcMax) > 0) {
    result.fcMax = Number(known.fcMax);
    result.fcMaxSource = 'mesurée (déclarée par l\'athlète)';
  } else if (age > 0) {
    result.fcMax = Math.round(220 - age);
    result.fcMaxSource = `estimée par la formule 220-âge (âge ${age} ans) — approximative, un test terrain est plus fiable`;
  } else {
    result.fcMax = FCMAX_DEFAULT;
    result.fcMaxSource = 'valeur par défaut générique (190 bpm) — AUCUNE mesure ni âge fournis, à considérer avec prudence';
  }

  if (known.fcRepos && Number(known.fcRepos) > 0) {
    result.fcRepos = Number(known.fcRepos);
    result.fcReposSource = 'mesurée (déclarée par l\'athlète)';
  } else {
    result.fcRepos = FCREPOS_BY_LEVEL[level];
    result.fcReposSource = `approximation générique basée sur le niveau déclaré (${level}/5) — AUCUNE mesure fournie`;
  }

  return result;
}

/**
 * Ajuste légèrement la physiologie résolue en fonction de la tendance de ressenti
 * récente (voir lib/feedback.js summarizeFeedbackTrend) : si l'athlète trouve
 * systématiquement les séances plus faciles que prévu, ses zones sont probablement
 * sous-évaluées (et inversement). Ne s'applique qu'aux valeurs NON mesurées
 * (jamais on n'écrase une valeur mesurée/déclarée par l'athlète).
 */
export function applyFeedbackTrendToPhysiology(physio, trend) {
  if (!trend || trend.direction === 'stable' || trend.sampleSize < 3) return physio;
  const adjusted = { ...physio };
  const factor = trend.direction === 'easier' ? 1.03 : 0.97;
  if (!physio.vmaSource?.startsWith('mesurée')) {
    adjusted.vma = Math.round(physio.vma * factor * 10) / 10;
    adjusted.vmaSource = `${physio.vmaSource} + ajustement ${trend.direction === 'easier' ? '+3%' : '-3%'} suite à la tendance de ressenti récente (${trend.label})`;
  }
  if (!physio.ftpSource?.startsWith('mesurée')) {
    adjusted.ftp = Math.round(physio.ftp * factor);
    adjusted.ftpSource = `${physio.ftpSource} + ajustement ${trend.direction === 'easier' ? '+3%' : '-3%'} suite à la tendance de ressenti récente (${trend.label})`;
  }
  if (!physio.nat100Source?.startsWith('mesurée')) {
    const sec = cssToSeconds(physio.nat100);
    if (sec) {
      adjusted.nat100 = secondsToCss(trend.direction === 'easier' ? sec * 0.97 : sec * 1.03);
      adjusted.nat100Source = `${physio.nat100Source} + ajustement suite à la tendance de ressenti récente (${trend.label})`;
    }
  }
  return adjusted;
}
