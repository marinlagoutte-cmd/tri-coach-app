import { useState, useEffect, useRef, useMemo } from 'react';
import CalendarView from '../components/CalendarView';
import ChatMessage from '../components/ChatMessage';
import WorkoutDetail from '../components/WorkoutDetail';
import WizardModal from '../components/WizardModal';
import ProfileHealth from '../components/ProfileHealth';
import InjuryJournal from '../components/InjuryJournal';
import CycleTracker from '../components/CycleTracker';
import TirePressureCalculator from '../components/TirePressureCalculator';
import EquipmentTracker from '../components/EquipmentTracker';
import PerformanceDashboard from '../components/PerformanceDashboard';
import PerformanceRecords from '../components/PerformanceRecords';
import NutritionPanel from '../components/NutritionPanel';
import WeatherPanel from '../components/WeatherPanel';
import ActivityDetail from '../components/ActivityDetail';
import TrainingLoadChart from '../components/TrainingLoadChart';
import WeeklyProgressChart from '../components/WeeklyProgressChart';
import RaceExecutionPlan from '../components/RaceExecutionPlan';
import RaceTimePredictor from '../components/RaceTimePredictor';
import RaceCalendar from '../components/RaceCalendar';
import RoutePlanner from '../components/RoutePlanner';
import PlanPreferencesFields from '../components/PlanPreferencesFields';
import TransitionTrainer from '../components/TransitionTrainer';
import TodayView from '../components/TodayView';
import GuidedTour from '../components/help/GuidedTour';
import HelpCenter from '../components/help/HelpCenter';
import TabTip from '../components/help/TabTip';
import InfoTip from '../components/help/InfoTip';
import { TAB_TIPS } from '../lib/helpContent';
import { summarizeRecentTraining, findPastUnconfirmedSessions, describeMissedForAI } from '../lib/recentTraining';
import { getSeasonOutlook } from '../lib/seasonPlan';
import { isHardSession, parseDurationMinutes as parseDurMin } from '../lib/workouts';
import { buildLoadCycle, weekLoadInfo, rolloverWorkouts, LOAD_PATTERNS } from '../lib/trainingCycle';
import { STORAGE_KEYS, loadFromStorage, saveToStorage, setStorageSaveHook } from '../lib/storage';
import { DEFAULT_PROFILE, DEFAULT_TRAINING_PLAN, DEFAULT_WORKOUTS, EMPTY_TRAINING_PLAN, EMPTY_WORKOUTS, DAYS_OF_WEEK } from '../lib/defaults';
import { computeRaceStats, shortLabel, sanitizeWorkout, forceRecalcWeekPaces, forceRecalcWorkoutPaces } from '../lib/workouts';
import { analyzeFeedback, summarizeFeedbackTrend } from '../lib/feedback';
import { computeCurrentPhase } from '../lib/cycleTracking';
import { getWeekLabel } from '../lib/periodization';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { setCloudUser, fetchAndMergeCloudData, queueCloudPush, pushCloudDataNow, flushCloudPushOnHide } from '../lib/cloudSync';
import AuthScreen from '../components/AuthScreen';
import ProfileAvatar from '../components/ProfileAvatar';
import BottomNav from '../components/ui/BottomNav';
import QuickActions from '../components/ui/QuickActions';
import UnderlineTabs from '../components/ui/UnderlineTabs';
import { CircleHelp, Heart, TrendingUp, Trophy, Leaf, Flame, RefreshCw, Flag, CirclePlus, Pencil, MessageSquareText, SendHorizontal } from 'lucide-react';
import Stat from '../components/ui/Stat';
import { SportDot } from '../components/ui/sport';
import ProfileIdentityCard from '../components/ProfileIdentityCard';
import NotificationBell from '../components/NotificationBell';
import SettingsModal from '../components/SettingsModal';
import { useI18n, translateDayName, intlLocale } from '../lib/i18n';
import { aiFetch } from '../lib/aiFetch';

// Labels traduits via t('tabs.<id>') au rendu — id/icon restent fixes (id utilisé
// pour la logique d'onglet actif, jamais affiché tel quel).
// ATTENTION : Nutrition et Météo ne sont plus des onglets principaux (voir plus bas, fusionnés
// en sous-onglets de "tools") — 5 onglets principaux au lieu de 6.
// Barre du bas (components/ui/BottomNav.js) : les Outils ne sont plus un onglet, ils
// s'ouvrent depuis le bouton central d'actions rapides (components/ui/QuickActions.js).
const TABS = [
  { id: 'today', icon: '🏠' },
  { id: 'calendar', icon: '📅' },
  { id: 'objective', icon: '🎯' },
  // Le Profil n'est plus dans la barre du bas : on l'ouvre en touchant sa photo en haut à
  // droite (demande de l'athlète).
  { id: 'chat', icon: '💬' },
];

// Sous-onglets de l'onglet Outils (nutrition/météo/pression pneus) — état séparé
// de `activeTab`, simple navigation locale à cet onglet. "records" a été déplacé dans
// l'onglet Profil (voir PROFILE_SUB_TABS plus bas) : c'est une donnée de suivi de
// l'athlète dans le temps, pas un outil ponctuel comme la météo ou la pression des pneus.
const TOOLS_SUB_TABS = ['nutrition', 'transitions', 'weather', 'route', 'tirePressure', 'equipment'];

// Sous-onglets de l'onglet Profil — Santé (mesures + historique), Progression (charge
// d'entraînement/volume) et Records (courbe de puissance + PR Strava, ex-sous-onglet
// d'Outils). Même principe que TOOLS_SUB_TABS ci-dessus : navigation locale, séparée de
// `activeTab`. Regroupés en 3 onglets plutôt qu'un long scroll unique, pour que chaque
// catégorie de données reste lisible sans avoir à tout faire défiler.
const PROFILE_SUB_TABS = [
  { id: 'health', label: 'Santé', Icon: Heart },
  { id: 'progress', label: 'Progression', Icon: TrendingUp },
  { id: 'records', label: 'Records', Icon: Trophy },
];

// Un objectif CAP/Trail n'affiche jamais les filtres BIKE/SWIM — cohérence avec l'objectif choisi.
// Et si une seule discipline est possible, le bouton "TOUT" est redondant (il affiche
// exactement la même chose que le filtre unique) donc on ne l'ajoute pas.
function getSportFilters(sportType) {
  // Libellés en français, en casse normale (ils étaient en anglais et en capitales).
  if (sportType === 'running') {
    return [{ id: 'RUN', label: 'Course' }];
  }
  if (sportType === 'duathlon') {
    return [{ id: 'ALL', label: 'Tout' }, { id: 'BIKE', label: 'Vélo' }, { id: 'RUN', label: 'Course' }];
  }
  return [
    { id: 'ALL', label: 'Tout' },
    { id: 'SWIM', label: 'Natation' },
    { id: 'BIKE', label: 'Vélo' },
    { id: 'RUN', label: 'Course' },
  ];
}

const CHAT_INTENTS = ['add', 'modify'];

// Suggestions de messages toujours ancrées dans le contexte réel (dernière réponse du
// coach + prochaine séance non validée) plutôt qu'une liste fixe et générique — un texte
// du type "Alléger la prochaine séance" est utile UNE fois, plat ensuite. On regénère donc
// ces chips à chaque nouveau message du coach (voir smartSuggestions plus bas).
function getSmartSuggestions({ lastCoachText, nextWorkout, lang, t }) {
  const suggestions = [];

  if (nextWorkout) {
    const dayLabel = translateDayName(nextWorkout.day, lang);
    suggestions.push({
      label: `${t('chat.suggestLighten')} ${dayLabel}`,
      text: `Peux-tu alléger ma séance de ${dayLabel} (${nextWorkout.title}) ?`,
      intent: 'modify',
    });
    suggestions.push({
      label: `${t('chat.suggestMove')} ${dayLabel}`,
      text: `Peux-tu décaler ma séance de ${dayLabel} (${nextWorkout.title}) à un autre jour ?`,
      intent: 'modify',
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      label: t('chat.suggestProgress'),
      text: 'Comment évolue mon plan par rapport à mon objectif ?',
      intent: null,
    });
  }

  return suggestions.slice(0, 3);
}

function formatWorkoutSummary(w, lang) {
  return `${translateDayName(w.day, lang)} · ${shortLabel(w.type)} — ${w.title} (${w.duration}, ${w.intensity || '-'})`;
}

// La date de l'objectif est stockée au format ISO (YYYY-MM-DD, voir lib/defaults.js /
// lib/gemini.js) pour que le compte à rebours (computeRaceStats) puisse la parser de
// façon fiable — on la reformate ici uniquement pour l'affichage, dans la langue choisie.
function formatRaceDate(isoDate, lang) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate; // fallback : affiche la valeur brute plutôt que rien
  return new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

const EXPERIENCE_LABEL = { debutant: 'Débutant', novice: 'Novice', intermediaire: 'Intermédiaire', confirme: 'Confirmé', expert: 'Expert' };
const fmtDateFr = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
const fmtCapMin = (m) => (!m ? 'sans limite' : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`);

function describeEvent(c) {
  if (!c) return '—';
  const d = c.customDistances || {};
  if (c.sportType === 'triathlon') return `Triathlon ${c.triathlonFormat || ''} (${d.swim ?? '?'} / ${d.bike ?? '?'} / ${d.run ?? '?'} km)`;
  if (c.sportType === 'duathlon') return `Duathlon ${c.triathlonFormat || ''} (${d.run ?? '?'} / ${d.bike ?? '?'} / ${d.run2 ?? '?'} km)`;
  if (c.runningSubtype === 'trail') return `Trail ${c.trailKm || '?'} km${c.trailElevation ? ` · ${c.trailElevation} m D+` : ''}`;
  return `Course à pied ${c.distance || ''}`.trim();
}

// Synthèse des réponses au questionnaire (onglet Objectif) — lecture seule.
function QuestionnaireSummary({ constraints: c, profile, onEdit }) {
  if (!c) return null;
  const tri = c.triathlonTimes || {};
  const targetTime = c.sportType === 'triathlon' ? tri.total : c.targetTime;
  const metrics = [
    ['VMA', profile?.vma ? `${profile.vma} km/h` : null],
    ...(c.sportType !== 'running' ? [['FTP', profile?.ftp ? `${profile.ftp} W` : null]] : []),
    ...(c.sportType === 'triathlon' ? [['CSS', profile?.nat100 ? `${profile.nat100} /100 m` : null]] : []),
    ['FC max', profile?.fcMax ? `${profile.fcMax}` : null],
    ['FC repos', profile?.fcRepos ? `${profile.fcRepos}` : null],
  ];
  const rows = [
    ['Objectif', `${c.eventName ? `${c.eventName} — ` : ''}${fmtDateFr(c.targetDate)}`],
    ['Épreuve', describeEvent(c)],
    ...(targetTime ? [['Temps visé', targetTime]] : []),
    ['Niveau', `Forme ${c.fitnessLevel || '?'}/5 · ${EXPERIENCE_LABEL[c.trainingExperience] || '—'}${c.hasExistingTrainingBase ? ' · déjà entraîné' : ''}`],
    ['Volume', `${c.hoursPerWeek || '?'} h/semaine · ${c.maxSessionsPerWeek || '?'} séances${c.ppgEnabled === false ? '' : ' · PPG'}`],
    ['Repos', c.offDays ? String(c.offDays).split(',').join(', ') : 'aucun jour imposé'],
    ['Disponibilité', `semaine ${fmtCapMin(c.dayCaps?.weekday)} · week-end ${fmtCapMin(c.dayCaps?.weekend)}`],
  ];
  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink-100">Mon questionnaire</span>
        <button type="button" onClick={onEdit} className="min-h-[34px] px-2.5 rounded-lg border border-ink-800 text-xs font-bold text-ink-300">Refaire</button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-500">{k}</dt>
            <dd className="text-ink-100 font-medium">{v}</dd>
          </div>
        ))}
        <dt className="text-ink-500">Mesures</dt>
        <dd className="text-ink-100 font-medium">
          {metrics.map(([k, v]) => `${k} ${v || '—'}`).join(' · ')}
        </dd>
      </dl>
      <p className="text-[11px] text-ink-500 leading-snug">Mesures issues du Profil (modifiables là-bas). « Refaire » relance le questionnaire complet et génère un nouveau plan.</p>
    </div>
  );
}

// Carte "Réglages du plan" (onglet Objectif). CORRECTIF d'ergonomie : l'enregistrement
// fonctionnait, mais rien ne changeait à l'écran (les réglages ne s'appliquent qu'aux
// semaines générées ensuite) → impression que le bouton n'avait aucun effet. Après
// enregistrement : résumé de ce qui a changé + bouton pour régénérer tout de suite la
// semaine suivante avec les nouveaux réglages.
function PlanSettingsCard({ constraints, onSave, onApplyNextWeek, applying, applyError, nextWeekLabel }) {
  const initial = () => {
    const pattern = constraints?.loadCycle?.pattern || 'none';
    const info = pattern !== 'none' ? weekLoadInfo(constraints.loadCycle, localISODate()) : null;
    return {
      loadCyclePattern: pattern, loadCycleWeek: info?.index || 1, focusAreas: constraints?.focusAreas || [], coachNotes: constraints?.coachNotes || '',
      dayCaps: constraints?.dayCaps || null, offDays: constraints?.offDays || '',
      hasExistingTrainingBase: Boolean(constraints?.hasExistingTrainingBase),
    };
  };
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [savedChanges, setSavedChanges] = useState(null); // null = pas encore enregistré
  const [applied, setApplied] = useState(false);

  const describeChanges = (before, after) => {
    const out = [];
    if ((before.offDays || '') !== (after.offDays || '')) out.push(`Jours de repos : ${after.offDays ? after.offDays.split(',').join(', ') : 'aucun'}`);
    if (JSON.stringify(before.dayCaps || {}) !== JSON.stringify(after.dayCaps || {})) out.push(`Disponibilité : semaine ${fmtCapMin(after.dayCaps?.weekday)}, week-end ${fmtCapMin(after.dayCaps?.weekend)}`);
    if (before.loadCyclePattern !== after.loadCyclePattern || before.loadCycleWeek !== after.loadCycleWeek) out.push(`Cycle de charge : ${LOAD_PATTERNS[after.loadCyclePattern]?.label || after.loadCyclePattern}`);
    if (JSON.stringify(before.focusAreas) !== JSON.stringify(after.focusAreas)) out.push(`Priorités : ${after.focusAreas.length} choisie(s)`);
    if ((before.coachNotes || '') !== (after.coachNotes || '')) out.push('Infos pour le coach modifiées');
    if (Boolean(before.hasExistingTrainingBase) !== Boolean(after.hasExistingTrainingBase)) out.push(after.hasExistingTrainingBase ? 'Déjà entraîné : pas de reprise progressive' : 'Reprise progressive du volume activée');
    return out;
  };
  const dirty = describeChanges(baseline, draft).length > 0;

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3.5 space-y-3.5">
      <div>
        <span className="text-[13px] font-semibold text-ink-100 block">Réglages du plan</span>
        <p className="text-xs text-ink-400 mt-1 leading-snug">Pris en compte immédiatement par le coach (chat) et par chaque semaine générée ensuite.</p>
      </div>
      <PlanPreferencesFields showOffDays value={draft} onChange={(next) => { setDraft(next); setSavedChanges(null); setApplied(false); }} />
      <button
        type="button"
        disabled={!dirty}
        onClick={() => { setSavedChanges(describeChanges(baseline, draft)); onSave(draft); setBaseline(draft); setApplied(false); }}
        className="w-full min-h-[46px] rounded-xl bg-volt-500 text-white text-sm font-bold disabled:opacity-40"
      >
        {dirty ? 'Enregistrer les réglages' : savedChanges ? '✓ Réglages enregistrés' : 'Aucune modification'}
      </button>
      {!savedChanges && !dirty && (
        <button
          type="button"
          disabled={applying || applied}
          onClick={async () => { const ok = await onApplyNextWeek(); if (ok) setApplied(true); }}
          className="w-full min-h-[40px] rounded-xl border border-ink-800 text-xs font-bold text-ink-300 disabled:opacity-60"
        >
          {applying ? 'Régénération en cours (jusqu\'à 2-3 min)…' : applied ? `✓ Semaine ${nextWeekLabel} régénérée — voir le calendrier` : `Régénérer la semaine ${nextWeekLabel} avec les réglages actuels`}
        </button>
      )}
      {!savedChanges && !dirty && applyError && <p className="text-xs text-rose-400">{applyError}</p>}
      {savedChanges && (
        <div role="status" className="bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-3 space-y-2">
          <p className="text-sm font-bold text-emerald-400">✓ Enregistré</p>
          {savedChanges.length > 0 && (
            <ul className="text-xs text-ink-200 space-y-0.5 list-disc list-inside">{savedChanges.map((c) => <li key={c}>{c}</li>)}</ul>
          )}
          <p className="text-xs text-ink-400 leading-snug">Le plan déjà affiché ne change pas tout seul. Pour voir l'effet dès maintenant, régénère la semaine prochaine :</p>
          <button
            type="button"
            disabled={applying || applied}
            onClick={async () => { const ok = await onApplyNextWeek(); if (ok) setApplied(true); }}
            className="w-full min-h-[44px] rounded-xl border border-volt-500 text-volt-400 text-sm font-bold disabled:opacity-60"
          >
            {applying ? 'Régénération en cours (jusqu\'à 2-3 min)…' : applied ? `✓ Semaine ${nextWeekLabel} régénérée — voir le calendrier` : `Appliquer à la semaine prochaine (S${nextWeekLabel})`}
          </button>
          {applyError && <p className="text-xs text-rose-400">{applyError}</p>}
        </div>
      )}
    </div>
  );
}

// Date locale de l'athlète au format YYYY-MM-DD (voir lib/coachPrompts.js:resolveToday).
function localISODate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function Home() {
  const { t, lang } = useI18n();
  const [activeTab, setActiveTab] = useState('today'); // écran « Aujourd'hui » à l'ouverture
  // Sous-onglet de l'onglet Outils — Nutrition, Météo, ou Pression pneus (le Profil &
  // données santé a désormais son propre onglet principal, voir plus bas). Séparé de
  // `activeTab` : ce n'est pas un onglet de la barre principale, juste une sous-navigation
  // locale à cet onglet.
  const [toolsSubTab, setToolsSubTab] = useState('nutrition');
  // Sous-onglet de l'onglet Profil — voir PROFILE_SUB_TABS ci-dessus (Santé / Progression /
  // Records), même principe que toolsSubTab.
  const [profileSubTab, setProfileSubTab] = useState('health');
  const [activeWeek, setActiveWeek] = useState('N');
  const [sportFilter, setSportFilter] = useState('RUN');

  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [trainingPlan, setTrainingPlan] = useState(DEFAULT_TRAINING_PLAN);
  const [workouts, setWorkouts] = useState(DEFAULT_WORKOUTS);
  const [sportType, setSportType] = useState('triathlon');
  // Contraintes déclarées au wizard (séances/sem, heures/sem, jour de repos) —
  // sans ça le chat n'avait AUCUN moyen de savoir ce qui avait été demandé au
  // questionnaire et pouvait donc "oublier" ces contraintes lors d'un ajustement.
  const [constraints, setConstraints] = useState(null);

  // Ouvert par défaut : évite tout délai/flash au premier chargement (voir effet d'hydratation
  // ci-dessous qui le referme immédiatement si l'athlète a déjà un plan).
  const [showWizard, setShowWizard] = useState(true);
  const [wizardSubmitting, setWizardSubmitting] = useState(false);
  const [wizardError, setWizardError] = useState(null);

  // AJOUTÉ : tant que VMA/FTP/CSS ne sont pas renseignées, les séances déjà générées
  // affichent une allure/puissance en repli RPE (voir enrichWorkoutMetrics dans
  // lib/workouts.js) — mais rien ne les recalculait ensuite si l'athlète renseignait
  // la métrique manquante APRÈS coup, dans l'onglet Profil : les séances déjà présentes
  // au calendrier restaient bloquées sur "selon ressenti" indéfiniment, même une fois la
  // vraie donnée disponible. On recalcule donc ICI, immédiatement et sans appel IA
  // (sanitizeWorkout est pur/déterministe), TOUTES les séances déjà générées dès que
  // vma/ftp/nat100 change — l'allure/puissance se met à jour tout de suite, pas seulement
  // à la prochaine génération de plan.
  const handleProfileChange = (nextProfile) => {
    // BUG RÉEL CORRIGÉ : fcMax/fcRepos étaient utilisés par sanitizeWorkout (zones
    // cardio, voir lib/workouts.js) mais absents de cette liste de déclenchement — une
    // nouvelle FC saisie ici mettait bien à jour le profil, mais ne recalculait JAMAIS
    // les séances déjà générées (contrairement à vma/ftp/nat100, qui fonctionnaient).
    const metricsChanged = ['vma', 'ftp', 'nat100', 'fcMax', 'fcRepos'].some((k) => profile[k] !== nextProfile[k]);
    // Date de la dernière valeur de chaque métrique de test (VMA/FTP/CSS) : le coach propose
    // un re-test quand elle date de plus de ~8 semaines (voir lib/gemini.js:computeTestPlan).
    const stamped = { vma: 'vma', ftp: 'ftp', nat100: 'css' };
    const updatedAt = { ...(nextProfile.metricsUpdatedAt || profile.metricsUpdatedAt || {}) };
    Object.entries(stamped).forEach(([k, metric]) => {
      if (nextProfile[k] && profile[k] !== nextProfile[k]) updatedAt[metric] = localISODate();
    });
    nextProfile = { ...nextProfile, metricsUpdatedAt: updatedAt };
    setProfile(nextProfile);
    if (!metricsChanged) return;
    setWorkouts((prev) => ({
      N: (prev.N || []).map((w) => sanitizeWorkout(w, nextProfile)),
      'N+1': (prev['N+1'] || []).map((w) => sanitizeWorkout(w, nextProfile)),
    }));
  };

  // Même logique que handleProfileChange ci-dessus, mais pour les zones d'allure CAP
  // calibrées manuellement dans l'onglet Profil (voir components/ZoneCharts.js) : sans
  // ce recalcul immédiat, une allure EF corrigée à la main restait invisible sur les
  // séances déjà générées jusqu'à la prochaine génération de plan complète. `paceZones`
  // n'est PAS un champ de `profile` (state géré séparément, voir lib/storage.js), donc on
  // le fusionne ici uniquement pour sanitizeWorkout (voir lib/workouts.js:fallbackEfSpeedKmh/
  // paceSanityBoundsKmh, qui lisent `profile.paceZones`) — sans jamais l'écrire dans le
  // profil persisté lui-même.
  const handlePaceZonesChange = (nextPaceZones) => {
    const profileWithPaceZones = { ...profile, paceZones: nextPaceZones };
    setWorkouts((prev) => ({
      // BUG RÉEL CORRIGÉ : sanitizeWorkout seul ne recalcule que les séances continues
      // EF (Z2) et les allures de repli internes — il préserve DÉLIBÉRÉMENT l'allure
      // déjà choisie par l'IA pour une séance fractionnée/côtes (voir lib/workouts.js,
      // en-tête de forceRecalcWorkoutPaces). Résultat côté athlète : valider de
      // nouvelles zones d'allure dans l'onglet Profil semblait "ne rien faire" pour la
      // quasi-totalité des séances déjà générées, tant qu'il ne pensait pas à cliquer
      // ENSUITE sur "🔄 Actualiser séance" (et seulement pour la semaine affichée).
      // On applique donc ici forceRecalcWorkoutPaces (même mécanique que ce bouton),
      // sur les deux semaines visibles, juste après sanitizeWorkout — qui reste
      // nécessaire pour le reste de la normalisation (type, cohérence, badges...).
      N: (prev.N || []).map((w) => forceRecalcWorkoutPaces(sanitizeWorkout(w, profileWithPaceZones), profileWithPaceZones)),
      'N+1': (prev['N+1'] || []).map((w) => forceRecalcWorkoutPaces(sanitizeWorkout(w, profileWithPaceZones), profileWithPaceZones)),
    }));
  };

  const [selectedWorkout, setSelectedWorkout] = useState(null);
  const [showFeedbackPicker, setShowFeedbackPicker] = useState(false);
  const [feedbackHistory, setFeedbackHistory] = useState([]);
  const [pendingAdjustment, setPendingAdjustment] = useState(null);
  const [onboarded, setOnboarded] = useState(true); // true par défaut le temps de l'hydratation, pour ne pas flasher le wizard inutilement
  const [showSettings, setShowSettings] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  // --- AIDE (components/help/) : visite guidée, centre d'aide ❓, astuces par onglet ---
  const [showTour, setShowTour] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [tipsSeen, setTipsSeen] = useState({});
  useEffect(() => { setTipsSeen(loadFromStorage(STORAGE_KEYS.tipsSeen, {})); }, []);
  const dismissTip = (tab) => setTipsSeen((prev) => {
    const next = { ...prev, [tab]: true };
    saveToStorage(STORAGE_KEYS.tipsSeen, next);
    return next;
  });
  const closeTour = () => {
    saveToStorage(STORAGE_KEYS.tutorialSeen, true);
    setShowTour(false);
  };

  const [messages, setMessages] = useState([{ sender: 'coach', text: t('chat.welcome', '') }]);
  const [inputMessage, setInputMessage] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatIntent, setChatIntent] = useState(null);
  const chatEndRef = useRef(null);

  const [hydrated, setHydrated] = useState(false);

  // --- AUTH SUPABASE (optionnelle — voir lib/supabase.js) ---------------------
  // `authReady` vaut déjà `true` si Supabase n'est pas configuré, pour ne jamais
  // bloquer l'app derrière un écran de connexion qui n'a pas lieu d'être.
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [skippedAuth, setSkippedAuth] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const mergeAttemptedRef = useRef(false);

  // Enregistre le hook de sync cloud une seule fois : chaque sauvegarde locale
  // (saveToStorage, y compris celles faites en interne par NutritionPlanner.js)
  // déclenchera automatiquement un push cloud débounced si un compte est connecté.
  useEffect(() => {
    setStorageSaveHook((key) => queueCloudPush(key));
  }, []);

  // Le chat n'est plus poussé par le debounce (voir lib/cloudSync.js) : on rattrape
  // sa synchronisation quand l'app quitte le premier plan (onglet caché, app mise en
  // arrière-plan sur mobile) ou juste avant fermeture — c'est largement suffisant.
  useEffect(() => {
    const onVisibilityChange = () => { if (document.hidden) flushCloudPushOnHide(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flushCloudPushOnHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flushCloudPushOnHide);
    };
  }, []);

  // Récupère la session au chargement + écoute les changements (connexion/déconnexion).
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      // BUG DE SÉCURITÉ CORRIGÉ : après une connexion Google, Supabase redirige vers l'app
      // avec le jeton de session DANS L'URL (`#access_token=...&refresh_token=...`, via
      // `detectSessionInUrl: true`). Sans nettoyage, cette URL restait dans la barre
      // d'adresse — donc bookmarkable, partageable, ou récupérable via "onglets récents"/
      // écran d'accueil — et QUICONQUE l'ouvrait ensuite (même en navigation privée, qui
      // n'efface pas ce qui est dans l'URL elle-même) se retrouvait connecté avec CE
      // compte, sans jamais voir l'écran de connexion. On retire donc le jeton de l'URL
      // dès qu'il a été consommé, en gardant l'utilisateur sur la même page.
      if (event === 'SIGNED_IN' && typeof window !== 'undefined' && window.location.hash.includes('access_token')) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      if (!sess) {
        // Déconnexion : on réautorise une future fusion cloud à la prochaine connexion.
        mergeAttemptedRef.current = false;
        setCloudUser(null);
        if (typeof window !== 'undefined') sessionStorage.removeItem('tri_cloud_merged_for');
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Dès qu'une session existe : récupère les données cloud et les fusionne dans le
  // navigateur (écrase le localStorage local avec la version cloud), UNE SEULE FOIS
  // par connexion. S'il n'y avait rien côté cloud (premier login sur ce compte), on
  // pousse au contraire l'état local actuel pour amorcer le compte.
  useEffect(() => {
    if (!isSupabaseConfigured || !session?.user?.id || mergeAttemptedRef.current) return;
    mergeAttemptedRef.current = true;
    setCloudUser(session.user.id);

    const alreadyMergedThisSession =
      typeof window !== 'undefined' && sessionStorage.getItem('tri_cloud_merged_for') === session.user.id;
    if (alreadyMergedThisSession) return;

    (async () => {
      setCloudSyncing(true);
      const { merged } = await fetchAndMergeCloudData(session.user.id);
      if (typeof window !== 'undefined') sessionStorage.setItem('tri_cloud_merged_for', session.user.id);
      if (merged) {
        // Le localStorage vient d'être remplacé par la version cloud : la façon la
        // plus fiable de garantir que TOUT l'état déjà chargé en mémoire (index.js
        // ET les composants avec leur propre stockage local, ex: NutritionPlanner)
        // reflète bien ces données est de relire l'app depuis zéro.
        window.location.reload();
        return;
      }
      // Rien en cloud pour ce compte : on y pousse l'état local actuel tel quel.
      await pushCloudDataNow();
      setCloudSyncing(false);
    })();
  }, [session]);

  const handleSignOut = async () => {
    if (!isSupabaseConfigured) return;
    await supabase.auth.signOut();
  };

  // --- ACTIVITÉS STRAVA -------------------------------------------------------
  // Simple lecture Supabase protégée par RLS (chacun ne voit que ses propres
  // lignes, voir supabase-schema-strava.sql) — l'écriture se fait uniquement
  // côté serveur (webhook), sauf la correction manuelle de correspondance, faite
  // directement depuis ActivityDetail.js (également RLS, policy "update own match").
  const [stravaActivities, setStravaActivities] = useState([]);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [stravaToast, setStravaToast] = useState('');

  const refreshStravaActivities = async () => {
    if (!isSupabaseConfigured || !session?.user?.id) return;
    const { data, error } = await supabase
      .from('strava_activities')
      .select('*')
      .order('start_date', { ascending: false })
      // 150 (pas 40) : la courbe "Progression" (WeeklyProgressChart) et la charge d'entraînement
      // (TrainingLoadChart, fenêtre CTL de 42 jours) veulent 12 semaines d'historique complètes —
      // 40 activités ne suffisent plus dès qu'on dépasse ~3-4 séances/semaine en moyenne.
      .limit(150);
    if (!error && data) setStravaActivities(data);
  };

  useEffect(() => {
    refreshStravaActivities();
    // Le webhook écrit les nouvelles activités en arrière-plan (déclenché par
    // l'upload Strava, pas par une action dans l'app) : on rafraîchit donc aussi
    // au retour au premier plan, pour voir apparaître une activité uploadée
    // pendant que le téléphone était verrouillé/en arrière-plan.
    const onVisibilityChange = () => { if (!document.hidden) refreshStravaActivities(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // Retour de la connexion Strava (redirection depuis pages/api/strava/callback.js) :
  // affiche un petit statut puis nettoie l'URL pour ne pas le réafficher au refresh.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const stravaParam = params.get('strava');
    if (!stravaParam) return;
    const messages = {
      connected: 'Compte Strava connecté ✅',
      denied: 'Connexion Strava annulée.',
      session_expired: 'Session expirée, reconnecte-toi puis réessaie de lier Strava.',
      not_configured: 'Strava n\'est pas encore configuré sur cette app.',
      error: 'La connexion à Strava a échoué. Réessaie.',
    };
    setStravaToast(messages[stravaParam] || '');
    if (stravaParam === 'connected') refreshStravaActivities();
    window.history.replaceState(null, '', window.location.pathname);
    const timer = setTimeout(() => setStravaToast(''), 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- CHARGEMENT INITIAL DEPUIS LE STOCKAGE LOCAL ---
  useEffect(() => {
    const loadedProfile = loadFromStorage(STORAGE_KEYS.profile, DEFAULT_PROFILE);
    setProfile(loadedProfile);
    setMessages(loadFromStorage(STORAGE_KEYS.chat, [{ sender: 'coach', text: t('chat.welcome', loadedProfile.firstName) }]));
    setSportType(loadFromStorage(STORAGE_KEYS.sportType, 'triathlon'));
    setConstraints(loadFromStorage(STORAGE_KEYS.constraints, null));
    setFeedbackHistory(loadFromStorage(STORAGE_KEYS.feedbackHistory, []));
    const alreadyOnboarded = loadFromStorage(STORAGE_KEYS.onboarded, false) || Boolean(loadedProfile.firstName?.trim());
    setOnboarded(alreadyOnboarded);
    // BUG CORRIGÉ : si l'athlète n'a JAMAIS complété le questionnaire, on ignore
    // volontairement ce qu'il peut y avoir dans le storage pour plan/workouts — avant la
    // correction ci-dessus, une visite précédente pouvait y avoir laissé le plan triathlon
    // fictif (DEFAULT_TRAINING_PLAN/DEFAULT_WORKOUTS) persisté par erreur. On repart d'un
    // état "aucun plan" propre (EMPTY_*) plutôt que d'afficher ce faux plan de démo comme
    // si c'était le sien.
    if (alreadyOnboarded) {
      setTrainingPlan(loadFromStorage(STORAGE_KEYS.plan, DEFAULT_TRAINING_PLAN));
      setWorkouts(loadFromStorage(STORAGE_KEYS.workouts, DEFAULT_WORKOUTS));
    } else {
      setTrainingPlan(EMPTY_TRAINING_PLAN);
      setWorkouts(EMPTY_WORKOUTS);
    }
    // Décision explicite dans les deux sens (ouvrir OU fermer), pour ne jamais dépendre
    // d'un état initial supposé et garantir un affichage cohérent dès l'hydratation.
    setShowWizard(!alreadyOnboarded);
    setHydrated(true);
  }, []);

  // --- PERSISTANCE ---
  // BUG CORRIGÉ : `trainingPlan`/`workouts` démarrent avec DEFAULT_TRAINING_PLAN/DEFAULT_WORKOUTS
  // (un plan triathlon fictif, uniquement destiné à servir de décor derrière la modale du
  // questionnaire). Sans garde ici, ces effets les sauvegardaient dans le localStorage dès
  // l'hydratation — AVANT même que l'athlète ait complété le questionnaire — donc un visiteur
  // qui n'avait pas encore de vrai plan se retrouvait avec ce faux plan triathlon (natation +
  // vélo + course) persisté comme si c'était le sien. On attend maintenant `onboarded` pour
  // persister ces deux clés (le reste peut être sauvegardé sans risque, ce sont déjà des
  // valeurs vides/neutres tant que rien n'a été renseigné).
  useEffect(() => { if (hydrated) saveToStorage(STORAGE_KEYS.profile, profile); }, [profile, hydrated]);
  useEffect(() => { if (hydrated && onboarded) saveToStorage(STORAGE_KEYS.plan, trainingPlan); }, [trainingPlan, hydrated, onboarded]);
  useEffect(() => { if (hydrated && onboarded) saveToStorage(STORAGE_KEYS.workouts, workouts); }, [workouts, hydrated, onboarded]);
  useEffect(() => { if (hydrated) saveToStorage(STORAGE_KEYS.chat, messages); }, [messages, hydrated]);
  useEffect(() => { if (hydrated) saveToStorage(STORAGE_KEYS.sportType, sportType); }, [sportType, hydrated]);
  useEffect(() => { if (hydrated) saveToStorage(STORAGE_KEYS.constraints, constraints); }, [constraints, hydrated]);
  useEffect(() => { if (hydrated) saveToStorage(STORAGE_KEYS.feedbackHistory, feedbackHistory); }, [feedbackHistory, hydrated]);
  useEffect(() => { if (hydrated) saveToStorage(STORAGE_KEYS.onboarded, onboarded); }, [onboarded, hydrated]);

  useEffect(() => {
    if (activeTab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeTab]);

  // Le compte à rebours ("jours restants") doit rester exact même si l'app reste
  // ouverte plusieurs jours sans rechargement (PWA) : sans ce tick, computeRaceStats
  // n'était réévalué que lorsque trainingPlan changeait (ex: à la génération du plan),
  // donc Date.now() restait figé à ce moment-là et le compteur ne décroissait plus.
  const [dayTick, setDayTick] = useState(() => new Date().toDateString());
  useEffect(() => {
    const interval = setInterval(() => setDayTick(new Date().toDateString()), 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const raceStats = useMemo(() => computeRaceStats(trainingPlan), [trainingPlan, dayTick]);

  const sportFilters = useMemo(() => getSportFilters(sportType), [sportType]);

  // Filtre par défaut = premier filtre valide pour le sport (TOUT en triathlon, RUN en course).
  // CORRECTIF : l'état initial était 'RUN' et n'était réinitialisé que si ce filtre n'existait
  // pas — un triathlète ne voyait donc QUE ses séances de course après avoir généré son plan
  // (vérifié en test navigateur), tant qu'il ne touchait pas "TOUT".
  useEffect(() => {
    setSportFilter(sportFilters[0]?.id || 'ALL');
  }, [sportFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  // On ne filtre plus la liste ici : CalendarView a besoin de connaître TOUTES les
  // séances de la semaine (pas seulement celles du sport choisi) pour pouvoir
  // distinguer un vrai jour de repos d'un jour où une autre discipline est prévue.
  // Le filtrage par sport est donc appliqué à l'intérieur de CalendarView via `sportFilter`.
  // Numéros de semaine calendaire réels affichés au lieu de "N"/"N+1" — voir
  // lib/periodization.js:getWeekLabel. `activeWeek` ('N'/'N+1') reste la clé de données
  // interne (workouts, patches, storage...), seul l'AFFICHAGE change.
  // dayTick en dépendance : une PWA laissée ouverte d'une semaine sur l'autre affichait
  // sinon indéfiniment les numéros de la semaine où elle avait été ouverte.
  const weekNumberN = useMemo(() => getWeekLabel(0), [dayTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekNumberN1 = useMemo(() => getWeekLabel(1), [dayTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Photo de profil Strava : proposée dans le Profil et utilisée automatiquement si
  // l'athlète n'a ni envoyé sa propre photo ni retiré volontairement la photo.
  const [stravaPhotoUrl, setStravaPhotoUrl] = useState(null);
  useEffect(() => {
    if (!hydrated || !session?.access_token) return;
    let cancelled = false;
    fetch('/api/strava/athlete-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: session.access_token }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.photoUrl) return;
        setStravaPhotoUrl(d.photoUrl);
        setProfile((prev) => (prev?.photo || ['upload', 'none'].includes(prev?.photoSource) ? prev : { ...prev, photo: d.photoUrl, photoSource: 'strava' }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [hydrated, session?.access_token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Actions rapides (bouton central de la barre du bas).
  const handleQuickAction = (id) => {
    setQuickOpen(false);
    if (id === 'chat') { setActiveTab('chat'); return; }
    if (id === 'today-session') {
      const todayName = DAYS_OF_WEEK[(new Date().getDay() + 6) % 7];
      const first = (workouts?.N || []).find((w) => w.day === todayName && w.type !== 'REPOS');
      setActiveTab('today');
      if (first) setSelectedWorkout(first);
      return;
    }
    setToolsSubTab(id);
    setActiveTab('tools');
  };

  // Visite guidée lancée UNE fois, dès qu'un plan existe (premier plan d'un nouvel athlète,
  // ou premier lancement de cette version pour un athlète déjà inscrit).
  useEffect(() => {
    if (!hydrated || !onboarded || showWizard || wizardSubmitting) return;
    if (!loadFromStorage(STORAGE_KEYS.tutorialSeen, false)) setShowTour(true);
  }, [hydrated, onboarded, showWizard, wizardSubmitting]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- BASCULE AUTOMATIQUE DE SEMAINE (voir lib/trainingCycle.js:rolloverWorkouts) ---
  // Au changement de semaine calendaire, l'ancienne N+1 devient N et N+1 reste à générer
  // (bouton dans le calendrier). Avant, l'app affichait indéfiniment les séances de la
  // semaine de génération comme « semaine en cours ».
  useEffect(() => {
    if (!hydrated || !onboarded || !trainingPlan?.title) return;
    const r = rolloverWorkouts(workouts, trainingPlan.weekAnchor, localISODate());
    if (r.shifted > 0 && trainingPlan.weekAnchor) {
      // Archive des semaines écoulées (séances clés + statut réel) pour la progression dans la durée.
      const archive = (list, weekStart) => {
        const nextMonday = (() => { const d = new Date(`${weekStart}T12:00:00`); d.setDate(d.getDate() + 7); return localISODate(d); })();
        const past = findPastUnconfirmedSessions({ workoutsN: list, activities: stravaActivities, feedbackHistory, sessionStatus: loadFromStorage(STORAGE_KEYS.sessionStatus, {}), todayIso: nextMonday, weekStartIso: weekStart });
        const statusOf = (id) => {
          const declared = loadFromStorage(STORAGE_KEYS.sessionStatus, {})[id];
          if (declared === 'skipped') return 'missed';
          return past.find((p) => p.workout.id === id)?.status || 'unknown';
        };
        const sessions = (list || []).filter((w) => w.type !== 'REPOS').map((w) => ({
          day: w.day, type: w.type, title: w.title, duration: w.duration, key: isHardSession(w), status: statusOf(w.id),
        }));
        return { weekStart, plannedHours: Math.round((sessions.reduce((sum, x) => sum + (parseDurMin(x.duration) || 0), 0) / 60) * 10) / 10, sessions };
      };
      const toArchive = [archive(workouts.N, trainingPlan.weekAnchor)];
      if (r.shifted >= 2 && (workouts['N+1'] || []).length) {
        const d = new Date(`${trainingPlan.weekAnchor}T12:00:00`); d.setDate(d.getDate() + 7);
        toArchive.push(archive(workouts['N+1'], localISODate(d)));
      }
      const prevHist = loadFromStorage(STORAGE_KEYS.weekHistory, []);
      const merged = [...prevHist.filter((h) => !toArchive.some((a) => a.weekStart === h.weekStart)), ...toArchive.filter((a) => a.sessions.length)]
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
        .slice(-6);
      saveToStorage(STORAGE_KEYS.weekHistory, merged);
    }
    if (r.weekAnchor !== trainingPlan.weekAnchor) {
      setTrainingPlan((prev) => ({ ...prev, weekAnchor: r.weekAnchor }));
    }
    if (r.shifted > 0) {
      setWorkouts(r.workouts);
      setActiveWeek('N');
      setMessages((prev) => [...prev, {
        sender: 'coach',
        text: r.shifted === 1
          ? '📅 **Nouvelle semaine !** Les séances prévues pour cette semaine sont en place. La semaine suivante est à générer depuis le calendrier.'
          : '📅 **Ton plan date de plus d\'une semaine.** Génère la semaine en cours et la suivante depuis le calendrier.',
      }]);
    }
  }, [dayTick, hydrated, onboarded]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- GÉNÉRATION D'UNE SEMAINE VIDE (après bascule) — réutilise /api/regenerate-week ---
  const [generatingWeek, setGeneratingWeek] = useState(null);
  const [weekGenError, setWeekGenError] = useState(null);
  const handleGenerateWeek = async (weekKey) => {
    if (generatingWeek) return false;
    setGeneratingWeek(weekKey);
    setWeekGenError(null);
    try {
      const res = await aiFetch('/api/regenerate-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekKey, profile, workouts, trainingPlan, constraints, feedbackHistory,
          healthHistory: loadFromStorage(STORAGE_KEYS.healthHistory, []),
          manualPaceZones: loadFromStorage(STORAGE_KEYS.paceZones, null),
          manualHrZones: loadFromStorage(STORAGE_KEYS.hrZones, null),
          injuryLog: loadFromStorage(STORAGE_KEYS.injuryLog, []),
          raceCalendar: loadFromStorage(STORAGE_KEYS.raceCalendar, []),
          menstrualCycle: loadFromStorage(STORAGE_KEYS.menstrualCycle, null),
          language: lang,
          clientDate: localISODate(),
          trainingLoad: recentLoad,
          missedSessions: missedForAI,
          weekHistory: loadFromStorage(STORAGE_KEYS.weekHistory, []),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la génération de la semaine.');
      setWorkouts(data.workouts);
      // Tests proposés dans cette semaine : mémorisés pour ne pas les reproposer à chaque
      // régénération (la route renvoyait déjà l'info, elle n'était jamais enregistrée).
      if (data.profile?.physioTestProposedAt) {
        setProfile((prev) => ({ ...prev, physioTestProposedAt: { ...(prev.physioTestProposedAt || {}), ...data.profile.physioTestProposedAt } }));
      }
      if (data.weekSummary) {
        setMessages((prev) => [...prev, { sender: 'coach', text: `🗓️ **Semaine ${weekKey === 'N' ? weekNumberN : weekNumberN1} générée**\n\n${data.weekSummary}` }]);
      }
      return true;
    } catch (err) {
      setWeekGenError(err.message || 'Erreur lors de la génération de la semaine.');
      return false;
    } finally {
      setGeneratingWeek(null);
    }
  };

  // Lundi (date locale ISO) de la semaine affichée — dates des jours dans le calendrier.
  const weekStartIso = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + (activeWeek === 'N+1' ? 7 : 0));
    return localISODate(d);
  }, [activeWeek, dayTick]);

  // Nature de la semaine affichée (charge/décharge) si un cycle est déclaré.
  const activeWeekLoad = useMemo(() => (constraints?.loadCycle ? weekLoadInfo(constraints.loadCycle, weekStartIso) : null), [constraints, weekStartIso]);

  // --- RÉALISÉ RÉEL (Strava) + SÉANCES PASSÉES — voir lib/recentTraining.js ---
  const todayIso = useMemo(() => localISODate(), [dayTick]);
  const mondayNIso = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return localISODate(d);
  }, [dayTick]);
  const [sessionStatus, setSessionStatus] = useState({});
  useEffect(() => { setSessionStatus(loadFromStorage(STORAGE_KEYS.sessionStatus, {})); }, []);
  const markSessionStatus = (id, status) => setSessionStatus((prev) => {
    const next = { ...prev, [id]: status };
    saveToStorage(STORAGE_KEYS.sessionStatus, next);
    return next;
  });
  const recentLoad = useMemo(
    () => summarizeRecentTraining({ activities: stravaActivities, profile, todayIso }),
    [stravaActivities, profile, todayIso],
  );
  const pastSessions = useMemo(
    () => findPastUnconfirmedSessions({ workoutsN: workouts.N, activities: stravaActivities, feedbackHistory, sessionStatus, todayIso, weekStartIso: mondayNIso }),
    [workouts, stravaActivities, feedbackHistory, sessionStatus, todayIso, mondayNIso],
  );
  const missedForAI = useMemo(() => describeMissedForAI(pastSessions), [pastSessions]);
  // Séances FAITES, même définition partout (calendrier = Aujourd'hui). CORRECTIF : le
  // calendrier ne comptait que les séances avec un ressenti validé, pas celles marquées
  // « ✓ Faite » dans Aujourd'hui ni celles reconnues via Strava.
  const doneIds = useMemo(() => new Set([
    ...feedbackHistory.map((f) => f.workoutId),
    ...Object.entries(sessionStatus).filter(([, st]) => st === 'done').map(([id]) => id),
    ...pastSessions.filter((p) => p.status === 'done').map((p) => p.workout.id),
    ...stravaActivities.map((a) => a.matched_workout_id).filter(Boolean),
  ]), [feedbackHistory, sessionStatus, pastSessions, stravaActivities]);
  const weekNLoad = useMemo(() => (constraints?.loadCycle ? weekLoadInfo(constraints.loadCycle, mondayNIso) : null), [constraints, mondayNIso]);

  const weekWorkouts = useMemo(() => workouts[activeWeek] || [], [workouts, activeWeek]);

  // Séances éligibles à un feedback depuis le chat (bouton "📝 Feedback séance") :
  // toute séance non-REPOS de N/N+1 pas encore validée. Réutilise EXACTEMENT le
  // même flux que le clic sur une séance au calendrier (setSelectedWorkout ouvre
  // WorkoutDetail, qui contient déjà le formulaire dureté/forme + analyzeFeedback).
  const feedbackEligibleWorkouts = useMemo(() => {
    const validatedIds = new Set(feedbackHistory.map((f) => f.workoutId));
    return ['N', 'N+1']
      .flatMap((wk) => (workouts[wk] || []).map((w) => ({ ...w, __week: wk })))
      .filter((w) => w.type !== 'REPOS' && !validatedIds.has(w.id));
  }, [workouts, feedbackHistory]);

  // Chips de suggestion sous la dernière réponse du coach : recalculées à chaque nouveau
  // message plutôt que fixes, pour rester pertinentes (voir getSmartSuggestions plus haut).
  const smartSuggestions = useMemo(() => {
    const lastCoach = [...messages].reverse().find((m) => m.sender === 'coach');
    return getSmartSuggestions({
      lastCoachText: lastCoach?.text,
      nextWorkout: feedbackEligibleWorkouts[0] || null,
      lang,
      t,
    });
  }, [messages, feedbackEligibleWorkouts, lang, t]);

  // Aperçu déterministe (pas d'appel IA) des semaines N+2/N+3, pour anticiper au-delà
  // des 2 semaines réellement générées par le coach — voir lib/periodization.js.
  const weeksOutlook = useMemo(
    () => getSeasonOutlook(constraints, trainingPlan?.startDate, hydrated ? loadFromStorage(STORAGE_KEYS.raceCalendar, []) : []),
    [constraints, trainingPlan?.startDate, hydrated]
  );

  // --- ACTUALISATION DES SÉANCES D'UNE SEMAINE (bouton "Actualiser séance") -----------
  // Remplace l'ancien bouton "Forcer la régénération de la semaine" (qui rappelait l'IA
  // pour réécrire entièrement le contenu de la semaine — lent, coûteux, et pouvait
  // changer la structure des séances). Ici, AUCUN appel IA : on recalcule localement,
  // instantanément, l'allure/puissance/FC cible de chaque séance déjà existante depuis
  // les données ACTUELLES de l'onglet Profil (VMA, zones calibrées, FTP, CSS, FC max/repos)
  // — voir lib/workouts.js:forceRecalcWeekPaces pour le détail du recalcul. Le contenu
  // (structure des séances, jours, volumes) n'est jamais touché : seuls les chiffres
  // dérivés du profil le sont, ce qui corrige le cas signalé où une séance fractionnée
  // gardait l'allure calculée avec une ancienne VMA/FTP après une correction du profil.
  const [refreshingWeek, setRefreshingWeek] = useState(null);

  const handleRefreshWeekPaces = (weekKey) => {
    if (refreshingWeek) return;
    setRefreshingWeek(weekKey);
    try {
      const paceZones = loadFromStorage(STORAGE_KEYS.paceZones, null);
      const profileWithPaceZones = paceZones ? { ...profile, paceZones } : profile;
      setWorkouts((prev) => ({
        ...prev,
        [weekKey]: forceRecalcWeekPaces(prev[weekKey] || [], profileWithPaceZones),
      }));
      const weekLabel = weekKey === 'N' ? weekNumberN : weekNumberN1;
      const coachMsg = `🔄 **Séances de la semaine ${weekLabel} actualisées** avec les données actuelles de ton profil (allures, puissance, FC cible).`;
      setMessages((prev) => [...prev, { sender: 'coach', text: coachMsg }]);
    } finally {
      setRefreshingWeek(null);
    }
  };

  // --- GÉNÉRATION D'UN NOUVEAU PLAN VIA L'ASSISTANT ---
  const handleWizardComplete = async (rawWizardData) => {
    // Le rythme + la position déclarés deviennent une ancre datée (lib/trainingCycle.js),
    // seule forme exploitable pour connaître la nature de n'importe quelle semaine future.
    const wizardData = {
      ...rawWizardData,
      loadCycle: buildLoadCycle(rawWizardData.loadCyclePattern || 'none', rawWizardData.loadCycleWeek, localISODate()),
    };
    setWizardSubmitting(true);
    setWizardError(null);
    try {
      // healthHistory (VFC notamment) est géré par ProfileHealth.js indépendamment de l'état de
      // cette page (son propre useState, persisté directement dans le storage) — on le relit ici
      // au moment de l'appel plutôt que de dupliquer un état par ailleurs, pour être sûr d'envoyer
      // les toutes dernières mesures saisies par l'athlète (voir applyFatigueAutoRegulation).
      const healthHistory = loadFromStorage(STORAGE_KEYS.healthHistory, []);
      // Zones d'allure CAP éventuellement calibrées manuellement par l'athlète dans
      // l'onglet Profil (voir components/ZoneCharts.js) — relues ici pour la même raison
      // que healthHistory ci-dessus (état géré indépendamment, on veut la dernière
      // valeur au moment de l'appel). Envoyées uniquement si l'athlète les a réellement
      // éditées (voir lib/gemini.js:computeRunZones côté serveur pour la priorité donnée
      // à ces valeurs sur le calcul théorique depuis la VMA).
      const paceZones = loadFromStorage(STORAGE_KEYS.paceZones, null);
      // Journal de blessures (voir components/InjuryJournal.js) — même logique de relecture
      // au moment de l'appel que healthHistory/paceZones ci-dessus.
      const injuryLog = loadFromStorage(STORAGE_KEYS.injuryLog, []);
      const raceCalendar = loadFromStorage(STORAGE_KEYS.raceCalendar, []);
      const menstrualCycle = loadFromStorage(STORAGE_KEYS.menstrualCycle, null);
      const res = await aiFetch('/api/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // clientDate : date LOCALE de l'athlète (le serveur Vercel tourne en UTC — sans elle,
        // un plan généré lundi à 00:30 à Paris serait calé sur la semaine précédente).
        body: JSON.stringify({ wizardData, profile, feedbackHistory, healthHistory, manualPaceZones: paceZones, manualHrZones: loadFromStorage(STORAGE_KEYS.hrZones, null), injuryLog, raceCalendar, menstrualCycle, language: lang, clientDate: localISODate(), trainingLoad: recentLoad, missedSessions: missedForAI, weekHistory: loadFromStorage(STORAGE_KEYS.weekHistory, []), previousPlan: trainingPlan?.startDate ? { date: trainingPlan.date, startDate: trainingPlan.startDate } : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la génération du plan.');

      // BUG CORRIGÉ : la génération d'un plan via l'assistant (premier onboarding OU
      // "+ Nouveau plan" après confirmation) remplace intégralement l'OBJECTIF de
      // l'athlète — mais messages (chat) et feedbackHistory n'étaient JAMAIS réinitialisés
      // ici. Conséquences concrètes : (1) l'ancienne conversation de coaching restait
      // affichée dans l'onglet chat après un nouveau plan, mélangeant du contexte périmé
      // avec le nouvel objectif ; (2) feedbackHistory (ressenti sur les séances de
      // L'ANCIEN plan) continuait d'être envoyé à /api/chat ET à generatePlanWithAI
      // (summarizeFeedbackTrend), influençant silencieusement la physiologie résolue et
      // la tendance de charge du NOUVEAU plan avec des données qui n'ont plus aucun sens
      // pour ce nouvel objectif. On repart donc explicitement à zéro sur ces deux points
      // à chaque génération de plan réussie.
      setTrainingPlan(data.trainingPlan);
      setWorkouts(data.workouts);
      setFeedbackHistory([]);
      setMessages([{ sender: 'coach', text: t('chat.welcome', wizardData.firstName?.trim() || '') }]);
      setSportType(wizardData.sportType || 'triathlon');
      // Le profil renvoyé par le serveur reflète la physiologie réellement résolue
      // pour cet athlète (mesurée/estimée/dérivée du niveau) — plus les valeurs
      // génériques fixes utilisées auparavant pour tout le monde.
      setProfile((prev) => ({
        ...prev,
        ...(data.profile || {}),
        firstName: wizardData.firstName?.trim() || prev.firstName,
      }));
      setConstraints({
        sportType: wizardData.sportType || 'triathlon',
        hoursPerWeek: wizardData.hoursPerWeek,
        maxSessionsPerWeek: wizardData.maxSessionsPerWeek,
        offDays: wizardData.offDays,
        ppgEnabled: wizardData.ppgEnabled !== false,
        // CORRECTIF : ces réponses n'étaient pas conservées — la régénération de semaine et le
        // chat (qui relisent ces contraintes) traitaient un athlète déjà entraîné comme un
        // débutant (montée progressive à 85 % du volume) et oubliaient son matériel de test.
        hasExistingTrainingBase: Boolean(wizardData.hasExistingTrainingBase),
        bikeTestEquipment: wizardData.bikeTestEquipment,
        gender: wizardData.gender,
        weight: wizardData.weight,
        runningSubtype: wizardData.runningSubtype,
        fitnessLevel: wizardData.fitnessLevel,
        trainingExperience: wizardData.trainingExperience,
        targetDate: wizardData.targetDate,
        // Descripteurs de l'épreuve visée (distance/format/temps cible) — nécessaires à
        // l'onglet Nutrition pour adapter le niveau de détail des conseils et pré-remplir
        // le calculateur de stratégie nutrition course (voir lib/nutritionData.js).
        eventName: wizardData.eventName,
        distance: wizardData.distance,
        trailKm: wizardData.trailKm,
        trailElevation: wizardData.trailElevation,
        triathlonFormat: wizardData.triathlonFormat,
        customDistances: wizardData.customDistances,
        targetTime: wizardData.targetTime,
        triathlonTimes: wizardData.triathlonTimes,
        loadCycle: wizardData.loadCycle,
        focusAreas: wizardData.focusAreas || [],
        coachNotes: wizardData.coachNotes || '',
        dayCaps: wizardData.dayCaps || null,
      });
      setShowWizard(false);
      setActiveTab('calendar');
      setOnboarded(true);

      const coachMsg = `🎯 **Nouveau plan généré !**\n\n- **Objectif** : ${data.trainingPlan?.title || wizardData.eventName || 'Nouvel objectif'}\n- **Volume hebdo** : ~${wizardData.hoursPerWeek}h/semaine sur ${wizardData.maxSessionsPerWeek} séances\n\n${data.weekSummary ? data.weekSummary : 'Les semaines N et N+1 ont été calées sur tes métriques actuelles.'}`;
      setMessages((prev) => [...prev, { sender: 'coach', text: coachMsg }]);
      // NB : data.coherenceWarnings / data.autoFixNotes ne sont volontairement plus
      // affichés dans le chat (retiré à la demande — ces récaps techniques n'apportaient
      // pas assez de valeur pour justifier d'encombrer le fil). Les données restent
      // disponibles côté API si besoin de les réafficher ailleurs plus tard.
    } catch (err) {
      setWizardError(err.message || 'Erreur lors de la génération du plan.');
    } finally {
      setWizardSubmitting(false);
    }
  };

  // --- CHAT AVEC LE COACH IA (fonction partagée : saisie libre + actions automatiques comme "alléger la semaine") ---
  const sendCoachMessage = async (userText, { intent = null, displayText = null } = {}) => {
    if (chatLoading) return;
    const newHistory = [...messages, { sender: 'user', text: displayText || userText }];
    setMessages(newHistory);
    setChatLoading(true);

    try {
      const healthHistory = loadFromStorage(STORAGE_KEYS.healthHistory, []);
      // Voir handleWizardComplete ci-dessus pour le même besoin sur /api/generate-plan.
      const paceZones = loadFromStorage(STORAGE_KEYS.paceZones, null);
      const injuryLog = loadFromStorage(STORAGE_KEYS.injuryLog, []);
      const raceCalendar = loadFromStorage(STORAGE_KEYS.raceCalendar, []);
      const menstrualCycle = loadFromStorage(STORAGE_KEYS.menstrualCycle, null);
      const res = await aiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // history : les derniers échanges (le coach n'avait jusqu'ici aucune mémoire du fil,
        // "et jeudi ?" était incompréhensible pour lui).
        body: JSON.stringify({ message: userText, history: messages.slice(-8), clientDate: localISODate(), profile, workouts, trainingPlan, intent, sportType, constraints, feedbackHistory, healthHistory, manualPaceZones: paceZones, manualHrZones: loadFromStorage(STORAGE_KEYS.hrZones, null), injuryLog, raceCalendar, menstrualCycle, language: lang, trainingLoad: recentLoad, missedSessions: missedForAI, weekHistory: loadFromStorage(STORAGE_KEYS.weekHistory, []) }),
      });
      const data = await res.json();

      const nextMessages = [...newHistory];

      if (data.updatedWorkouts) {
        // Séances modifiées : on affiche clairement AVANT (ancienne) au-dessus de APRÈS (nouvelle).
        // CORRECTIF : `previous`/`added` restent stockés sur une séance modifiée ; filtrer
        // uniquement sur leur présence réaffichait, à CHAQUE réponse, la comparaison de toutes
        // les séances modifiées depuis le début. On ne montre que ce qui vient de changer.
        const before = new Map([...(workouts.N || []), ...(workouts['N+1'] || [])].map((w) => [w.id, JSON.stringify(w)]));
        const allNew = [...(data.updatedWorkouts.N || []), ...(data.updatedWorkouts['N+1'] || [])]
          .filter((w) => before.get(w.id) !== JSON.stringify(w));
        const diffLines = allNew
          .filter((w) => w.previous)
          .map((w) => `- **${t('workout.before')}** : ${formatWorkoutSummary(w.previous, lang)}\n  **${t('workout.after')}** : ${formatWorkoutSummary(w, lang)}`);
        const addedLines = allNew
          .filter((w) => w.added)
          .map((w) => `- **${t('workout.addedViaChat')}** : ${formatWorkoutSummary(w, lang)}`);
        if (diffLines.length) {
          nextMessages.push({ sender: 'coach', text: `🔄 **Comparaison de la séance modifiée**\n${diffLines.join('\n')}` });
        }
        if (addedLines.length) {
          nextMessages.push({ sender: 'coach', text: `➕ **Nouvelle séance ajoutée**\n${addedLines.join('\n')}` });
        }
        setWorkouts(data.updatedWorkouts);
      }

      nextMessages.push({ sender: 'coach', text: data.reply || "J'ai bien pris en compte ta demande." });
      setMessages(nextMessages);
    } catch (err) {
      setMessages([
        ...newHistory,
        { sender: 'coach', text: '⚠️ Erreur lors de la réponse du coach. Vérifie la connexion backend.' },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if (!inputMessage.trim() || chatLoading) return;
    const intentPrefix = chatIntent === 'add' ? '[Ajout d\'une séance supplémentaire] ' : chatIntent === 'modify' ? '[Modification de séance] ' : '';
    const userText = inputMessage;
    setInputMessage('');
    await sendCoachMessage(userText, { intent: chatIntent, displayText: intentPrefix + userText });
    setChatIntent(null);
  };

  // --- VALIDATION D'UNE SÉANCE : ressenti dureté + forme physique ---
  const handleSubmitFeedback = (workout, difficulty, capacity) => {
    // Garde-fou : une séance déjà validée ne peut pas l'être une seconde fois.
    if (feedbackHistory.some((f) => f.workoutId === workout.id)) return;
    // Point 8 (cycle menstruel) "si besoin" — voir lib/feedback.js/isHigherPerceivedEffortPhase :
    // phase estimée au moment de la validation (proxy raisonnable du jour de la séance,
    // celle-ci étant généralement validée le jour même ou le lendemain). Toujours `null` si
    // le suivi n'est pas activé ou qu'aucune date n'a été déclarée — n'influence l'analyse
    // que dans ce cas précis, jamais par défaut.
    const menstrualCycle = loadFromStorage(STORAGE_KEYS.menstrualCycle, null);
    const cyclePhase = computeCurrentPhase(menstrualCycle);
    const analysis = analyzeFeedback(workout, { difficulty, capacity }, feedbackHistory, cyclePhase);
    const entry = {
      workoutId: workout.id,
      day: workout.day,
      difficulty,
      capacity,
      expectedDifficulty: analysis.expectedDifficulty,
      timestamp: Date.now(),
    };
    setFeedbackHistory((prev) => [...prev, entry]);
    if (analysis.needsCheck) {
      setPendingAdjustment({ workout, analysis });
    }
  };

  const handleLightenWeek = () => {
    const w = pendingAdjustment?.workout;
    setPendingAdjustment(null);
    if (!w) return;
    sendCoachMessage(
      `La séance "${w.title}" du ${w.day} a été ressentie bien plus dure que prévu, avec une forme physique faible ce jour-là. Allège les séances restantes de cette semaine pour laisser récupérer l'athlète.`,
      { intent: 'modify', displayText: `📉 Allègement demandé suite au ressenti de la séance du ${w.day}.` }
    );
  };

  const handleKeepAsIs = () => setPendingAdjustment(null);

  // Point 2 — Auto-régulation VFC (HRV) : déclenchée depuis ProfileHealth.js dès que
  // summarizeHrvTrend détecte une baisse notable (voir lib/feedback.js), sans attendre
  // qu'une séance ait déjà été ressentie trop dure (contrairement à handleLightenWeek
  // ci-dessus, purement réactif au ressenti post-séance). Réutilise le même canal —
  // sendCoachMessage — qui transmet déjà healthHistory à /api/chat à chaque appel
  // (voir lib/gemini.js:summarizeHrvTrend côté serveur), donc le coach IA dispose du
  // même signal que ce texte le décrit.
  const handleHrvLighten = (trend) => {
    sendCoachMessage(
      `Ma VFC (HRV) est en baisse notable ces derniers jours (${trend.label}). Allège les séances restantes de cette semaine pour laisser récupérer l'athlète.`,
      { intent: 'modify', displayText: `📉 Allègement demandé suite à la baisse de VFC (${trend.recentAvg} ms vs ${trend.baselineAvg} ms habituels).` }
    );
  };

  // --- ÉCRAN DE CONNEXION (uniquement si Supabase est configuré, sans session,
  // et sans que l'athlète ait choisi de continuer sans compte) -----------------
  if (isSupabaseConfigured && authReady && !session && !skippedAuth) {
    return <AuthScreen onSkip={() => setSkippedAuth(true)} />;
  }
  if (isSupabaseConfigured && !authReady) {
    return (
      <div className="min-h-screen bg-ink-950 flex items-center justify-center">
        <p className="text-xs text-ink-500 animate-pulse">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100 font-body flex flex-col pb-[calc(6.5rem+env(safe-area-inset-bottom))] antialiased">

      {/* HEADER — pt- supplémentaire pour ne pas passer sous l'encoche/la barre de statut
          une fois l'app lancée en plein écran (mode "standalone" installé). Volontairement
          minimal (logo + actions de compte) : les onglets vivent désormais dans la barre
          fixe en bas de l'écran, comme sur une app native, au lieu de s'empiler ici sous
          forme de deuxième bandeau — c'était le principal signal "site web dans un cadre". */}
      <header className="sticky top-0 z-30 bg-ink-900/90 backdrop-blur-md border-b border-ink-800 px-3 pt-[calc(0.5rem+env(safe-area-inset-top))] pb-2 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setActiveTab('today')}
            aria-label="Aujourd'hui"
            title="Aujourd'hui"
            className="w-[34px] h-[34px] rounded-xl bg-gradient-to-tr from-volt-500 to-flare-500 flex items-center justify-center font-black text-xs text-white shadow-glow-sm"
          >
            TC
          </button>
          <h1 className="text-sm font-black tracking-tight text-ink-50 flex items-center gap-1.5 font-display">
            TRI<span className="text-volt-400">COACH</span>
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            aria-label="Aide et tutoriel"
            title="Aide et tutoriel"
            className="w-[36px] h-[36px] rounded-full bg-ink-950 border border-ink-800 flex items-center justify-center text-ink-300 shrink-0"
          >
            <CircleHelp size={19} strokeWidth={2} aria-hidden="true" />
          </button>

          {isSupabaseConfigured && !session && skippedAuth && (
            <button
              onClick={() => setSkippedAuth(false)}
              className="text-[10px] font-bold text-ink-400 border border-ink-800 bg-ink-950 px-2.5 py-1.5 rounded-xl"
            >
              {t('header.login')}
            </button>
          )}
          {/* Notifications et réglages sont dans le Profil (appui sur la photo). */}
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            aria-label="Mon profil"
            aria-current={activeTab === 'profile' ? 'page' : undefined}
            title="Mon profil"
            className="rounded-full shrink-0"
          >
            <ProfileAvatar photo={profile?.photo} name={profile?.firstName || session?.user?.email} size={36} syncing={cloudSyncing} />
          </button>
        </div>
      </header>

      {showTour && <GuidedTour onClose={closeTour} />}
      {showHelp && (
        <HelpCenter
          onClose={() => setShowHelp(false)}
          onStartTour={() => { setShowHelp(false); setShowTour(true); }}
          onResetTips={() => { setTipsSeen({}); saveToStorage(STORAGE_KEYS.tipsSeen, {}); }}
        />
      )}

      <SettingsModal
        profile={profile}
        stravaPhotoUrl={stravaPhotoUrl}
        onPhotoChange={(photo, source) => setProfile((prev) => ({ ...prev, photo, photoSource: source }))}
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        session={session}
        onSignOut={handleSignOut}
        onStravaSynced={refreshStravaActivities}
        onNewPlan={() => {
          const hasExistingPlan = Boolean(trainingPlan?.cycles?.length || workouts?.N?.length);
          if (hasExistingPlan && !window.confirm(t('header.confirmNewPlan'))) return;
          setWizardError(null);
          setShowWizard(true);
          setShowSettings(false);
        }}
        onDeletePlan={() => {
          if (!window.confirm(t('header.confirmDeletePlan'))) return;
          setTrainingPlan(EMPTY_TRAINING_PLAN);
          setWorkouts(EMPTY_WORKOUTS);
          setConstraints(null);
          // Même raisonnement que dans handleWizardComplete : supprimer le plan doit
          // aussi vider le chat et l'historique de ressenti, sinon ils réapparaissent
          // au prochain plan généré (voir commentaire détaillé plus haut).
          setFeedbackHistory([]);
          setMessages([{ sender: 'coach', text: t('chat.welcome', '') }]);
          setShowWizard(false);
          setWizardError(null);
        }}
      />

      {/* Liseré tri-spectrum (nat/vélo/course) : signature visuelle discrète de l'app,
          rappel des 3 disciplines juste sous le header — jamais utilisé ailleurs comme
          simple décoration, uniquement ici et sur la timeline des macrocycles. */}
      <div className="h-[3px] w-full bg-tri-spectrum opacity-70 shrink-0" />

      <main key={activeTab} className="flex-1 max-w-md w-full mx-auto px-3 py-3 space-y-3 animate-fadeIn">
        {onboarded && !showTour && TAB_TIPS[activeTab] && !tipsSeen[activeTab] && (
          <TabTip text={TAB_TIPS[activeTab]} onDismiss={() => dismissTip(activeTab)} />
        )}

        {/* ONGLET AUJOURD'HUI (ouvert par défaut) */}
        {activeTab === 'today' && (
          <TodayView
            firstName={profile?.firstName}
            todayIso={todayIso}
            workoutsN={workouts.N || []}
            feedbackHistory={feedbackHistory}
            activities={stravaActivities}
            pastSessions={pastSessions}
            recentLoad={recentLoad}
            weekLoad={weekNLoad}
            hasPlan={Boolean(onboarded && trainingPlan?.title)}
            objectiveDate={onboarded && trainingPlan?.date ? String(trainingPlan.date).slice(0, 10) : null}
            doneIds={doneIds}
            onNewObjective={() => setShowWizard(true)}
            onOpenWorkout={setSelectedWorkout}
            onMarkStatus={markSessionStatus}
            onAskCoach={(text) => { setActiveTab('chat'); sendCoachMessage(text, { intent: 'modify' }); }}
            onGoto={(target) => {
              if (target === 'transitions') { setToolsSubTab('transitions'); setActiveTab('tools'); return; }
              if (target === 'weather') { setToolsSubTab('weather'); setActiveTab('tools'); return; }
              if (target === 'calendar') setActiveWeek('N');
              setActiveTab(target);
            }}
          />
        )}

        {/* ONGLET OUTILS — sous-onglets Nutrition / Météo / Pression pneus */}
        {activeTab === 'tools' && (
          <div className="space-y-4">
            {/* Onglets bien distincts entre eux : chaque bouton a désormais son propre
                fond + bordure (au lieu d'un simple changement de couleur de texte sur
                le fond commun du conteneur), et un espacement plus généreux — l'onglet
                actif se détache nettement (fond plein + ombre) des inactifs (contour
                visible, fond légèrement différent du conteneur). 5 sous-onglets depuis
                le déplacement de "records" vers l'onglet Profil (voir plus bas). */}
            {/* Barre défilante (6 outils) : cibles tactiles ≥ 44 px, icône + libellé lisible,
                au lieu d'une grille de 5 colonnes à 10 px qui ne pouvait plus accueillir d'outil. */}
            <UnderlineTabs
              scrollable
              ariaLabel="Outils"
              value={toolsSubTab}
              onChange={setToolsSubTab}
              tabs={TOOLS_SUB_TABS.map((sub) => ({
                id: sub,
                label: sub === 'tirePressure' ? t('tools.tirePressureSubTab')
                  : sub === 'equipment' ? t('tools.equipmentSubTab')
                  : sub === 'route' ? t('tools.routeSubTab')
                  : sub === 'transitions' ? 'Transitions'
                  : t(`tabs.${sub}`),
              }))}
            />

            {toolsSubTab === 'nutrition' && (
              <NutritionPanel profile={profile} trainingPlan={trainingPlan} workouts={workouts} sportType={sportType} constraints={constraints} />
            )}
            {toolsSubTab === 'transitions' && <TransitionTrainer sportType={sportType} />}
            {toolsSubTab === 'weather' && <WeatherPanel />}
            {toolsSubTab === 'route' && <RoutePlanner session={session} />}
            {toolsSubTab === 'tirePressure' && <TirePressureCalculator />}
            {toolsSubTab === 'equipment' && <EquipmentTracker session={session} />}
          </div>
        )}

        {/* ONGLET CALENDRIER */}
        {activeTab === 'calendar' && (
          <div className="space-y-4">
            <div className="space-y-2.5">
              <div className="flex items-center gap-1">
                <div className="flex-1">
                  <UnderlineTabs
                    ariaLabel="Semaine"
                    value={activeWeek}
                    onChange={setActiveWeek}
                    tabs={[{ id: 'N', label: `Semaine ${weekNumberN}` }, { id: 'N+1', label: `Semaine ${weekNumberN1}` }]}
                  />
                </div>
                <InfoTip id="semaines" />
              </div>
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Filtrer par sport">
                {sportFilters.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={sportFilter === f.id}
                    onClick={() => setSportFilter(f.id)}
                    className={`min-h-[34px] px-3.5 rounded-full text-[12px] font-semibold whitespace-nowrap transition-colors ${
                      sportFilter === f.id ? 'bg-ink-50 text-ink-950' : 'bg-ink-900 border border-ink-800 text-ink-300'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {activeWeekLoad && (
              <div className={`rounded-2xl border px-3 py-2 text-xs font-bold flex items-center gap-2 ${
                activeWeekLoad.kind === 'decharge'
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400'
                  : 'bg-volt-500/10 border-volt-500/30 text-volt-400'
              }`}>
                {activeWeekLoad.kind === 'decharge' ? <Leaf size={14} aria-hidden="true" /> : <Flame size={14} aria-hidden="true" />}
                <span className="flex-1">{activeWeekLoad.kind === 'decharge' ? 'Semaine de décharge — volume réduit, récupération' : `Semaine de charge ${activeWeekLoad.index}/${LOAD_PATTERNS[constraints.loadCycle.pattern]?.charge}`}</span>
                <InfoTip id="cycle" />
              </div>
            )}

            {!weekWorkouts.some((w) => w.type !== 'REPOS') && onboarded && trainingPlan?.title ? (
              <div className="bg-ink-900 border border-ink-800 rounded-2xl p-5 space-y-3 text-center">
                <p className="text-sm font-bold text-ink-50">Semaine {activeWeek === 'N' ? weekNumberN : weekNumberN1} pas encore générée</p>
                <p className="text-xs text-ink-400 leading-relaxed">
                  Le coach la construit dans la continuité de l'autre semaine, avec tes derniers ressentis
                  {constraints?.loadCycle?.pattern && constraints.loadCycle.pattern !== 'none' ? ' et ton cycle de charge' : ''}.
                </p>
                <button
                  type="button"
                  onClick={() => handleGenerateWeek(activeWeek)}
                  disabled={Boolean(generatingWeek)}
                  className="w-full min-h-[48px] rounded-xl bg-volt-500 text-white text-sm font-bold disabled:opacity-60"
                >
                  {generatingWeek === activeWeek ? '⏳ Génération en cours (jusqu\'à 2-3 min)…' : '✨ Générer cette semaine'}
                </button>
                {weekGenError && <p className="text-xs text-rose-400">{weekGenError}</p>}
              </div>
            ) : (
            <CalendarView
              weekKey={activeWeek}
              weekNumber={activeWeek === 'N' ? weekNumberN : weekNumberN1}
              workouts={weekWorkouts}
              sportFilter={sportFilter}
              onSelectWorkout={setSelectedWorkout}
              validatedIds={doneIds}
              activities={stravaActivities}
              onSelectActivity={setSelectedActivity}
              weekStartIso={weekStartIso}
            />
            )}

            {/* Bouton "Actualiser séance" — recalcule localement (sans appel IA) l'allure,
                la puissance et la FC cible de chaque séance de la semaine depuis les
                données ACTUELLES de l'onglet Profil. Voir handleRefreshWeekPaces +
                lib/workouts.js:forceRecalcWeekPaces. Remplace l'ancien bouton "Forcer la
                régénération" (appel IA, contenu potentiellement réécrit en entier). */}
            <button
              onClick={() => handleRefreshWeekPaces(activeWeek)}
              disabled={refreshingWeek === activeWeek}
              className="w-full py-2.5 rounded-2xl border border-ink-800 bg-ink-900 text-xs font-bold text-ink-300 hover:border-volt-500/50 hover:text-volt-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {refreshingWeek === activeWeek ? (
                <>⏳ Actualisation de la semaine {activeWeek === 'N' ? weekNumberN : weekNumberN1} en cours…</>
              ) : (
                <span className="inline-flex items-center gap-1.5"><RefreshCw size={15} aria-hidden="true" /> Actualiser les séances</span>
              )}
            </button>

            {weeksOutlook.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {weeksOutlook.map((w) => (
                  <div key={w.label} className="bg-ink-900 border border-ink-800 rounded-2xl p-3 space-y-1">
                    <span className="text-[12px] font-semibold text-ink-300">
                      {t('outlook.title', { label: w.label })}
                    </span>
                    <p className="text-xs font-bold text-ink-50 pt-1">{w.phaseName}{w.kindLabel ? ` · ${w.kindLabel}` : ''}</p>
                    <p className="text-[10px] text-ink-500">{w.weekStartLabel}</p>
                    <p className="text-[11px] text-ink-300">
                      {w.estHoursPerWeek != null && <span>{t('outlook.hours', { h: w.estHoursPerWeek })}</span>}
                      {w.estHoursPerWeek != null && w.sessionsTarget ? ' · ' : ''}
                      {w.sessionsTarget && <span>{t('outlook.sessions', { n: w.sessionsTarget })}</span>}
                      {!w.sessionsTarget && w.sessionsMax && <span>{`au plus ${w.sessionsMax} séances`}</span>}
                    </p>
                  </div>
                ))}
                <p className="col-span-2 text-[10px] text-ink-500 px-1">{t('outlook.hint')}</p>
              </div>
            )}
          </div>
        )}

        {/* ONGLET OBJECTIF */}
        {activeTab === 'objective' && (
          <div className="space-y-4">
            <section className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-3.5" aria-label="Objectif en cours">
              <div className="flex items-start gap-3">
                <span className="w-10 h-10 rounded-full bg-volt-500/10 text-volt-500 flex items-center justify-center shrink-0" aria-hidden="true">
                  <Flag size={19} strokeWidth={2.2} />
                </span>
                <div className="min-w-0">
                  <p className="text-[12px] text-ink-400">Objectif en cours</p>
                  <h2 className="text-[17px] font-bold text-ink-50 leading-snug">{trainingPlan?.title || 'Objectif à définir'}</h2>
                  <p className="text-[13px] text-ink-400">{formatRaceDate(trainingPlan?.date, lang)}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Stat value={raceStats.dateIsValid ? raceStats.daysLeft : '—'} label="Jours restants" />
                <Stat value={raceStats.dateIsValid ? raceStats.weeksLeft : '—'} label="Semaines" />
                <Stat value={`${raceStats.progressPct} %`} label="Progression" />
              </div>
              <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden" aria-hidden="true">
                <div className="h-full bg-volt-500 rounded-full" style={{ width: `${Math.min(100, Math.max(0, raceStats.progressPct))}%` }} />
              </div>
              {trainingPlan?.splits && (
                <div className="flex items-center justify-between text-[13px] text-ink-200 tabular-nums">
                  {[['NATATION', trainingPlan.splits.nat], ['CYCLISME', trainingPlan.splits.bike], ['C.A.P', trainingPlan.splits.run]].map(([type, v]) => (
                    <span key={type} className="inline-flex items-center gap-1.5"><SportDot type={type} size={18} /> {v}</span>
                  ))}
                </div>
              )}
            </section>

            {(constraints?.targetTime || constraints?.triathlonTimes) && (
              <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-3">
                <span className="text-[13px] font-semibold text-ink-100 block">
                  Temps visé (cible de progression)
                </span>
                <p className="text-[12px] text-ink-400 leading-relaxed">
                  C'est ce chrono, saisi au questionnaire, que le coach fait progressivement tendre tes allures/watts de
                  séance à atteindre — pas ton niveau actuel du jour.
                </p>

                {constraints.sportType === 'triathlon' ? (
                  <div className="grid grid-cols-3 gap-3">
                    {[['NATATION', 'Natation', constraints.triathlonTimes?.swim], ['CYCLISME', 'Vélo', constraints.triathlonTimes?.bike], ['C.A.P', 'Course', constraints.triathlonTimes?.run]].map(([type, label, v]) => (
                      <div key={type}>
                        <p className="text-[15px] font-semibold text-ink-50 tabular-nums">{v || '—'}</p>
                        <p className="text-[11px] text-ink-500 mt-0.5 inline-flex items-center gap-1"><SportDot type={type} size={12} /> {label}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Stat value={constraints.targetTime || '—'} label="Temps visé" />
                )}

                {profile?.targetPhysio && (profile.targetPhysio.targetVma || profile.targetPhysio.targetBikeSpeedKmh || profile.targetPhysio.targetSwimPace100) && (
                  <div className="pt-2 border-t border-ink-800 space-y-1.5">
                    <span className="text-[11px] text-ink-500 block">Niveau actuel testé → cible déduite</span>
                    {profile.targetPhysio.targetVma && (
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-ink-500">VMA</span>
                        <span className="text-ink-300">{profile.vma ?? '—'} km/h <span className="text-volt-400">→</span> {profile.targetPhysio.targetVma} km/h</span>
                      </div>
                    )}
                    {profile.targetPhysio.targetSwimPace100 && (
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-ink-500">Allure nat.</span>
                        <span className="text-ink-300">{profile.nat100 ? `${profile.nat100}/100m` : '—'} <span className="text-volt-400">→</span> {profile.targetPhysio.targetSwimPace100}/100m</span>
                      </div>
                    )}
                    {profile.targetPhysio.targetBikeSpeedKmh && (
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-ink-500">Vitesse vélo</span>
                        <span className="text-ink-300">FTP {profile.ftp ?? '—'}W <span className="text-volt-400">→</span> ~{profile.targetPhysio.targetBikeSpeedKmh} km/h visés</span>
                      </div>
                    )}
                    <p className="text-[10px] text-ink-600 leading-relaxed pt-1">
                      Certaines valeurs manquent ? Les séances de test terrain (VMA, natation, FTP vélo) placées dans ton
                      plan servent à les mesurer pour affiner cette progression.
                    </p>
                  </div>
                )}
              </div>
            )}

            {constraints && (
              <RaceTimePredictor sportType={sportType} constraints={constraints} profile={profile} stravaActivities={stravaActivities} />
            )}

            <RaceCalendar sportType={sportType} />

            <RaceExecutionPlan constraints={constraints} profile={profile} onGoToNutrition={() => { setActiveTab('tools'); setToolsSubTab('nutrition'); }} />

            {trainingPlan?.cycles?.length > 0 && (
              <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-1">
                <span className="text-[13px] font-semibold text-ink-100 block mb-1">
                  Périodisation — {trainingPlan.cycles.length} mésocycles
                </span>
                <p className="text-[10px] text-ink-500 mb-3 leading-relaxed">
                  Ta préparation s'enchaîne en plusieurs phases distinctes (base, développement, affûtage…), jamais un seul bloc uniforme.
                </p>
                <div className="relative">
                  {trainingPlan.cycles.map((c, idx) => {
                    const isLast = idx === trainingPlan.cycles.length - 1;
                    // Statut recalculé EN DIRECT à partir des dates (les plans plus anciens,
                    // sans dates enregistrées, gardent le statut d'origine).
                    const status = c.startDate && c.endDate
                      ? (todayIso > c.endDate ? 'Terminé' : todayIso >= c.startDate ? 'En cours' : 'À venir')
                      : c.status;
                    const isCurrent = status === 'En cours';
                    return (
                      <div key={c.id} className="relative flex gap-3 pb-4 last:pb-0">
                        {!isLast && (
                          <span className="absolute left-[7px] top-4 bottom-0 w-px bg-ink-700" />
                        )}
                        <span
                          className={`relative z-10 mt-0.5 shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            isCurrent
                              ? 'bg-volt-500 border-volt-300 shadow-glow-sm'
                              : status === 'Terminé'
                              ? 'bg-emerald-500 border-emerald-300'
                              : 'bg-ink-950 border-ink-600'
                          }`}
                        />
                        <div className={`flex-1 rounded-xl p-2.5 border ${isCurrent ? 'bg-volt-500/10 border-volt-500/40' : 'bg-ink-950 border-ink-800'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <p className={`font-bold text-xs ${isCurrent ? 'text-ink-50' : 'text-ink-200'}`}>{c.name}</p>
                            <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              isCurrent ? 'bg-volt-500/15 border-volt-500 text-volt-300' :
                              status === 'Terminé' ? 'bg-emerald-950 border-emerald-800 text-emerald-400' :
                              'bg-ink-900 border-ink-800 text-ink-500'
                            }`}>
                              {status}
                            </span>
                          </div>
                          <p className="text-ink-500 font-mono text-[10px] mt-0.5">{c.dates}</p>
                          {c.guidance && (
                            <p className={`text-[10px] leading-relaxed mt-1.5 pt-1.5 border-t ${
                              isCurrent ? 'text-ink-200 border-volt-500/20' : 'text-ink-500 border-ink-800'
                            }`}>
                              {c.guidance}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* RÉGLAGES DU PLAN — cycle charge/décharge, priorités, infos pour le coach.
                Modifiables sans régénérer : pris en compte par le chat et la prochaine
                génération de semaine (voir components/PlanPreferencesFields.js). */}
            {constraints && (
              <QuestionnaireSummary
                constraints={constraints}
                profile={profile}
                onEdit={() => {
                  if (!window.confirm('Refaire le questionnaire génère un nouveau plan complet. Continuer ?')) return;
                  setWizardError(null);
                  setShowWizard(true);
                }}
              />
            )}
            {constraints && (
              <PlanSettingsCard
                constraints={constraints}
                onApplyNextWeek={() => handleGenerateWeek('N+1')}
                applying={generatingWeek === 'N+1'}
                applyError={weekGenError}
                nextWeekLabel={weekNumberN1}
                onSave={(prefs) => setConstraints((prev) => ({
                  ...prev,
                  loadCycle: buildLoadCycle(prefs.loadCyclePattern || 'none', prefs.loadCycleWeek, localISODate()),
                  focusAreas: prefs.focusAreas || [],
                  coachNotes: prefs.coachNotes || '',
                  dayCaps: prefs.dayCaps || null,
                  offDays: prefs.offDays ?? prev.offDays,
                  hasExistingTrainingBase: Boolean(prefs.hasExistingTrainingBase),
                }))}
              />
            )}
          </div>
        )}

        {/* ONGLET PROFIL — données athlète + tableau de bord, sans sous-onglets */}
        {/* ONGLET PROFIL — scindé en 3 sous-onglets (Santé / Progression / Records) plutôt
            qu'un long scroll unique regroupant tout. La barre de sous-onglets est hors du
            conteneur qui défile (shrink-0 + conteneur suivant en overflow-y-auto) : elle
            reste donc visible en descendant dans les données, sans jamais prendre plus de
            place qu'une seule ligne de boutons — même principe que l'onglet Chat plus bas
            (hauteur contrainte à la fenêtre, défilement interne). */}
        {activeTab === 'profile' && (
          <div className="flex flex-col h-[calc(100vh-170px)]">
            <div className="shrink-0 mb-3">
              <ProfileIdentityCard
                profile={profile}
                email={session?.user?.email}
                notifications={isSupabaseConfigured && session ? <NotificationBell accessToken={session?.access_token} /> : null}
                onOpenSettings={() => setShowSettings(true)}
              />
            </div>
            <div className="shrink-0 mb-3">
              <UnderlineTabs ariaLabel="Profil" value={profileSubTab} onChange={setProfileSubTab} tabs={PROFILE_SUB_TABS} />
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1 pb-4">
              {profileSubTab === 'health' && (
                <>
                  <ProfileHealth profile={profile} onProfileChange={handleProfileChange} sportType={sportType} onRequestLighten={handleHrvLighten} stravaActivities={stravaActivities} session={session} />
                  <InjuryJournal />
                  <CycleTracker />
                </>
              )}

              {/* Progression & charge d'entraînement — déplacé depuis l'onglet Objectif : ces
                  graphes (charge/forme réelle + volume hebdo) parlent du suivi de la
                  progression au quotidien, pas de l'objectif/course en lui-même, donc leur
                  place naturelle est l'onglet Profil avec le reste du tableau de bord. */}
              {profileSubTab === 'progress' && (
                <>
                  <TrainingLoadChart activities={stravaActivities} profile={profile} workouts={workouts} />
                  <WeeklyProgressChart activities={stravaActivities} />
                  <PerformanceDashboard profile={profile} workouts={workouts} feedbackHistory={feedbackHistory} sportType={sportType} stravaActivities={stravaActivities} onPaceZonesChange={handlePaceZonesChange} />
                </>
              )}

              {/* Records — déplacé depuis l'onglet Outils (voir TOOLS_SUB_TABS plus haut) :
                  c'est une donnée de suivi de l'athlète dans le temps, à sa place naturelle
                  aux côtés de Santé et Progression. */}
              {profileSubTab === 'records' && (
                <PerformanceRecords session={session} profile={profile} onProfileChange={handleProfileChange} sportType={sportType} stravaActivities={stravaActivities} />
              )}
            </div>
          </div>
        )}

        {/* ONGLET CHAT */}
        {activeTab === 'chat' && (
          <div className="space-y-3 flex flex-col h-[calc(100vh-170px)]">
            {(() => {
              // Indicateur de tendance discret : la donnée influence déjà le prompt IA
              // en coulisses (voir lib/gemini.js), mais n'était jamais montrée à l'athlète.
              const trend = summarizeFeedbackTrend(feedbackHistory);
              if (trend.sampleSize < 3) return null;
              const arrow = trend.direction === 'harder' ? '↑' : trend.direction === 'easier' ? '↓' : '→';
              const color = trend.direction === 'harder' ? 'text-amber-400' : trend.direction === 'easier' ? 'text-emerald-400' : 'text-ink-400';
              return (
                <div className="flex justify-end">
                  <span title={trend.label} className={`text-[11px] font-semibold ${color} bg-ink-900 px-2.5 py-1 rounded-full`}>
                    Ressenti {arrow}
                  </span>
                </div>
              );
            })()}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {messages.map((m, idx) => (
                <ChatMessage
                  key={idx}
                  text={m.text}
                  sender={m.sender}
                  collapsedLabel={t('chat.showDetails')}
                  expandedLabel={t('chat.hideDetails')}
                />
              ))}
              {chatLoading && (
                <div className="text-xs font-mono text-volt-400 animate-pulse flex items-center gap-2">
                  <span>🤖</span> {t('chat.thinking')}
                </div>
              )}
              {/* Chips de réponse rapide sous la dernière réponse du coach : évite de
                  retaper une phrase à chaque ajustement, réutilise les intents add/modify
                  déjà gérés par sendCoachMessage/chatWithCoach. */}
              {!chatLoading && messages.length > 0 && messages[messages.length - 1].sender === 'coach' && smartSuggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {smartSuggestions.map((qr) => (
                    <button
                      key={qr.label}
                      type="button"
                      onClick={() => sendCoachMessage(qr.text, { intent: qr.intent, displayText: qr.label })}
                      className="text-[13px] font-semibold px-3.5 min-h-[36px] rounded-full border border-volt-500/40 text-volt-500 transition-colors"
                    >
                      {qr.label}
                    </button>
                  ))}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Type de demande">
              {CHAT_INTENTS.map((ci) => {
                const I = ci === 'add' ? CirclePlus : Pencil;
                return (
                  <button
                    key={ci}
                    type="button"
                    aria-pressed={chatIntent === ci}
                    onClick={() => setChatIntent(chatIntent === ci ? null : ci)}
                    className={`shrink-0 min-h-[34px] px-3 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
                      chatIntent === ci ? 'bg-ink-50 text-ink-950' : 'bg-ink-900 border border-ink-800 text-ink-300'
                    }`}
                  >
                    <I size={14} aria-hidden="true" />
                    {t(`chat.${ci === 'add' ? 'addIntent' : 'modifyIntent'}`)}
                  </button>
                );
              })}
              <button
                type="button"
                aria-pressed={showFeedbackPicker}
                onClick={() => setShowFeedbackPicker((v) => !v)}
                className={`shrink-0 min-h-[34px] px-3 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
                  showFeedbackPicker ? 'bg-ink-50 text-ink-950' : 'bg-ink-900 border border-ink-800 text-ink-300'
                }`}
              >
                <MessageSquareText size={14} aria-hidden="true" />
                {t('chat.feedbackBtn')}
              </button>
            </div>

            {/* Panneau de sélection de séance pour donner un ressenti depuis le chat :
                réutilise le formulaire de validation déjà existant dans WorkoutDetail
                (ouvert via setSelectedWorkout, exactement comme un clic au calendrier) —
                donc le ressenti alimente feedbackHistory et donc les prompts IA (chat +
                génération de plan) comme n'importe quelle autre validation. */}
            {showFeedbackPicker && (
              <div className="bg-ink-900 border border-ink-800 rounded-xl p-3 space-y-2">
                <p className="text-[13px] font-semibold text-ink-100">{t('chat.feedbackPickTitle')}</p>
                {feedbackEligibleWorkouts.length === 0 ? (
                  <p className="text-[11px] text-ink-500">{t('chat.feedbackNone')}</p>
                ) : (
                  <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto">
                    {feedbackEligibleWorkouts.map((w) => (
                      <button
                        key={w.__week + '-' + w.id}
                        type="button"
                        onClick={() => { setSelectedWorkout(w); setShowFeedbackPicker(false); }}
                        className="text-left text-[11px] px-2.5 py-2 rounded-lg bg-ink-950 border border-ink-800 text-ink-200 hover:border-volt-500/50 transition-all"
                      >
                        {formatWorkoutSummary(w, lang)} <span className="text-ink-500 font-mono">({w.__week})</span>
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setShowFeedbackPicker(false)}
                  className="text-[10px] text-ink-500 underline"
                >
                  {t('chat.feedbackClose')}
                </button>
              </div>
            )}

            <form onSubmit={handleSendMessage} className="flex items-center gap-2 bg-ink-900 border border-ink-800 rounded-full pl-4 pr-1.5 py-1.5 focus-within:border-volt-500">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder={t('chat.placeholder')}
                aria-label="Message au coach"
                className="flex-1 min-w-0 bg-transparent text-[14px] text-ink-50 placeholder-ink-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={chatLoading}
                aria-label={t('common.send')}
                className="w-[38px] h-[38px] rounded-full bg-volt-500 text-white flex items-center justify-center disabled:opacity-50 active:scale-95 transition-transform shrink-0"
              >
                <SendHorizontal size={18} aria-hidden="true" />
              </button>
            </form>
          </div>
        )}

      </main>

      {/* BARRE D'ONGLETS FIXE EN BAS — remplace l'ancien bandeau sous le header : c'est le
          geste le plus reconnaissable d'une app mobile native (Instagram, Strava, etc.),
          contrairement à des onglets en haut qui donnent l'impression d'un site web dans
          un cadre. `pb-safe-b` respecte la zone d'accueil des iPhone à encoche/Face ID. */}
      <QuickActions open={quickOpen} onClose={() => setQuickOpen(false)} onAction={handleQuickAction} />
      <BottomNav
        activeTab={activeTab}
        onChange={(tab) => { setQuickOpen(false); setActiveTab(tab); }}
        labels={{ today: t('tabs.today'), calendar: t('tabs.calendar'), objective: t('tabs.objective'), chat: t('tabs.chat') }}
        actionsOpen={quickOpen}
        onToggleActions={() => setQuickOpen((o) => !o)}
      />

      {showWizard && (
        <WizardModal
          isOpen
          onClose={() => setShowWizard(false)}
          onComplete={handleWizardComplete}
          submitting={wizardSubmitting}
          submitError={wizardError}
        />
      )}

      <WorkoutDetail
        workout={selectedWorkout}
        onClose={() => setSelectedWorkout(null)}
        existingFeedback={selectedWorkout ? [...feedbackHistory].reverse().find((f) => f.workoutId === selectedWorkout.id) : null}
        pendingAdjustment={pendingAdjustment}
        onSubmitFeedback={handleSubmitFeedback}
        onLightenWeek={handleLightenWeek}
        onKeepAsIs={handleKeepAsIs}
      />

      {selectedActivity && (
        <ActivityDetail
          activity={selectedActivity}
          session={session}
          workouts={workouts}
          onClose={() => setSelectedActivity(null)}
          onActivityUpdated={(updated) => {
            setSelectedActivity(updated);
            setStravaActivities((prev) => prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)));
          }}
        />
      )}

      {stravaToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-ink-900 border border-ink-700 text-ink-50 text-xs font-bold px-4 py-2.5 rounded-xl shadow-2xl">
          {stravaToast}
        </div>
      )}

    </div>
  );
}
