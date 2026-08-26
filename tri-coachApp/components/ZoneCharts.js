// components/ZoneCharts.js
//
// Onglet Profil > "Zones d'entraînement" (rendu depuis PerformanceDashboard.js) :
// zones d'intensité FC / Puissance / Allure, initialisées depuis le profil
// (FC max / FTP / VMA, voir lib/zones.js:defaultHrZones/defaultPowerZones/
// defaultPaceZones) puis 100% éditables manuellement et persistées indépendamment
// (tri_hr_zones / tri_power_zones / tri_pace_zones, voir lib/storage.js).
//
// RECONSTRUCTION (25/08/2026) : le fichier original avait été accidentellement
// écrasé par une copie de PerformanceDashboard.js (import circulaire ZoneCharts ->
// ZoneCharts -> ... qui faisait planter l'onglet Profil). Reconstruit à partir des
// autres fichiers du dépôt (lib/zones.js, lib/storage.js, l'appel dans
// PerformanceDashboard.js) — pas garanti identique pixel pour pixel à l'original,
// mais fonctionnellement complet.
//
// `paceZones` remonte au parent via `onPaceZonesChange` (voir pages/index.js) car
// ces zones influencent en direct le sanitize des séances déjà générées ; hrZones/
// powerZones restent locaux à ce composant (pas de contrepartie côté génération IA
// immédiate à ce jour).
import React, { useEffect, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '../lib/storage';
import {
  BIKE_SPORTS,
  RUN_SPORTS,
  defaultHrZones,
  defaultPowerZones,
  defaultPaceZones,
  isPlausiblePaceZones,
  computeZoneDistributionFromActivities,
} from '../lib/zones';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const AXIS_COLOR = '#565D67';
const GRID_COLOR = 'rgba(16, 19, 26, 0.08)';

// FC et Puissance s'appliquent aux deux disciplines (vélo ET course, ex: capteur de
// puissance Stryd en course à pied) — seule l'Allure (vitesse/pace) est spécifique à la
// course à pied, le vélo utilisant la Puissance comme équivalent (pas de zone de vitesse
// vélo distincte, ce serait redondant avec la Puissance pour cette discipline).
const METRIC_TABS = [
  { key: 'hr', label: 'FC', unit: 'bpm', sports: [...BIKE_SPORTS, ...RUN_SPORTS] },
  { key: 'power', label: 'Puissance', unit: 'W', sports: [...BIKE_SPORTS, ...RUN_SPORTS] },
  { key: 'pace', label: 'Allure', unit: 'km/h', sports: RUN_SPORTS },
];

// Affichage "allure" (m:ss/km) pour la zone Allure — les zones sont stockées en
// vitesse (km/h, voir lib/zones.js:defaultPaceZones) pour rester dans la même
// logique ascendante que les zones FC/Puissance ; la conversion ne se fait qu'ici.
function speedToPaceLabel(kmh) {
  if (!Number.isFinite(kmh) || kmh <= 0) return '-';
  const minPerKm = 60 / kmh;
  const min = Math.floor(minPerKm);
  const sec = Math.round((minPerKm - min) * 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function paceLabelToSpeed(label) {
  const m = String(label || '').match(/(\d+):(\d{1,2})/);
  if (!m) return null;
  const minPerKm = Number(m[1]) + Number(m[2]) / 60;
  if (!(minPerKm > 0)) return null;
  return Math.round((60 / minPerKm) * 100) / 100;
}

export default function ZoneCharts({ profile, activities, onPaceZonesChange }) {
  const [metricTab, setMetricTab] = useState('hr');
  const [hrZones, setHrZones] = useState(() => defaultHrZones(profile?.fcMax));
  const [powerZones, setPowerZones] = useState(() => defaultPowerZones(profile?.ftp));
  const [paceZones, setPaceZones] = useState(() => defaultPaceZones(profile?.vma));

  // Saisie "en brouillon" : les champs ci-dessous ne modifient QUE cet état local le
  // temps de la saisie — rien n'est persisté (localStorage) ni renvoyé au parent
  // (onPaceZonesChange, qui déclenche le recalcul des séances) tant que l'athlète n'a
  // pas cliqué sur "Valider". `draftZones` est réinitialisé sur les valeurs actives
  // à chaque changement d'onglet (voir l'effet ci-dessous), donc quitter un onglet
  // sans valider abandonne silencieusement les modifications non validées de cet
  // onglet, comme un formulaire classique.
  const [draftZones, setDraftZones] = useState(null);
  // Résultat de la dernière validation : { type: 'success' | 'error', message } — affiché
  // en popup puis effacé. `null` = aucune popup à l'écran.
  const [validationResult, setValidationResult] = useState(null);

  // Charge les bornes déjà personnalisées (si l'athlète les a éditées avant) —
  // sinon on garde les valeurs par défaut dérivées du profil calculées ci-dessus.
  // BUG RÉEL CORRIGÉ : cet effet ne dépendait auparavant que de `[]` (exécuté une seule
  // fois au montage). Or `profile` est chargé de façon ASYNCHRONE depuis le localStorage
  // par le composant parent (voir pages/index.js, useEffect "CHARGEMENT INITIAL") : si
  // l'onglet Profil est déjà affiché au chargement de la page, ZoneCharts se montait
  // AVANT la fin de cette hydratation, avec `profile` encore à sa valeur par défaut
  // (fcMax/ftp/vma = null) — les zones par défaut calculées (repli 190 bpm / 200 W / 14
  // km/h) restaient alors figées indéfiniment, même une fois le vrai profil chargé, tant
  // que la page n'était pas rechargée. On dépend maintenant des vraies valeurs du profil
  // pour que l'effet se ré-exécute dès qu'elles arrivent (sans risque d'écraser une
  // édition manuelle : `loadFromStorage` continue de prioriser le localStorage sur la
  // valeur par défaut recalculée).
  useEffect(() => {
    setHrZones(loadFromStorage(STORAGE_KEYS.hrZones, defaultHrZones(profile?.fcMax)));
    setPowerZones(loadFromStorage(STORAGE_KEYS.powerZones, defaultPowerZones(profile?.ftp)));
    // GARDE-FOU (BUG RÉEL CORRIGÉ) : sur un appareil qui a connu l'ancien bug d'unités
    // (zones "Allure" initialisées avec la formule des zones FC au lieu de la VMA), la
    // valeur déjà en localStorage n'est PAS une vitesse plausible (ex: 117, 140, 160,
    // 174 — des bpm, pas des km/h) — voir lib/zones.js:isPlausiblePaceZones. On ignore
    // alors cette valeur corrompue et on ré-initialise + ré-persiste immédiatement la
    // bonne valeur par défaut, au lieu de la réafficher telle quelle indéfiniment.
    const storedPaceZones = loadFromStorage(STORAGE_KEYS.paceZones, null);
    const fallbackPaceZones = defaultPaceZones(profile?.vma);
    if (storedPaceZones && isPlausiblePaceZones(storedPaceZones)) {
      setPaceZones(storedPaceZones);
    } else {
      setPaceZones(fallbackPaceZones);
      saveToStorage(STORAGE_KEYS.paceZones, fallbackPaceZones);
    }
  }, [profile?.fcMax, profile?.ftp, profile?.vma]);

  const activeTab = METRIC_TABS.find((t) => t.key === metricTab);
  const committedZones = metricTab === 'hr' ? hrZones : metricTab === 'power' ? powerZones : paceZones;
  // Tant que l'athlète édite (draftZones non nul), l'affichage (graphe + champs) suit le
  // brouillon en temps réel — mais RIEN n'est persisté ni renvoyé au parent avant "Valider".
  const activeZones = draftZones || committedZones;

  // Réinitialise le brouillon sur les valeurs actives à chaque changement d'onglet, et
  // aussi quand les zones "committées" changent pour une cause EXTERNE à ce composant
  // (chargement localStorage au montage, arrivée async du profil — voir l'effet
  // ci-dessus) : dans les deux cas on repart d'un brouillon propre, jamais d'une
  // saisie abandonnée d'un onglet précédent.
  useEffect(() => {
    setDraftZones(metricTab === 'hr' ? hrZones : metricTab === 'power' ? powerZones : paceZones);
    setValidationResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricTab, hrZones, powerZones, paceZones]);

  // Efface automatiquement la popup de confirmation/erreur après quelques secondes,
  // sans bloquer une fermeture manuelle anticipée (bouton × plus bas).
  useEffect(() => {
    if (!validationResult) return undefined;
    const timer = setTimeout(() => setValidationResult(null), 5000);
    return () => clearTimeout(timer);
  }, [validationResult]);

  const distribution = computeZoneDistributionFromActivities(activities, activeZones, {
    metric: metricTab,
    sports: activeTab.sports,
  });

  // Ne modifie QUE le brouillon local — voir "Valider" (handleValidate) pour la
  // persistance réelle + le recalcul des séances existantes.
  function updateDraftMin(zoneKey, rawValue) {
    const value = metricTab === 'pace' ? paceLabelToSpeed(rawValue) : Number(rawValue);
    if (!Number.isFinite(value)) {
      // Saisie illisible (ex: "abc", ou un format d'allure incomplet) : on prévient
      // tout de suite plutôt que de laisser "Valider" échouer plus tard sans que
      // l'athlète comprenne quel champ pose problème.
      setValidationResult({
        type: 'error',
        message: `Valeur non reconnue pour ${zoneKey} : "${rawValue}" (${metricTab === 'pace' ? 'format attendu m:ss, ex. 5:07' : 'nombre attendu'}).`,
      });
      return;
    }
    setDraftZones((prev) => (prev || activeZones).map((z) => (z.zone === zoneKey ? { ...z, min: value } : z)));
  }

  function handleValidate() {
    const zonesToCommit = draftZones || activeZones;

    // Garde-fou : quelle que soit la métrique, les zones sont stockées avec une borne
    // "min" strictement croissante de Z1 à Z5 (voir lib/zones.js) — tout le reste de
    // l'app (enrichWorkoutMetrics, computeZoneDistributionFromActivities...) suppose
    // cet ordre. On refuse la validation plutôt que d'enregistrer des zones
    // incohérentes qui produiraient des séances ou une répartition absurdes.
    for (let i = 1; i < zonesToCommit.length; i += 1) {
      const prevZone = zonesToCommit[i - 1];
      const curZone = zonesToCommit[i];
      if (!(Number(curZone.min) > Number(prevZone.min))) {
        const fmt = (v) => (metricTab === 'pace' ? `${speedToPaceLabel(v)} /km` : `${v} ${activeTab.unit}`);
        setValidationResult({
          type: 'error',
          message: `Zones non enregistrées : ${curZone.zone} (${fmt(curZone.min)}) doit être strictement supérieure à ${prevZone.zone} (${fmt(prevZone.min)}).`,
        });
        return;
      }
    }

    const setter = metricTab === 'hr' ? setHrZones : metricTab === 'power' ? setPowerZones : setPaceZones;
    const storageKey =
      metricTab === 'hr' ? STORAGE_KEYS.hrZones : metricTab === 'power' ? STORAGE_KEYS.powerZones : STORAGE_KEYS.paceZones;

    setter(zonesToCommit);
    saveToStorage(storageKey, zonesToCommit);
    // Seules les zones d'allure ont une contrepartie immédiate sur les séances déjà
    // générées (voir pages/index.js:handlePaceZonesChange, qui rappelle sanitizeWorkout
    // sur tout le calendrier) — FC/Puissance restent locales à cet onglet à ce jour.
    if (metricTab === 'pace' && onPaceZonesChange) onPaceZonesChange(zonesToCommit);

    setValidationResult({
      type: 'success',
      message:
        metricTab === 'pace'
          ? "Zones d'allure enregistrées : tes séances déjà générées viennent d'être recalculées avec ces valeurs, et l'IA s'appuiera dessus pour les prochaines générations."
          : `Zones ${activeTab.label.toLowerCase()} enregistrées.`,
    });
  }

  const chartData = {
    labels: distribution.zones.map((z) => z.zone),
    datasets: [
      {
        label: 'Minutes',
        data: distribution.zones.map((z) => z.minutes),
        backgroundColor: distribution.zones.map((z) => z.color),
        borderRadius: 6,
        maxBarThickness: 32,
      },
    ],
  };
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { titleFont: { size: 12 }, bodyFont: { size: 12 }, callbacks: { label: (ctx) => `${ctx.parsed.y} min` } },
    },
    scales: {
      y: { beginAtZero: true, ticks: { color: AXIS_COLOR, font: { size: 10 } }, grid: { color: GRID_COLOR } },
      x: { ticks: { color: '#3D434C', font: { size: 11, weight: '600' } }, grid: { display: false } },
    },
  };

  return (
    <div className="bg-ink-950 border border-ink-800 rounded-xl p-3 space-y-3">
      <div className="grid grid-cols-3 gap-1 bg-ink-900 border border-ink-800 rounded-xl p-1">
        {METRIC_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setMetricTab(tab.key)}
            className={`py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
              metricTab === tab.key ? 'bg-volt-500 text-white' : 'text-ink-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {distribution.countedActivities > 0 ? (
        <div className="relative h-40">
          <Bar data={chartData} options={chartOptions} />
        </div>
      ) : (
        <p className="text-xs text-ink-500 text-center py-6">
          Pas assez d'activités {activeTab.label.toLowerCase()} synchronisées pour calculer une répartition.
        </p>
      )}

      <div className="space-y-1.5">
        {activeZones.map((z) => (
          // BUG RÉEL CORRIGÉ : la clé doit inclure `metricTab`. Les champs ci-dessous sont
          // non contrôlés (`defaultValue`, pas `value`) — React ne relit `defaultValue` qu'au
          // MONTAGE d'un nœud. Avec une clé partagée entre onglets (juste `z.zone`, identique
          // pour Z1..Z5 en FC/Puissance/Allure), passer de FC à Allure réutilisait le MÊME
          // <input> DOM plutôt que d'en créer un nouveau : le champ restait figé sur la valeur
          // brute affichée par l'onglet précédent (ex: "117") au lieu d'afficher l'allure
          // recalculée ("5:07"), même si `paceZones` en mémoire était déjà correct. Inclure
          // `metricTab` force un vrai remount à chaque changement d'onglet.
          <div key={`${metricTab}-${z.zone}`} className="flex items-center gap-2 text-[11px]">
            <span className="w-6 font-bold shrink-0" style={{ color: z.color }}>{z.zone}</span>
            <span className="flex-1 text-ink-400 truncate">{z.label}</span>
            {metricTab === 'pace' ? (
              <input
                type="text"
                defaultValue={speedToPaceLabel(z.min)}
                onBlur={(e) => updateDraftMin(z.zone, e.target.value)}
                className="w-16 text-right bg-ink-900 border border-ink-800 rounded-lg px-2 py-1 text-ink-100 font-mono text-[11px]"
              />
            ) : (
              <input
                type="number"
                defaultValue={z.min}
                onBlur={(e) => updateDraftMin(z.zone, e.target.value)}
                className="w-16 text-right bg-ink-900 border border-ink-800 rounded-lg px-2 py-1 text-ink-100 font-mono text-[11px]"
              />
            )}
            <span className="w-9 text-ink-500 text-[10px] shrink-0">{metricTab === 'pace' ? '/km' : activeTab.unit}</span>
          </div>
        ))}
      </div>

      <button
        onClick={handleValidate}
        className="w-full text-[11px] font-bold py-2 rounded-lg bg-volt-500 text-white hover:bg-volt-600 transition-colors"
      >
        Valider les zones {activeTab.label.toLowerCase()}
      </button>

      {validationResult && (
        <div
          className={`flex items-start gap-2 text-[11px] rounded-lg px-3 py-2 border ${
            validationResult.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          <span className="flex-1 leading-snug">
            {validationResult.type === 'success' ? '✓ ' : '⚠ '}
            {validationResult.message}
          </span>
          <button
            onClick={() => setValidationResult(null)}
            className="shrink-0 opacity-70 hover:opacity-100 font-bold"
            aria-label="Fermer"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
