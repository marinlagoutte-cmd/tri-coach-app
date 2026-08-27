// components/ZoneCharts.js
//
// Onglet Profil > "Zones d'entraînement" (rendu depuis PerformanceDashboard.js) :
// zones d'intensité FC / Puissance / Allure, initialisées (tant que l'athlète ne les
// a jamais validées lui-même) via lib/zones.js:resolveSeedZones — profil déclaré
// (FC max / FTP / VMA) > estimation depuis une vraie séance Strava > repli générique
// (voir defaultHrZones/defaultPowerZones/defaultPaceZones) — jamais directement le
// repli générique tant qu'une source plus fiable existe. Puis 100% éditables
// manuellement et persistées indépendamment (voir lib/storage.js).
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
import React, { useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import { STORAGE_KEYS, loadFromStorage, saveToStorage, hasStoredValue } from '../lib/storage';
import { useZonesMode } from '../lib/zonesMode';
import {
  BIKE_SPORTS,
  RUN_SPORTS,
  defaultHrZones,
  defaultPowerZones,
  defaultPaceZones,
  isPlausiblePaceZones,
  isPlausibleHrZones,
  isPlausiblePowerZones,
  computeZoneDistributionFromActivities,
  estimateZonesFromActivities,
  resolveSeedZones,
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

  // Réglages > "Zones d'entraînement" (voir lib/zonesMode.js) : en mode 'auto', les
  // bornes ci-dessous ne viennent plus des états manuels (hrZonesRun, paceZones...)
  // mais sont recalculées à la volée depuis les VRAIES séances Strava synchronisées
  // (voir lib/zones.js:estimateZonesFromActivities) — jamais éditées ni persistées
  // dans ce mode, pour ne jamais perdre les bornes manuelles déjà enregistrées si
  // l'athlète repasse un jour en 'manual'.
  const { zonesMode } = useZonesMode();
  const autoEstimate = useMemo(
    () => estimateZonesFromActivities(activities, discipline),
    [activities, discipline]
  );
  // Estimation Allure course dédiée, INDÉPENDANTE du switch Course/Vélo ci-dessus : les
  // séances déjà générées doivent être recalculées avec la vraie VMA auto-détectée dès
  // que le mode 'auto' est actif, même si l'athlète regarde actuellement l'onglet "Vélo"
  // (voir l'effet plus bas qui appelle onPaceZonesChange).
  const autoRunEstimate = useMemo(() => estimateZonesFromActivities(activities, 'run'), [activities]);
  // Pendant de autoRunEstimate ci-dessus, pour le vélo : sert de germe initial pour
  // hrZonesBike/powerZonesBike (voir resolveSeedZones plus bas) — indépendant du switch
  // Course/Vélo affiché, comme autoRunEstimate l'est déjà pour l'Allure.
  const autoBikeEstimate = useMemo(() => estimateZonesFromActivities(activities, 'bike'), [activities]);

  // Deux jeux de zones indépendants pour FC et pour Puissance (course / vélo) — voir
  // le commentaire d'en-tête. Valeurs initiales calculées via resolveSeedZones (lib/zones.js) :
  // profil déclaré > estimation Strava réelle > repli générique — jamais un chiffre
  // hasardeux (voir l'effet plus bas pour le vrai calcul, une fois profil/activités
  // disponibles ; ces valeurs par défaut ne servent qu'au tout premier rendu, avant que
  // cet effet n'ait eu la chance de tourner).
  const [hrZonesRun, setHrZonesRun] = useState(() => resolveSeedZones(profile?.fcMax, defaultHrZones, null).zones);
  const [hrZonesBike, setHrZonesBike] = useState(() => resolveSeedZones(profile?.fcMax, defaultHrZones, null).zones);
  const [powerZonesRun, setPowerZonesRun] = useState(() => resolveSeedZones(profile?.ftp, defaultPowerZones, null).zones);
  const [powerZonesBike, setPowerZonesBike] = useState(() => resolveSeedZones(profile?.ftp, defaultPowerZones, null).zones);
  const [paceZones, setPaceZones] = useState(() => resolveSeedZones(profile?.vma, defaultPaceZones, null).zones);
  // D'où vient la valeur ACTUELLEMENT affichée pour chaque jeu de zones tant que
  // l'athlète ne l'a pas lui-même validée ('profile' | 'strava' | 'generic'), ou
  // 'manual' dès qu'il l'a validée au moins une fois (voir handleValidate) — permet
  // à l'UI de préciser la source plutôt que de laisser croire à une vraie mesure
  // quand ce n'est qu'un repli générique, ou de ne rien dire quand c'est le cas.
  const [seedSource, setSeedSource] = useState({
    hrRun: 'generic', hrBike: 'generic', powerRun: 'generic', powerBike: 'generic', pace: 'generic',
  });

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

  // Charge les bornes déjà personnalisées (si l'athlète les a éditées avant) — sinon
  // calcule un germe via resolveSeedZones (profil déclaré > estimation Strava réelle >
  // repli générique, voir lib/zones.js) plutôt que de retomber directement sur le repli
  // générique comme avant cette révision.
  // BUG RÉEL CORRIGÉ (v1) : cet effet ne dépendait auparavant que de `[]` (exécuté une
  // seule fois au montage). Or `profile` est chargé de façon ASYNCHRONE depuis le
  // localStorage par le composant parent (voir pages/index.js, useEffect "CHARGEMENT
  // INITIAL") : si l'onglet Profil était déjà affiché au chargement de la page,
  // ZoneCharts se montait AVANT la fin de cette hydratation — les zones par défaut
  // restaient alors figées indéfiniment. Dépendre des vraies valeurs du profil corrige
  // ce premier problème.
  // BUG RÉEL CORRIGÉ (v2, cette révision) : `activities` souffre du MÊME problème
  // d'hydratation asynchrone que `profile` (chargées/synchronisées après le montage),
  // mais n'était dans les dépendances d'AUCUN effet ici — tant que fcMax/ftp/vma
  // restaient vides (cas de la grande majorité des athlètes, qui ne les saisissent
  // jamais à la main), les bornes affichées restaient sur le repli générique fixe
  // (190 bpm / 200 W / 14 km/h) même une fois des dizaines de séances Strava
  // synchronisées permettant de calculer une vraie estimation (voir
  // estimateZonesFromActivities) — d'où l'impression de "valeurs toujours fixes"
  // dans l'onglet Profil. `autoRunEstimate`/`autoBikeEstimate` (memoïsés sur
  // `activities`) sont donc ajoutés aux dépendances ci-dessous.
  useEffect(() => {
    // GARDE-FOU (BUG RÉEL — voir isPlausibleHrZones/isPlausiblePowerZones, lib/zones.js) :
    // une valeur déjà en localStorage n'est retenue comme "validée par l'athlète" que si
    // elle passe le test de vraisemblance de sa métrique — sinon on la traite comme si
    // rien n'était encore enregistré (même repli à 3 niveaux que pour une clé vide :
    // profil > estimation Strava > générique) plutôt que de réafficher indéfiniment une
    // FC à 382 bpm ou une puissance en BPM par erreur.
    const storedHrRun = hasStoredValue(STORAGE_KEYS.hrZones) ? loadFromStorage(STORAGE_KEYS.hrZones, null) : null;
    const hrRunSeed = storedHrRun && isPlausibleHrZones(storedHrRun)
      ? { zones: storedHrRun, source: 'manual' }
      : resolveSeedZones(profile?.fcMax, defaultHrZones, autoRunEstimate.hrZones);
    setHrZonesRun(hrRunSeed.zones);
    if (storedHrRun && !isPlausibleHrZones(storedHrRun)) saveToStorage(STORAGE_KEYS.hrZones, hrRunSeed.zones);

    const storedHrBike = hasStoredValue(STORAGE_KEYS.hrZonesBike) ? loadFromStorage(STORAGE_KEYS.hrZonesBike, null) : null;
    const hrBikeSeed = storedHrBike && isPlausibleHrZones(storedHrBike)
      ? { zones: storedHrBike, source: 'manual' }
      : resolveSeedZones(profile?.fcMax, defaultHrZones, autoBikeEstimate.hrZones);
    setHrZonesBike(hrBikeSeed.zones);
    if (storedHrBike && !isPlausibleHrZones(storedHrBike)) saveToStorage(STORAGE_KEYS.hrZonesBike, hrBikeSeed.zones);

    const storedPowerRun = hasStoredValue(STORAGE_KEYS.powerZones) ? loadFromStorage(STORAGE_KEYS.powerZones, null) : null;
    const powerRunSeed = storedPowerRun && isPlausiblePowerZones(storedPowerRun)
      ? { zones: storedPowerRun, source: 'manual' }
      : resolveSeedZones(profile?.ftp, defaultPowerZones, autoRunEstimate.powerZones);
    setPowerZonesRun(powerRunSeed.zones);
    if (storedPowerRun && !isPlausiblePowerZones(storedPowerRun)) saveToStorage(STORAGE_KEYS.powerZones, powerRunSeed.zones);

    const storedPowerBike = hasStoredValue(STORAGE_KEYS.powerZonesBike) ? loadFromStorage(STORAGE_KEYS.powerZonesBike, null) : null;
    const powerBikeSeed = storedPowerBike && isPlausiblePowerZones(storedPowerBike)
      ? { zones: storedPowerBike, source: 'manual' }
      : resolveSeedZones(profile?.ftp, defaultPowerZones, autoBikeEstimate.powerZones);
    setPowerZonesBike(powerBikeSeed.zones);
    if (storedPowerBike && !isPlausiblePowerZones(storedPowerBike)) saveToStorage(STORAGE_KEYS.powerZonesBike, powerBikeSeed.zones);

    // GARDE-FOU (BUG RÉEL CORRIGÉ) : sur un appareil qui a connu l'ancien bug d'unités
    // (zones "Allure" initialisées avec la formule des zones FC au lieu de la VMA), la
    // valeur déjà en localStorage n'est PAS une vitesse plausible (ex: 117, 140, 160,
    // 174 — des bpm, pas des km/h) — voir lib/zones.js:isPlausiblePaceZones. On ignore
    // alors cette valeur corrompue et on ré-initialise + ré-persiste immédiatement le
    // germe (profil > Strava > générique), au lieu de la réafficher telle quelle
    // indéfiniment ou de retomber directement sur le générique.
    const storedPaceZones = loadFromStorage(STORAGE_KEYS.paceZones, null);
    let paceSeed;
    if (storedPaceZones && isPlausiblePaceZones(storedPaceZones)) {
      paceSeed = { zones: storedPaceZones, source: 'manual' };
    } else {
      paceSeed = resolveSeedZones(profile?.vma, defaultPaceZones, autoRunEstimate.paceZones);
      saveToStorage(STORAGE_KEYS.paceZones, paceSeed.zones);
    }
    setPaceZones(paceSeed.zones);

    setSeedSource({
      hrRun: hrRunSeed.source,
      hrBike: hrBikeSeed.source,
      powerRun: powerRunSeed.source,
      powerBike: powerBikeSeed.source,
      pace: paceSeed.source,
    });
  }, [profile?.fcMax, profile?.ftp, profile?.vma, autoRunEstimate, autoBikeEstimate]);

  // Bascule automatiquement sur un onglet valide pour la discipline sélectionnée : Allure
  // n'existe que pour la Course, donc passer sur "Vélo" alors que "Allure" est actif
  // retombe sur "FC" plutôt que d'afficher un onglet qui n'a pas de sens pour le vélo.
  useEffect(() => {
    const tab = METRIC_TABS.find((t) => t.key === metricTab);
    if (!tab.disciplines.includes(discipline)) setMetricTab('hr');
  }, [discipline, metricTab]);

  // Mode 'auto' : pousse la VMA auto-détectée au parent dès qu'elle est disponible, comme
  // le fait "Valider" en mode manuel (voir handleValidate) — sans attendre une action de
  // l'athlète, puisqu'il n'y a justement rien à valider dans ce mode.
  useEffect(() => {
    if (zonesMode !== 'auto' || !autoRunEstimate.paceZones || !onPaceZonesChange) return;
    onPaceZonesChange(autoRunEstimate.paceZones);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zonesMode, autoRunEstimate.paceZones]);

  const activeDiscipline = DISCIPLINES.find((d) => d.key === discipline);
  const visibleTabs = METRIC_TABS.filter((t) => t.disciplines.includes(discipline));
  const activeTab = METRIC_TABS.find((t) => t.key === metricTab) || visibleTabs[0];

  const manualZones =
    metricTab === 'hr' ? (discipline === 'bike' ? hrZonesBike : hrZonesRun)
      : metricTab === 'power' ? (discipline === 'bike' ? powerZonesBike : powerZonesRun)
        : paceZones;

  // Zones auto pour l'onglet/discipline actifs — `null` tant qu'aucune séance
  // qualifiante n'a été trouvée (voir estimateZonesFromActivities), auquel cas on
  // retombe sur le calcul théorique depuis le profil (FC max/FTP/VMA déclarés) plutôt
  // que de laisser l'onglet vide — clairement annoté comme tel dans `autoIsFallback`
  // pour que l'affichage prévienne l'athlète que ce n'est pas encore une vraie mesure.
  const autoZonesForTab =
    metricTab === 'hr' ? autoEstimate.hrZones
      : metricTab === 'power' ? autoEstimate.powerZones
        : autoEstimate.paceZones;
  const autoFallbackZones =
    metricTab === 'hr' ? defaultHrZones(profile?.fcMax)
      : metricTab === 'power' ? defaultPowerZones(profile?.ftp)
        : defaultPaceZones(profile?.vma);
  const autoIsFallback = zonesMode === 'auto' && !autoZonesForTab;

  const committedZones = zonesMode === 'auto' ? (autoZonesForTab || autoFallbackZones) : manualZones;
  // Tant que l'athlète édite (draftZones non nul), l'affichage (graphe + champs) suit le
  // brouillon en temps réel — mais RIEN n'est persisté ni renvoyé au parent avant "Valider".
  // En mode 'auto', il n'y a jamais de brouillon : les champs ne sont pas éditables.
  const activeZones = zonesMode === 'auto' ? committedZones : (draftZones || committedZones);

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
    // Dès que l'athlète valide lui-même une valeur, elle prime pour de bon : la source
    // affichée passe à 'manual' (plus de bannière "estimé Strava"/"générique" pour ce
    // jeu de zones, même si profil/Strava changent ensuite — cohérent avec le reste du
    // composant, qui priorise déjà toujours le localStorage une fois validé).
    setSeedSource((prev) => ({
      ...prev,
      [metricTab === 'hr' ? (discipline === 'bike' ? 'hrBike' : 'hrRun')
        : metricTab === 'power' ? (discipline === 'bike' ? 'powerBike' : 'powerRun')
          : 'pace']: 'manual',
    }));
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

  // Texte explicatif du mode 'auto' pour l'onglet/métrique actuellement affichés — voir
  // estimateZonesFromActivities pour le détail du protocole ("test de 20 minutes").
  const autoMeta =
    metricTab === 'hr' ? autoEstimate.meta.hrEst
      : metricTab === 'power' ? autoEstimate.meta.powerEst
        : autoEstimate.meta.vmaEst;
  // Garde-fou (BUG RÉEL CORRIGÉ) : `best.start_date` peut être absent/invalide sur une
  // activité importée par un chemin plus ancien (ex: webhook reçu avant l'ajout de la
  // colonne, ou ligne corrigée manuellement) — `new Date(undefined)` produit une date
  // invalide, et Intl.DateTimeFormat().format() plante alors avec "date value is not
  // finite" plutôt que d'afficher un texte dégradé. On vérifie la date AVANT de la
  // formater, et on retombe sur un texte sans date plutôt que de faire planter tout
  // l'onglet Profil (cette explication n'est de toute façon qu'un texte informatif,
  // jamais indispensable à l'affichage des zones elles-mêmes).
  const formatAutoDate = (iso) => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime())
      ? new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(d)
      : null;
  };
  // Uniquement calculé quand utile (mode 'auto' — seul cas où ce texte est affiché, voir
  // plus bas) : évite tout calcul/risque inutile quand l'athlète est en mode 'manual'
  // (le réglage par défaut), qui reste de loin le cas le plus fréquent.
  const autoExplanation = zonesMode !== 'auto' ? '' : (autoIsFallback || !autoMeta
    ? `Pas encore assez de séances ${activeDiscipline.label.toLowerCase()} avec un effort continu de 18 à 70 minutes pour calculer les zones ${activeTab.label.toLowerCase()} automatiquement — zones ci-dessous basées sur ton profil (${
        metricTab === 'hr' ? 'FC max' : metricTab === 'power' ? 'FTP' : 'VMA'
      } déclarée) en attendant. Synchronise davantage de séances pour affiner.`
    : (() => {
        const dateLabel = formatAutoDate(autoMeta.date);
        const dateSuffix = dateLabel ? `, le ${dateLabel}` : '';
        return metricTab === 'pace'
          ? `VMA estimée à ${autoMeta.value} km/h d'après ta meilleure sortie course (${autoMeta.distanceKm} km en ${autoMeta.durationMin} min${dateSuffix}).`
          : `${metricTab === 'hr' ? 'FC de seuil' : 'FTP'} estimée à ${autoMeta.value} ${activeTab.unit} (95% de ta meilleure moyenne sur un effort continu) d'après ta meilleure sortie ${activeDiscipline.label.toLowerCase()} (${autoMeta.durationMin} min, ${
              metricTab === 'hr' ? `${autoMeta.averageHr} bpm` : `${autoMeta.averageWatts} W`
            } de moyenne${dateSuffix}).`;
      })());

  // Pendant de autoExplanation ci-dessus, pour le mode 'manual' : précise à l'athlète
  // que la valeur actuellement affichée n'est pas (encore) la sienne mais un germe
  // calculé (Strava réel ou générique, voir resolveSeedZones) — tant qu'il n'a jamais
  // cliqué "Valider" pour ce jeu de zones précis (source 'manual' une fois validé,
  // voir handleValidate). Rien à afficher pour source 'profile' : la valeur vient
  // alors directement d'un seuil que l'athlète a lui-même déclaré, pas d'un calcul.
  const currentSeedKey =
    metricTab === 'hr' ? (discipline === 'bike' ? 'hrBike' : 'hrRun')
      : metricTab === 'power' ? (discipline === 'bike' ? 'powerBike' : 'powerRun')
        : 'pace';
  const currentSeedSource = seedSource[currentSeedKey];
  const manualSeedExplanation =
    zonesMode === 'auto' || currentSeedSource === 'profile' || currentSeedSource === 'manual'
      ? ''
      : currentSeedSource === 'strava'
        ? `🤖 Valeurs de départ calculées depuis ta meilleure séance ${activeDiscipline.label.toLowerCase()} Strava (protocole test ~20 min) — modifie-les si besoin, "Valider" enregistre ta propre valeur.`
        : `⚠️ Valeurs de départ génériques (pas encore de ${
            metricTab === 'hr' ? 'FC max' : metricTab === 'power' ? 'FTP' : 'VMA'
          } déclarée ni de séance ${activeDiscipline.label.toLowerCase()} exploitable) — à ajuster, ou renseigne ton profil / synchronise des séances pour un calcul plus précis.`;

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

      {zonesMode === 'auto' && (
        <div
          className={`p-2.5 rounded-xl border text-[10px] leading-relaxed ${
            autoIsFallback
              ? 'border-amber-800/60 bg-amber-950/30 text-amber-300'
              : 'border-volt-500/30 bg-volt-500/10 text-volt-300'
          }`}
        >
          {autoIsFallback ? '⚠️ ' : '🤖 '}
          {autoExplanation}
        </div>
      )}

      {zonesMode === 'manual' && manualSeedExplanation && (
        <div
          className={`p-2.5 rounded-xl border text-[10px] leading-relaxed ${
            currentSeedSource === 'generic'
              ? 'border-amber-800/60 bg-amber-950/30 text-amber-300'
              : 'border-volt-500/30 bg-volt-500/10 text-volt-300'
          }`}
        >
          {manualSeedExplanation}
        </div>
      )}

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
        {activeZones.map((z, i) => {
          // Chaque zone n'a qu'UNE seule vraie donnée (`min`, voir lib/zones.js) — la
          // "borne haute" affichée ci-dessous n'est jamais une seconde valeur stockée
          // séparément (ça pourrait diverger du `min` de la zone suivante et rendre les
          // zones incohérentes), mais un simple reflet EN LECTURE de la borne basse de
          // la zone suivante : Z2 s'arrête exactement là où Z3 commence. Éditer la borne
          // basse de Z3 (dans SA propre ligne, juste en dessous) met donc aussi à jour en
          // direct la borne haute affichée ici pour Z2, puisque c'est littéralement la
          // même valeur lue à deux endroits. Dernière zone (Z5, pas de zone au-dessus) :
          // pas de borne haute, affichée "∞" (illimité vers le haut).
          const nextZone = activeZones[i + 1];
          const formatVal = (v) => (metricTab === 'pace' ? speedToPaceLabel(v) : v);
          return (
            // BUG RÉEL CORRIGÉ : la clé doit inclure `discipline` ET `metricTab`. Les champs
            // ci-dessous sont non contrôlés (`defaultValue`, pas `value`) — React ne relit
            // `defaultValue` qu'au MONTAGE d'un nœud. Avec une clé partagée entre onglets/
            // disciplines (juste `z.zone`, identique pour Z1..Z5 partout), changer d'onglet
            // OU de discipline réutilisait le MÊME <input> DOM plutôt que d'en créer un
            // nouveau : le champ restait figé sur la valeur brute affichée précédemment au
            // lieu de la nouvelle valeur, même si l'état en mémoire était déjà correct.
            // Inclure `discipline` + `metricTab` force un vrai remount à chaque changement.
            <div
              key={`${discipline}-${metricTab}-${z.zone}-${zonesMode === 'auto' ? z.min : 'manual'}`}
              className="flex items-center gap-1.5 text-[11px]"
            >
              <span className="w-6 font-bold shrink-0" style={{ color: z.color }}>{z.zone}</span>
              <span className="flex-1 text-ink-400 truncate">{z.label}</span>
              <input
                type={metricTab === 'pace' ? 'text' : 'number'}
                readOnly={zonesMode === 'auto'}
                defaultValue={formatVal(z.min)}
                onBlur={(e) => (zonesMode === 'auto' ? undefined : updateDraftMin(z.zone, e.target.value))}
                aria-label={`${z.zone} borne basse`}
                className={`w-14 text-right bg-ink-900 border border-ink-800 rounded-lg px-1.5 py-1 font-mono text-[11px] ${
                  zonesMode === 'auto' ? 'text-ink-400 cursor-default' : 'text-ink-100'
                }`}
              />
              <span className="text-ink-600 shrink-0">–</span>
              {nextZone ? (
                <input
                  type="text"
                  readOnly
                  disabled
                  value={formatVal(nextZone.min)}
                  aria-label={`${z.zone} borne haute (= borne basse de ${nextZone.zone})`}
                  className="w-14 text-right bg-ink-900/60 border border-ink-800 rounded-lg px-1.5 py-1 font-mono text-[11px] text-ink-500 cursor-default"
                />
              ) : (
                <span className="w-14 text-right text-ink-600 font-mono text-[11px]" aria-label={`${z.zone} borne haute : illimité`}>
                  ∞
                </span>
              )}
              <span className="w-9 text-ink-500 text-[10px] shrink-0">{metricTab === 'pace' ? '/km' : activeTab.unit}</span>
            </div>
          );
        })}
      </div>
      {zonesMode === 'manual' && (
        <p className="text-[9px] text-ink-600 text-center leading-relaxed -mt-1">
          La borne haute (grisée) reflète la borne basse de la zone suivante — modifie la borne basse de cette zone-là pour la déplacer.
        </p>
      )}

      {zonesMode === 'auto' ? (
        <p className="text-[9px] text-ink-600 text-center leading-relaxed">
          Bornes calculées automatiquement, non modifiables ici — passe en "Manuel" dans Réglages &gt; Zones d'entraînement pour les éditer toi-même.
        </p>
      ) : (
        <button
          onClick={handleValidate}
          className="w-full text-[11px] font-bold py-2 rounded-lg bg-volt-500 text-white hover:bg-volt-600 transition-colors"
        >
          Valider les zones {activeTab.label.toLowerCase()}{metricTab !== 'pace' ? ` (${activeDiscipline.label.toLowerCase()})` : ''}
        </button>
      )}

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
