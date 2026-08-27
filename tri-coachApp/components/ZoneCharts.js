// components/ZoneCharts.js
//
// Onglet Profil > "Zones d'entraînement" (rendu depuis PerformanceDashboard.js) :
// zones d'intensité FC / Puissance / Allure, initialisées depuis le profil
// (FC max / FTP / VMA, voir lib/zones.js:defaultHrZones/defaultPowerZones/
// defaultPaceZones) puis 100% éditables manuellement et persistées indépendamment
// (voir lib/storage.js).
//
// BUG RÉEL CORRIGÉ (26/08/2026) : FC et Puissance utilisaient CHACUNE un seul et même
// jeu de zones, appliqué indistinctement aux activités vélo ET course (voir
// STORAGE_KEYS.hrZones/powerZones dans lib/storage.js, historiquement documentées
// "vélo & course"). Concrètement : une séance de vélo à 250W et une séance de course
// à 250W (capteur Stryd) tombaient dans LA MÊME zone, alors que 250W n'a pas du tout le
// même sens physiologique dans les deux disciplines (250W = zone d'endurance pour un
// cycliste dont la FTP est de 300W, mais peut être une allure quasi-seuil en course) —
// d'où une répartition par zone qui pouvait sembler complètement incohérente ("n'importe
// quoi"), sans qu'aucune valeur ne soit littéralement "inversée" entre FC et Puissance
// (vérifié : fcMax → defaultHrZones et ftp → defaultPowerZones sont correctement
// câblés). Le vrai problème était l'absence de séparation par discipline. Ce fichier
// gère maintenant DEUX jeux de zones indépendants pour FC et pour Puissance — un pour
// la course, un pour le vélo — sélectionnés via le bouton "Course / Vélo" ci-dessous, et
// persistés séparément (voir STORAGE_KEYS.hrZones/hrZonesBike/powerZones/powerZonesBike).
// L'Allure reste spécifique à la course (le vélo n'a pas de zone de vitesse distincte,
// il utilise sa Puissance) et n'est donc affichée/éditable que quand "Course" est
// sélectionné.
//
// `paceZones` remonte au parent via `onPaceZonesChange` (voir pages/index.js) car
// ces zones influencent en direct le sanitize des séances déjà générées ; hrZones/
// powerZones (course ET vélo) restent locales à ce composant (pas de contrepartie
// côté génération IA immédiate à ce jour).
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

const DISCIPLINES = [
  { key: 'run', label: 'Course à pied', sports: RUN_SPORTS },
  { key: 'bike', label: 'Vélo', sports: BIKE_SPORTS },
];

// L'Allure est course-only (voir en-tête de fichier) — FC et Puissance existent pour
// les deux disciplines, mais avec un jeu de zones DISTINCT par discipline désormais.
const METRIC_TABS = [
  { key: 'hr', label: 'FC', unit: 'bpm', disciplines: ['run', 'bike'] },
  { key: 'power', label: 'Puissance', unit: 'W', disciplines: ['run', 'bike'] },
  { key: 'pace', label: 'Allure', unit: 'km/h', disciplines: ['run'] },
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
  const [discipline, setDiscipline] = useState('run');
  const [metricTab, setMetricTab] = useState('hr');

  // Deux jeux de zones indépendants pour FC et pour Puissance (course / vélo) — voir
  // le commentaire d'en-tête. Faute d'un second champ de profil dédié au vélo (seuls
  // fcMax/ftp/vma existent, voir lib/defaults.js), les DEUX disciplines démarrent sur
  // le même calcul par défaut ; elles deviennent ensuite 100% indépendantes dès que
  // l'athlète valide une modification sur l'une ou l'autre (jamais de valeur inventée
  // au-delà de ce repli initial commun).
  const [hrZonesRun, setHrZonesRun] = useState(() => defaultHrZones(profile?.fcMax));
  const [hrZonesBike, setHrZonesBike] = useState(() => defaultHrZones(profile?.fcMax));
  const [powerZonesRun, setPowerZonesRun] = useState(() => defaultPowerZones(profile?.ftp));
  const [powerZonesBike, setPowerZonesBike] = useState(() => defaultPowerZones(profile?.ftp));
  const [paceZones, setPaceZones] = useState(() => defaultPaceZones(profile?.vma));

  // Saisie "en brouillon" : les champs ci-dessous ne modifient QUE cet état local le
  // temps de la saisie — rien n'est persisté (localStorage) ni renvoyé au parent
  // (onPaceZonesChange, qui déclenche le recalcul des séances) tant que l'athlète n'a
  // pas cliqué sur "Valider". `draftZones` est réinitialisé sur les valeurs actives
  // à chaque changement de discipline/onglet (voir l'effet ci-dessous), donc quitter
  // un onglet sans valider abandonne silencieusement les modifications non validées
  // de cet onglet, comme un formulaire classique.
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
    setHrZonesRun(loadFromStorage(STORAGE_KEYS.hrZones, defaultHrZones(profile?.fcMax)));
    setHrZonesBike(loadFromStorage(STORAGE_KEYS.hrZonesBike, defaultHrZones(profile?.fcMax)));
    setPowerZonesRun(loadFromStorage(STORAGE_KEYS.powerZones, defaultPowerZones(profile?.ftp)));
    setPowerZonesBike(loadFromStorage(STORAGE_KEYS.powerZonesBike, defaultPowerZones(profile?.ftp)));
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

  // Bascule automatiquement sur un onglet valide pour la discipline sélectionnée : Allure
  // n'existe que pour la Course, donc passer sur "Vélo" alors que "Allure" est actif
  // retombe sur "FC" plutôt que d'afficher un onglet qui n'a pas de sens pour le vélo.
  useEffect(() => {
    const tab = METRIC_TABS.find((t) => t.key === metricTab);
    if (!tab.disciplines.includes(discipline)) setMetricTab('hr');
  }, [discipline, metricTab]);

  const activeDiscipline = DISCIPLINES.find((d) => d.key === discipline);
  const visibleTabs = METRIC_TABS.filter((t) => t.disciplines.includes(discipline));
  const activeTab = METRIC_TABS.find((t) => t.key === metricTab) || visibleTabs[0];

  const committedZones =
    metricTab === 'hr' ? (discipline === 'bike' ? hrZonesBike : hrZonesRun)
      : metricTab === 'power' ? (discipline === 'bike' ? powerZonesBike : powerZonesRun)
        : paceZones;
  // Tant que l'athlète édite (draftZones non nul), l'affichage (graphe + champs) suit le
  // brouillon en temps réel — mais RIEN n'est persisté ni renvoyé au parent avant "Valider".
  const activeZones = draftZones || committedZones;

  // Réinitialise le brouillon sur les valeurs actives à chaque changement de discipline
  // ou d'onglet, et aussi quand les zones "committées" changent pour une cause EXTERNE à
  // ce composant (chargement localStorage au montage, arrivée async du profil — voir
  // l'effet ci-dessus) : dans tous les cas on repart d'un brouillon propre, jamais d'une
  // saisie abandonnée d'un onglet ou d'une discipline précédente.
  useEffect(() => {
    setDraftZones(committedZones);
    setValidationResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discipline, metricTab, hrZonesRun, hrZonesBike, powerZonesRun, powerZonesBike, paceZones]);

  // Efface automatiquement la popup de confirmation/erreur après quelques secondes,
  // sans bloquer une fermeture manuelle anticipée (bouton × plus bas).
  useEffect(() => {
    if (!validationResult) return undefined;
    const timer = setTimeout(() => setValidationResult(null), 5000);
    return () => clearTimeout(timer);
  }, [validationResult]);

  // La répartition se calcule désormais UNIQUEMENT sur les activités de la discipline
  // sélectionnée (RUN_SPORTS ou BIKE_SPORTS, jamais les deux mélangées) — voir le
  // commentaire d'en-tête pour le bug que ça corrige.
  const distribution = computeZoneDistributionFromActivities(activities, activeZones, {
    metric: metricTab,
    sports: metricTab === 'pace' ? RUN_SPORTS : activeDiscipline.sports,
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

    const setter =
      metricTab === 'hr' ? (discipline === 'bike' ? setHrZonesBike : setHrZonesRun)
        : metricTab === 'power' ? (discipline === 'bike' ? setPowerZonesBike : setPowerZonesRun)
          : setPaceZones;
    const storageKey =
      metricTab === 'hr' ? (discipline === 'bike' ? STORAGE_KEYS.hrZonesBike : STORAGE_KEYS.hrZones)
        : metricTab === 'power' ? (discipline === 'bike' ? STORAGE_KEYS.powerZonesBike : STORAGE_KEYS.powerZones)
          : STORAGE_KEYS.paceZones;

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
          : `Zones ${activeTab.label.toLowerCase()} (${activeDiscipline.label.toLowerCase()}) enregistrées.`,
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
      {/* Switch discipline — Course / Vélo : détermine QUELLES activités alimentent le
          graphe de répartition ET quel jeu de zones FC/Puissance est édité (voir
          commentaire d'en-tête). */}
      <div className="grid grid-cols-2 gap-1 bg-ink-900 border border-ink-800 rounded-xl p-1">
        {DISCIPLINES.map((d) => (
          <button
            key={d.key}
            onClick={() => setDiscipline(d.key)}
            className={`py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
              discipline === d.key ? 'bg-ink-50 text-ink-950' : 'text-ink-400'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div
        className="grid gap-1 bg-ink-900 border border-ink-800 rounded-xl p-1"
        style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}
      >
        {visibleTabs.map((tab) => (
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
          Pas assez d'activités {activeDiscipline.label.toLowerCase()} synchronisées pour calculer une répartition {activeTab.label.toLowerCase()}.
        </p>
      )}

      <div className="space-y-1.5">
        {activeZones.map((z) => (
          // BUG RÉEL CORRIGÉ : la clé doit inclure `discipline` ET `metricTab`. Les champs
          // ci-dessous sont non contrôlés (`defaultValue`, pas `value`) — React ne relit
          // `defaultValue` qu'au MONTAGE d'un nœud. Avec une clé partagée entre onglets/
          // disciplines (juste `z.zone`, identique pour Z1..Z5 partout), changer d'onglet
          // OU de discipline réutilisait le MÊME <input> DOM plutôt que d'en créer un
          // nouveau : le champ restait figé sur la valeur brute affichée précédemment au
          // lieu de la nouvelle valeur, même si l'état en mémoire était déjà correct.
          // Inclure `discipline` + `metricTab` force un vrai remount à chaque changement.
          <div key={`${discipline}-${metricTab}-${z.zone}`} className="flex items-center gap-2 text-[11px]">
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
        Valider les zones {activeTab.label.toLowerCase()}{metricTab !== 'pace' ? ` (${activeDiscipline.label.toLowerCase()})` : ''}
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
