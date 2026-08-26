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
  const activeZones = metricTab === 'hr' ? hrZones : metricTab === 'power' ? powerZones : paceZones;

  const distribution = computeZoneDistributionFromActivities(activities, activeZones, {
    metric: metricTab,
    sports: activeTab.sports,
  });

  function updateZoneMin(zoneKey, rawValue) {
    const setter = metricTab === 'hr' ? setHrZones : metricTab === 'power' ? setPowerZones : setPaceZones;
    const storageKey =
      metricTab === 'hr' ? STORAGE_KEYS.hrZones : metricTab === 'power' ? STORAGE_KEYS.powerZones : STORAGE_KEYS.paceZones;
    const value = metricTab === 'pace' ? paceLabelToSpeed(rawValue) : Number(rawValue);
    if (!Number.isFinite(value)) return;
    setter((prev) => {
      const next = prev.map((z) => (z.zone === zoneKey ? { ...z, min: value } : z));
      saveToStorage(storageKey, next);
      if (metricTab === 'pace' && onPaceZonesChange) onPaceZonesChange(next);
      return next;
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
          <div key={z.zone} className="flex items-center gap-2 text-[11px]">
            <span className="w-6 font-bold shrink-0" style={{ color: z.color }}>{z.zone}</span>
            <span className="flex-1 text-ink-400 truncate">{z.label}</span>
            {metricTab === 'pace' ? (
              <input
                type="text"
                defaultValue={speedToPaceLabel(z.min)}
                onBlur={(e) => updateZoneMin(z.zone, e.target.value)}
                className="w-16 text-right bg-ink-900 border border-ink-800 rounded-lg px-2 py-1 text-ink-100 font-mono text-[11px]"
              />
            ) : (
              <input
                type="number"
                defaultValue={z.min}
                onBlur={(e) => updateZoneMin(z.zone, e.target.value)}
                className="w-16 text-right bg-ink-900 border border-ink-800 rounded-lg px-2 py-1 text-ink-100 font-mono text-[11px]"
              />
            )}
            <span className="w-9 text-ink-500 text-[10px] shrink-0">{metricTab === 'pace' ? '/km' : activeTab.unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
