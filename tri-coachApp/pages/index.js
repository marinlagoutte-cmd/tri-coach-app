import { useState, useEffect, useRef, useMemo } from 'react';
import CalendarView from '../components/CalendarView';
import ChatMessage from '../components/ChatMessage';
import WorkoutDetail from '../components/WorkoutDetail';
import WizardModal from '../components/WizardModal';
import ProfileHealth from '../components/ProfileHealth';
import TirePressureCalculator from '../components/TirePressureCalculator';
import EquipmentTracker from '../components/EquipmentTracker';
import PerformanceDashboard from '../components/PerformanceDashboard';
import NutritionPanel from '../components/NutritionPanel';
import WeatherPanel from '../components/WeatherPanel';
import ActivityDetail from '../components/ActivityDetail';
import TrainingLoadChart from '../components/TrainingLoadChart';
import WeeklyProgressChart from '../components/WeeklyProgressChart';
import RaceExecutionPlan from '../components/RaceExecutionPlan';
import { STORAGE_KEYS, loadFromStorage, saveToStorage, setStorageSaveHook } from '../lib/storage';
import { DEFAULT_PROFILE, DEFAULT_TRAINING_PLAN, DEFAULT_WORKOUTS, EMPTY_TRAINING_PLAN, EMPTY_WORKOUTS } from '../lib/defaults';
import { computeRaceStats, shortLabel, sanitizeWorkout } from '../lib/workouts';
import { analyzeFeedback, summarizeFeedbackTrend } from '../lib/feedback';
import { getWeeksOutlook, getWeekLabel } from '../lib/periodization';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { setCloudUser, fetchAndMergeCloudData, queueCloudPush, pushCloudDataNow, flushCloudPushOnHide } from '../lib/cloudSync';
import AuthScreen from '../components/AuthScreen';
import AccountMenu from '../components/AccountMenu';
import SettingsModal from '../components/SettingsModal';
import { useI18n, translateDayName, intlLocale } from '../lib/i18n';

// Labels traduits via t('tabs.<id>') au rendu — id/icon restent fixes (id utilisé
// pour la logique d'onglet actif, jamais affiché tel quel).
// ATTENTION : Nutrition et Météo ne sont plus des onglets principaux (voir plus bas, fusionnés
// en sous-onglets de "tools") — 5 onglets principaux au lieu de 6.
const TABS = [
  { id: 'tools', icon: '🧰' },
  { id: 'calendar', icon: '📅' },
  { id: 'objective', icon: '🎯' },
  { id: 'profile', icon: '⚙️' },
  { id: 'chat', icon: '💬' },
];

// Sous-onglets de l'onglet Outils (nutrition/météo/pression pneus) — état séparé
// de `activeTab`, simple navigation locale à cet onglet.
const TOOLS_SUB_TABS = ['nutrition', 'weather', 'tirePressure', 'equipment'];

// Un objectif CAP/Trail n'affiche jamais les filtres BIKE/SWIM — cohérence avec l'objectif choisi.
// Et si une seule discipline est possible, le bouton "TOUT" est redondant (il affiche
// exactement la même chose que le filtre unique) donc on ne l'ajoute pas.
function getSportFilters(sportType) {
  if (sportType === 'running') {
    return [{ id: 'RUN', label: 'RUN' }];
  }
  return [
    { id: 'ALL', label: 'TOUT' },
    { id: 'SWIM', label: 'SWIM' },
    { id: 'BIKE', label: 'BIKE' },
    { id: 'RUN', label: 'RUN' },
  ];
}

const CHAT_INTENTS = ['add', 'modify'];
const CHAT_QUICK_REPLIES = [
  { label: 'Alléger la prochaine séance', text: 'Peux-tu alléger ma prochaine séance non validée ?', intent: 'modify' },
  { label: 'Décaler à demain', text: 'Peux-tu décaler ma prochaine séance à demain ?', intent: 'modify' },
  { label: 'Pourquoi cette allure ?', text: 'Pourquoi as-tu choisi cette allure pour ma prochaine séance ?', intent: null },
];

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

export default function Home() {
  const { t, lang } = useI18n();
  const [activeTab, setActiveTab] = useState('calendar');
  // Sous-onglet de l'onglet Outils — Nutrition, Météo, ou Pression pneus (le Profil &
  // données santé a désormais son propre onglet principal, voir plus bas). Séparé de
  // `activeTab` : ce n'est pas un onglet de la barre principale, juste une sous-navigation
  // locale à cet onglet.
  const [toolsSubTab, setToolsSubTab] = useState('nutrition');
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
    const metricsChanged = ['vma', 'ftp', 'nat100'].some((k) => profile[k] !== nextProfile[k]);
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
      N: (prev.N || []).map((w) => sanitizeWorkout(w, profileWithPaceZones)),
      'N+1': (prev['N+1'] || []).map((w) => sanitizeWorkout(w, profileWithPaceZones)),
    }));
  };

  const [selectedWorkout, setSelectedWorkout] = useState(null);
  const [showFeedbackPicker, setShowFeedbackPicker] = useState(false);
  const [feedbackHistory, setFeedbackHistory] = useState([]);
  const [pendingAdjustment, setPendingAdjustment] = useState(null);
  const [onboarded, setOnboarded] = useState(true); // true par défaut le temps de l'hydratation, pour ne pas flasher le wizard inutilement
  const [showSettings, setShowSettings] = useState(false);

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

  // Si l'objectif change pour un format sans vélo/nat, on retombe sur le premier filtre valide.
  useEffect(() => {
    if (!sportFilters.find((f) => f.id === sportFilter)) setSportFilter(sportFilters[0]?.id || 'ALL');
  }, [sportFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  // On ne filtre plus la liste ici : CalendarView a besoin de connaître TOUTES les
  // séances de la semaine (pas seulement celles du sport choisi) pour pouvoir
  // distinguer un vrai jour de repos d'un jour où une autre discipline est prévue.
  // Le filtrage par sport est donc appliqué à l'intérieur de CalendarView via `sportFilter`.
  // Numéros de semaine calendaire réels affichés au lieu de "N"/"N+1" — voir
  // lib/periodization.js:getWeekLabel. `activeWeek` ('N'/'N+1') reste la clé de données
  // interne (workouts, patches, storage...), seul l'AFFICHAGE change.
  const weekNumberN = useMemo(() => getWeekLabel(0), []);
  const weekNumberN1 = useMemo(() => getWeekLabel(1), []);

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

  // Aperçu déterministe (pas d'appel IA) des semaines N+2/N+3, pour anticiper au-delà
  // des 2 semaines réellement générées par le coach — voir lib/periodization.js.
  const weeksOutlook = useMemo(
    () => getWeeksOutlook(constraints?.targetDate, constraints),
    [constraints]
  );

  // --- RÉGÉNÉRATION FORCÉE D'UNE SEULE SEMAINE (bouton "Forcer la régénération") -------
  // Contrairement à handleWizardComplete (/api/generate-plan) qui régénère N ET N+1 ET
  // l'objectif entier (remet à zéro chat/feedback), cette action ne touche QUE la semaine
  // choisie : utile quand l'athlète a un doute sur sa cohérence (nombre de séances,
  // séances empilées le même jour, brick mal placé...) sans vouloir tout recommencer.
  const [regeneratingWeek, setRegeneratingWeek] = useState(null);
  const [regenerateError, setRegenerateError] = useState(null);
  const [regenerateErrorWeek, setRegenerateErrorWeek] = useState(null);

  const handleForceRegenerateWeek = async (weekKey) => {
    if (regeneratingWeek) return;
    setRegeneratingWeek(weekKey);
    setRegenerateError(null);
    setRegenerateErrorWeek(null);
    try {
      const healthHistory = loadFromStorage(STORAGE_KEYS.healthHistory, []);
      const paceZones = loadFromStorage(STORAGE_KEYS.paceZones, null);
      const res = await fetch('/api/regenerate-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekKey,
          profile,
          workouts,
          trainingPlan,
          constraints,
          feedbackHistory,
          healthHistory,
          manualPaceZones: paceZones,
          language: lang,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la régénération de la semaine.');

      setWorkouts(data.workouts);
      if (data.profile) setProfile((prev) => ({ ...prev, ...data.profile }));

      const weekLabel = weekKey === 'N' ? weekNumberN : weekNumberN1;
      let coachMsg = `🔁 **Semaine ${weekLabel} régénérée** à ta demande, en gardant l'autre semaine et le reste du plan inchangés.`;
      if (data.qualityWarnings?.length) {
        coachMsg += `\n\n⚠️ ${data.qualityWarnings.join('\n⚠️ ')}`;
      }
      setMessages((prev) => [...prev, { sender: 'coach', text: coachMsg }]);
    } catch (err) {
      console.error('Erreur régénération semaine:', err);
      setRegenerateError(err.message || 'Erreur lors de la régénération de la semaine.');
      setRegenerateErrorWeek(weekKey);
    } finally {
      setRegeneratingWeek(null);
    }
  };

  // --- GÉNÉRATION D'UN NOUVEAU PLAN VIA L'ASSISTANT ---
  const handleWizardComplete = async (wizardData) => {
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
      const res = await fetch('/api/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wizardData, profile, feedbackHistory, healthHistory, manualPaceZones: paceZones, language: lang }),
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
      });
      setShowWizard(false);
      setActiveTab('calendar');
      setOnboarded(true);

      const coachMsg = `🎯 **Nouveau plan généré !**\n\n- **Objectif** : ${data.trainingPlan?.title || wizardData.eventName || 'Nouvel objectif'}\n- **Volume hebdo** : ~${wizardData.hoursPerWeek}h/semaine sur ${wizardData.maxSessionsPerWeek} séances\n\nLes semaines N et N+1 ont été calées sur tes métriques actuelles.`;
      setMessages((prev) => [...prev, { sender: 'coach', text: coachMsg }]);

      // Deux blobs distincts et lisibles plutôt qu'un seul paragraphe technique :
      // - "points de vigilance" = rien n'a été corrigé, ça reste à traiter (toi ou le coach via le chat) ;
      // - "ajustements automatiques" = déjà corrigé par la relecture IA, pure transparence, aucune action requise.
      if (data.coherenceWarnings?.length) {
        const bullets = data.coherenceWarnings.map((w) => `- ${w}`).join('\n');
        setMessages((prev) => [
          ...prev,
          {
            sender: 'coach',
            text: `⚠️ **Points de vigilance sur ce plan** (rien n'est cassé, mais à surveiller) :\n${bullets}\n\nDis-moi si tu veux que j'ajuste une séance en particulier.`,
          },
        ]);
      }
      if (data.autoFixNotes?.length) {
        const bullets = data.autoFixNotes.map((w) => `- ${w}`).join('\n');
        setMessages((prev) => [
          ...prev,
          {
            sender: 'coach',
            text: `🔧 **Ajustements automatiques faits par le coach** (déjà appliqués, pour info) :\n${bullets}`,
          },
        ]);
      }
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
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, profile, workouts, trainingPlan, intent, sportType, constraints, feedbackHistory, healthHistory, manualPaceZones: paceZones, language: lang }),
      });
      const data = await res.json();

      const nextMessages = [...newHistory];

      if (data.updatedWorkouts) {
        // Séances modifiées : on affiche clairement AVANT (ancienne) au-dessus de APRÈS (nouvelle).
        const allNew = [...(data.updatedWorkouts.N || []), ...(data.updatedWorkouts['N+1'] || [])];
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
    const analysis = analyzeFeedback(workout, { difficulty, capacity }, feedbackHistory);
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
    <div className="min-h-screen bg-ink-950 text-ink-100 font-body flex flex-col pb-[calc(4.75rem+env(safe-area-inset-bottom))] antialiased">

      {/* HEADER — pt- supplémentaire pour ne pas passer sous l'encoche/la barre de statut
          une fois l'app lancée en plein écran (mode "standalone" installé). Volontairement
          minimal (logo + actions de compte) : les onglets vivent désormais dans la barre
          fixe en bas de l'écran, comme sur une app native, au lieu de s'empiler ici sous
          forme de deuxième bandeau — c'était le principal signal "site web dans un cadre". */}
      <header className="sticky top-0 z-30 bg-ink-900/90 backdrop-blur-md border-b border-ink-800 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-volt-500 to-flare-500 flex items-center justify-center font-black text-xs text-white shadow-glow-sm">
            TC
          </div>
          <h1 className="text-sm font-black tracking-tight text-ink-50 flex items-center gap-1.5 font-display">
            TRI<span className="text-volt-400">COACH</span>
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {isSupabaseConfigured && session && (
            <AccountMenu
              session={session}
              cloudSyncing={cloudSyncing}
              onSignOut={handleSignOut}
              onOpenSettings={() => setShowSettings(true)}
            />
          )}
          {isSupabaseConfigured && !session && skippedAuth && (
            <button
              onClick={() => setSkippedAuth(false)}
              className="text-[10px] font-bold text-ink-400 border border-ink-800 bg-ink-950 px-2.5 py-1.5 rounded-xl"
            >
              {t('header.login')}
            </button>
          )}
          <button
            onClick={() => {
              const hasExistingPlan = Boolean(trainingPlan?.cycles?.length || workouts?.N?.length);
              if (hasExistingPlan && !window.confirm(t('header.confirmNewPlan'))) return;
              setWizardError(null);
              setShowWizard(true);
            }}
            className="text-xs font-bold bg-gradient-to-r from-volt-500 to-flare-500 hover:from-volt-400 hover:to-flare-400 text-white px-3 py-1.5 rounded-xl shadow-glow-sm transition-all flex items-center gap-1 active:scale-95"
          >
            <span>+</span>
            <span className="hidden sm:inline">{t('header.newPlanFull')}</span>
            <span className="sm:hidden">{t('header.newPlan')}</span>
          </button>
          <button
            onClick={() => {
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
            className="text-xs font-bold text-ink-400 border border-ink-800 bg-ink-950 hover:bg-ink-900 px-2.5 py-1.5 rounded-xl transition-all active:scale-95"
            title={t('header.deletePlanTitle')}
          >
            🗑
          </button>
        </div>
      </header>

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        session={session}
        onSignOut={handleSignOut}
        onStravaSynced={refreshStravaActivities}
      />

      {/* Liseré tri-spectrum (nat/vélo/course) : signature visuelle discrète de l'app,
          rappel des 3 disciplines juste sous le header — jamais utilisé ailleurs comme
          simple décoration, uniquement ici et sur la timeline des macrocycles. */}
      <div className="h-[3px] w-full bg-tri-spectrum opacity-70 shrink-0" />

      <main key={activeTab} className="flex-1 max-w-md w-full mx-auto p-4 space-y-4 animate-fadeIn">

        {/* ONGLET OUTILS — sous-onglets Nutrition / Météo / Pression pneus */}
        {activeTab === 'tools' && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-1 bg-ink-900 border border-ink-800 rounded-2xl p-1">
              {TOOLS_SUB_TABS.map((sub) => (
                <button
                  key={sub}
                  onClick={() => setToolsSubTab(sub)}
                  className={`py-2 rounded-xl text-[11px] font-bold transition-colors ${
                    toolsSubTab === sub ? 'bg-volt-500 text-white' : 'text-ink-400'
                  }`}
                >
                  {sub === 'tirePressure' ? t('tools.tirePressureSubTab')
                    : sub === 'equipment' ? t('tools.equipmentSubTab')
                    : t(`tabs.${sub}`)}
                </button>
              ))}
            </div>

            {toolsSubTab === 'nutrition' && (
              <NutritionPanel profile={profile} trainingPlan={trainingPlan} workouts={workouts} sportType={sportType} constraints={constraints} />
            )}
            {toolsSubTab === 'weather' && <WeatherPanel />}
            {toolsSubTab === 'tirePressure' && <TirePressureCalculator />}
            {toolsSubTab === 'equipment' && <EquipmentTracker session={session} />}
          </div>
        )}

        {/* ONGLET CALENDRIER */}
        {activeTab === 'calendar' && (
          <div className="space-y-4">
            <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-ink-400 uppercase tracking-wider font-semibold">
                  Sélecteur de semaine
                </span>
                <div className="flex bg-ink-950 border border-ink-800 rounded-xl p-0.5">
                  <button
                    onClick={() => setActiveWeek('N')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      activeWeek === 'N' ? 'bg-volt-500 text-white' : 'text-ink-400'
                    }`}
                  >
                    Semaine {weekNumberN}
                  </button>
                  <button
                    onClick={() => setActiveWeek('N+1')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      activeWeek === 'N+1' ? 'bg-volt-500 text-white' : 'text-ink-400'
                    }`}
                  >
                    Semaine {weekNumberN1}
                  </button>
                </div>
              </div>

              <div className="flex gap-1.5 overflow-x-auto">
                {sportFilters.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setSportFilter(f.id)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap border transition-all ${
                      sportFilter === f.id
                        ? 'bg-volt-500/10 border-volt-500 text-volt-400'
                        : 'bg-ink-950 border-ink-800 text-ink-400'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <CalendarView
              weekKey={activeWeek}
              weekNumber={activeWeek === 'N' ? weekNumberN : weekNumberN1}
              workouts={weekWorkouts}
              sportFilter={sportFilter}
              onSelectWorkout={setSelectedWorkout}
              validatedIds={new Set(feedbackHistory.map((f) => f.workoutId))}
              activities={stravaActivities}
              onSelectActivity={setSelectedActivity}
            />

            {/* Bouton "forcer la génération" — demandé explicitement : l'athlète doit pouvoir
                déclencher une régénération complète d'une semaine à la demande quand il a un
                doute sur sa cohérence (nombre de séances, doublons, bricks mal placés...),
                sans attendre un message chat et sans toucher à l'autre semaine ni à son
                historique de chat/feedback. Voir handleForceRegenerateWeek + pages/api/regenerate-week.js. */}
            <button
              onClick={() => handleForceRegenerateWeek(activeWeek)}
              disabled={regeneratingWeek === activeWeek}
              className="w-full py-2.5 rounded-2xl border border-ink-800 bg-ink-900 text-xs font-bold text-ink-300 hover:border-volt-500/50 hover:text-volt-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {regeneratingWeek === activeWeek ? (
                <>⏳ Régénération de la semaine {activeWeek === 'N' ? weekNumberN : weekNumberN1} en cours…</>
              ) : (
                <>🔁 Forcer la régénération de la semaine {activeWeek === 'N' ? weekNumberN : weekNumberN1}</>
              )}
            </button>
            {regenerateError && activeWeek === regenerateErrorWeek && (
              <p className="text-[11px] text-red-400 text-center -mt-2">{regenerateError}</p>
            )}

            {weeksOutlook.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {weeksOutlook.map((w) => (
                  <div key={w.label} className="bg-ink-900 border border-ink-800 rounded-2xl p-3 space-y-1">
                    <span className="text-[10px] font-mono font-bold uppercase text-volt-400 bg-volt-500/10 border border-volt-500/20 px-2 py-0.5 rounded-md">
                      {t('outlook.title', { label: w.label })}
                    </span>
                    <p className="text-xs font-bold text-ink-50 pt-1">{w.phaseName}</p>
                    <p className="text-[10px] text-ink-500">{w.weekStartLabel}</p>
                    <p className="text-[11px] font-mono text-ink-300">
                      {w.estHoursPerWeek != null && <span>{t('outlook.hours', { h: w.estHoursPerWeek })}</span>}
                      {w.estHoursPerWeek != null && w.sessionsTarget ? ' · ' : ''}
                      {w.sessionsTarget && <span>{t('outlook.sessions', { n: w.sessionsTarget })}</span>}
                    </p>
                  </div>
                ))}
                <p className="col-span-2 text-[9px] text-ink-500 px-1">{t('outlook.hint')}</p>
              </div>
            )}
          </div>
        )}

        {/* ONGLET OBJECTIF */}
        {activeTab === 'objective' && (
          <div className="space-y-4">
            <div className="relative overflow-hidden bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-3">
              <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-volt-600/20 blur-3xl pointer-events-none" />
              <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">Objectif en cours</span>
              <h2 className="text-lg font-black text-ink-50 font-display">{trainingPlan?.title || 'Objectif à définir'}</h2>
              <p className="text-xs text-ink-400 font-mono">{formatRaceDate(trainingPlan?.date, lang)}</p>

              <div className="grid grid-cols-3 gap-2 text-center pt-2">
                <div className="bg-ink-950 border border-ink-800 rounded-xl p-2.5">
                  <span className="text-[9px] text-ink-500 uppercase block">Jours restants</span>
                  <span className="text-base font-black text-volt-400 font-mono">{raceStats.dateIsValid ? raceStats.daysLeft : '—'}</span>
                </div>
                <div className="bg-ink-950 border border-ink-800 rounded-xl p-2.5">
                  <span className="text-[9px] text-ink-500 uppercase block">Semaines</span>
                  <span className="text-base font-black text-ink-50 font-mono">{raceStats.dateIsValid ? raceStats.weeksLeft : '—'}</span>
                </div>
                <div className="bg-ink-950 border border-ink-800 rounded-xl p-2.5">
                  <span className="text-[9px] text-ink-500 uppercase block">Progression</span>
                  <span className="text-base font-black text-flare-400 font-mono">{raceStats.progressPct}%</span>
                </div>
              </div>

              {trainingPlan?.splits && (
                <div className="grid grid-cols-3 gap-2 text-center pt-1 text-[11px] font-mono">
                  <div><span className="text-cyan-400 block">🏊 {trainingPlan.splits.nat}</span></div>
                  <div><span className="text-amber-400 block">🚴 {trainingPlan.splits.bike}</span></div>
                  <div><span className="text-emerald-400 block">🏃 {trainingPlan.splits.run}</span></div>
                </div>
              )}
            </div>

            {(constraints?.targetTime || constraints?.triathlonTimes) && (
              <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-3">
                <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">
                  🎯 Temps visé — ta cible de progression
                </span>
                <p className="text-[10px] text-ink-500 leading-relaxed">
                  C'est ce chrono, saisi au questionnaire, que le coach fait progressivement tendre tes allures/watts de
                  séance à atteindre — pas ton niveau actuel du jour.
                </p>

                {constraints.sportType === 'triathlon' ? (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-ink-950 border border-ink-800 rounded-xl p-2.5">
                      <span className="text-[9px] text-cyan-400 uppercase block">🏊 Nat.</span>
                      <span className="text-sm font-black text-ink-50 font-mono">{constraints.triathlonTimes?.swim || '—'}</span>
                    </div>
                    <div className="bg-ink-950 border border-ink-800 rounded-xl p-2.5">
                      <span className="text-[9px] text-amber-400 uppercase block">🚴 Vélo</span>
                      <span className="text-sm font-black text-ink-50 font-mono">{constraints.triathlonTimes?.bike || '—'}</span>
                    </div>
                    <div className="bg-ink-950 border border-ink-800 rounded-xl p-2.5">
                      <span className="text-[9px] text-emerald-400 uppercase block">🏃 Course</span>
                      <span className="text-sm font-black text-ink-50 font-mono">{constraints.triathlonTimes?.run || '—'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="bg-ink-950 border border-ink-800 rounded-xl p-2.5 text-center">
                    <span className="text-[9px] text-emerald-400 uppercase block">🏃 Temps visé</span>
                    <span className="text-base font-black text-ink-50 font-mono">{constraints.targetTime || '—'}</span>
                  </div>
                )}

                {profile?.targetPhysio && (profile.targetPhysio.targetVma || profile.targetPhysio.targetBikeSpeedKmh || profile.targetPhysio.targetSwimPace100) && (
                  <div className="pt-2 border-t border-ink-800 space-y-1.5">
                    <span className="text-[9px] text-ink-500 uppercase block">Niveau actuel testé → cible déduite</span>
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
                    <p className="text-[9px] text-ink-600 leading-relaxed pt-1">
                      Certaines valeurs manquent ? Les séances de test terrain (VMA, natation, FTP vélo) placées dans ton
                      plan servent à les mesurer pour affiner cette progression.
                    </p>
                  </div>
                )}
              </div>
            )}

            <RaceExecutionPlan constraints={constraints} profile={profile} onGoToNutrition={() => { setActiveTab('tools'); setToolsSubTab('nutrition'); }} />

            {trainingPlan?.cycles?.length > 0 && (
              <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-1">
                <span className="text-[10px] font-mono text-ink-400 uppercase tracking-widest block mb-1">
                  Périodisation — {trainingPlan.cycles.length} mésocycles
                </span>
                <p className="text-[10px] text-ink-500 mb-3 leading-relaxed">
                  Ta préparation s'enchaîne en plusieurs phases distinctes (base, développement, affûtage…), jamais un seul bloc uniforme.
                </p>
                <div className="relative">
                  {trainingPlan.cycles.map((c, idx) => {
                    const isLast = idx === trainingPlan.cycles.length - 1;
                    const isCurrent = c.status === 'En cours';
                    return (
                      <div key={c.id} className="relative flex gap-3 pb-4 last:pb-0">
                        {!isLast && (
                          <span className="absolute left-[7px] top-4 bottom-0 w-px bg-ink-700" />
                        )}
                        <span
                          className={`relative z-10 mt-0.5 shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            isCurrent
                              ? 'bg-volt-500 border-volt-300 shadow-glow-sm'
                              : c.status === 'Terminé'
                              ? 'bg-emerald-500 border-emerald-300'
                              : 'bg-ink-950 border-ink-600'
                          }`}
                        />
                        <div className={`flex-1 rounded-xl p-2.5 border ${isCurrent ? 'bg-volt-500/10 border-volt-500/40' : 'bg-ink-950 border-ink-800'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <p className={`font-bold text-xs ${isCurrent ? 'text-ink-50' : 'text-ink-200'}`}>{c.name}</p>
                            <span className={`shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                              isCurrent ? 'bg-volt-500/15 border-volt-500 text-volt-300' :
                              c.status === 'Terminé' ? 'bg-emerald-950 border-emerald-800 text-emerald-400' :
                              'bg-ink-900 border-ink-800 text-ink-500'
                            }`}>
                              {c.status}
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
          </div>
        )}

        {/* ONGLET PROFIL — données athlète + tableau de bord, sans sous-onglets */}
        {activeTab === 'profile' && (
          <div className="space-y-4">
            <ProfileHealth profile={profile} onProfileChange={handleProfileChange} sportType={sportType} onRequestLighten={handleHrvLighten} />

            {/* Progression & charge d'entraînement — déplacé depuis l'onglet Objectif : ces
                deux graphes (charge/forme réelle + volume hebdo) parlent du suivi de la
                progression au quotidien, pas de l'objectif/course en lui-même, donc leur
                place naturelle est l'onglet Profil avec le reste du tableau de bord. */}
            <TrainingLoadChart activities={stravaActivities} profile={profile} workouts={workouts} />
            <WeeklyProgressChart activities={stravaActivities} />

            <PerformanceDashboard profile={profile} workouts={workouts} feedbackHistory={feedbackHistory} sportType={sportType} stravaActivities={stravaActivities} onPaceZonesChange={handlePaceZonesChange} />
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
                  <span title={trend.label} className={`text-[10px] font-mono font-bold ${color} bg-ink-950 border border-ink-800 px-2 py-1 rounded-full`}>
                    Ressenti {arrow}
                  </span>
                </div>
              );
            })()}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {messages.map((m, idx) => (
                <ChatMessage key={idx} text={m.text} sender={m.sender} />
              ))}
              {chatLoading && (
                <div className="text-xs font-mono text-volt-400 animate-pulse flex items-center gap-2">
                  <span>🤖</span> {t('chat.thinking')}
                </div>
              )}
              {/* Chips de réponse rapide sous la dernière réponse du coach : évite de
                  retaper une phrase à chaque ajustement, réutilise les intents add/modify
                  déjà gérés par sendCoachMessage/chatWithCoach. */}
              {!chatLoading && messages.length > 0 && messages[messages.length - 1].sender === 'coach' && (
                <div className="flex flex-wrap gap-1.5">
                  {CHAT_QUICK_REPLIES.map((qr) => (
                    <button
                      key={qr.label}
                      type="button"
                      onClick={() => sendCoachMessage(qr.text, { intent: qr.intent, displayText: qr.label })}
                      className="text-[10px] font-bold px-2.5 py-1.5 rounded-full border border-ink-800 bg-ink-950 text-ink-300 hover:border-volt-500/50 hover:text-volt-400 transition-all"
                    >
                      {qr.label}
                    </button>
                  ))}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="flex gap-1.5">
              {CHAT_INTENTS.map((ci) => (
                <button
                  key={ci}
                  type="button"
                  onClick={() => setChatIntent(chatIntent === ci ? null : ci)}
                  className={`flex-1 text-[10px] font-bold px-2 py-2 rounded-xl border transition-all ${
                    chatIntent === ci
                      ? 'bg-volt-500/10 border-volt-500 text-volt-400'
                      : 'bg-ink-950 border-ink-800 text-ink-400'
                  }`}
                >
                  {t(`chat.${ci === 'add' ? 'addIntent' : 'modifyIntent'}`)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowFeedbackPicker((v) => !v)}
                className={`flex-1 text-[10px] font-bold px-2 py-2 rounded-xl border transition-all ${
                  showFeedbackPicker
                    ? 'bg-volt-500/10 border-volt-500 text-volt-400'
                    : 'bg-ink-950 border-ink-800 text-ink-400'
                }`}
              >
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
                <p className="text-[10px] font-bold uppercase text-ink-400">{t('chat.feedbackPickTitle')}</p>
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

            <form onSubmit={handleSendMessage} className="flex space-x-2 pt-2">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder={t('chat.placeholder')}
                className="flex-1 bg-ink-900 border border-ink-800 rounded-xl px-3.5 py-2.5 text-xs text-ink-50 placeholder-ink-500 focus:border-volt-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={chatLoading}
                className="bg-volt-500 hover:bg-volt-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95"
              >
                {t('common.send')}
              </button>
            </form>
          </div>
        )}

      </main>

      {/* BARRE D'ONGLETS FIXE EN BAS — remplace l'ancien bandeau sous le header : c'est le
          geste le plus reconnaissable d'une app mobile native (Instagram, Strava, etc.),
          contrairement à des onglets en haut qui donnent l'impression d'un site web dans
          un cadre. `pb-safe-b` respecte la zone d'accueil des iPhone à encoche/Face ID. */}
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-ink-900/95 backdrop-blur-md border-t border-ink-800 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-md mx-auto grid grid-cols-5 px-1 pt-1.5">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative flex flex-col items-center justify-center gap-0.5 py-1.5 min-h-tap"
              >
                {isActive && (
                  <span className="absolute top-0 h-0.5 w-6 rounded-full bg-volt-500" />
                )}
                <span className={`text-lg leading-none transition-transform ${isActive ? 'scale-110' : 'opacity-70'}`}>
                  {tab.icon}
                </span>
                <span className={`text-[9px] font-bold leading-none truncate max-w-full px-0.5 ${
                  isActive ? 'text-volt-400' : 'text-ink-500'
                }`}>
                  {t(`tabs.${tab.id}`)}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

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
