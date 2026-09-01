import React, { useEffect, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '../lib/storage';
import { summarizeHrvTrend, summarizeSleepTrend } from '../lib/feedback';
import { estimatePhysiologyFromActivities } from '../lib/zones';
import { WEARABLE_PROVIDERS, buildWearableAuthUrl, isWearableClientConfigured } from '../lib/wearablesClient';

// "m:ss" -> secondes, pour comparer deux allures CSS entre elles (voir
// autoUpdateFromActivities plus bas). `null` si le format est invalide/absent plutôt que
// de planter — une valeur nat100 mal saisie à la main ne doit jamais faire planter l'app.
function swimPaceToSeconds(str) {
  const m = String(str || '').match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const METRICS = [
  { key: 'weight', label: 'Poids', unit: 'kg', color: '#FC4C02' },
  { key: 'fcRepos', label: 'FC repos', unit: 'bpm', color: '#F03D00' },
  { key: 'vfc', label: 'VFC (HRV)', unit: 'ms', color: '#34D399' },
  { key: 'sleepHours', label: 'Sommeil', unit: 'h', color: '#818CF8' },
  { key: 'fcMax', label: 'FC max', unit: 'bpm', color: '#F43F5E' },
  { key: 'vma', label: 'VMA', unit: 'km/h', color: '#FBBF24' },
  { key: 'ftp', label: 'FTP', unit: 'W', color: '#22D3EE', hideForRunning: true },
];

export default function ProfileHealth({ profile, onProfileChange, sportType = 'triathlon', onRequestLighten, stravaActivities = [], session }) {
  const [history, setHistory] = useState([]);
  const [selectedMetrics, setSelectedMetrics] = useState(['weight']);
  const [entryDate, setEntryDate] = useState('');
  const [entryValue, setEntryValue] = useState('');
  // Édition d'une case métrique (crayon ✏️) — séparée de `selectedMetrics` : une case peut
  // à nouveau servir UNIQUEMENT à choisir la courbe du graphique (clic sur la case) tant
  // qu'elle n'est pas en édition ; `editingMetric` contient la clé (METRICS[].key, ou
  // 'nat100') actuellement en cours de modification, ou null si aucune case n'est éditée.
  const [editingMetric, setEditingMetric] = useState(null);
  const [draftValue, setDraftValue] = useState('');
  // Point 2 — Auto-régulation VFC (HRV) : évite de renvoyer plusieurs fois la même
  // demande d'allègement tant que le signal de fatigue reste actif (une seule
  // proposition par "épisode" de baisse) ; se réinitialise dès que la tendance
  // n'est plus 'low' (nouvelle mesure encourageante, ou fatigue qui s'estompe).
  const [lightenRequested, setLightenRequested] = useState(false);
  // Petit message discret affiché après une mise à jour AUTOMATIQUE (voir l'effet
  // autoUpdateFromActivities plus bas) — pour que l'athlète comprenne pourquoi sa FTP/VMA/
  // CSS a changé sans qu'il y touche, plutôt qu'un changement silencieux qui pourrait
  // sembler être un bug. Disparaît de lui-même (pas besoin d'action de l'athlète).
  const [autoUpdateNotice, setAutoUpdateNotice] = useState('');

  const visibleMetrics = METRICS.filter((m) => !(sportType === 'running' && m.hideForRunning));
  const missingMetrics = visibleMetrics.filter((m) => profile[m.key] === null || profile[m.key] === undefined || profile[m.key] === '');
  const nat100Missing = sportType !== 'running' && !profile.nat100;

  // Signal de fatigue VFC (voir lib/feedback.js:summarizeHrvTrend) — déjà utilisé côté
  // serveur pour influencer le prompt IA lors d'une génération/ajustement de plan (voir
  // lib/gemini.js), mais jamais montré ni exploitable directement par l'athlète tant
  // qu'il ne demandait pas lui-même un ajustement au chat. Ici on le rend PASSIF : dès
  // qu'une baisse notable est détectée depuis les mesures déjà saisies, on le signale
  // et on propose un allègement en un tap, sans attendre une séance ratée pour le déclencher.
  const hrvTrend = summarizeHrvTrend(history);
  const sleepTrend = summarizeSleepTrend(history);

  // Point 3 — Récupération auto (HRV/sommeil) : état de la connexion Whoop/Oura. Voir
  // pages/api/wearables/*.js. `wearableStatus`: 'loading' | 'connected' | 'disconnected'.
  const [wearableStatus, setWearableStatus] = useState('loading');
  const [wearableProvider, setWearableProvider] = useState(null);
  const [wearableSyncing, setWearableSyncing] = useState(false);
  const [wearableMessage, setWearableMessage] = useState('');
  const [wearableError, setWearableError] = useState('');

  useEffect(() => {
    if (!session?.access_token) { setWearableStatus('disconnected'); return; }
    let cancelled = false;
    fetch('/api/wearables/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: session.access_token }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setWearableStatus(data?.connected ? 'connected' : 'disconnected');
        setWearableProvider(data?.provider || null);
      })
      .catch(() => { if (!cancelled) setWearableStatus('disconnected'); });
    return () => { cancelled = true; };
  }, [session?.access_token]);

  const handleWearableConnect = (providerId) => {
    if (!session?.access_token) return;
    const redirectUri = `${window.location.origin}/api/wearables/callback`;
    window.location.href = buildWearableAuthUrl({ providerId, redirectUri, state: `${session.access_token}::${providerId}` });
  };

  const handleWearableDisconnect = async () => {
    if (!session?.access_token) return;
    setWearableSyncing(true);
    try {
      await fetch('/api/wearables/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token }),
      });
      setWearableStatus('disconnected');
      setWearableProvider(null);
      setWearableMessage('');
    } finally {
      setWearableSyncing(false);
    }
  };

  // Va chercher HRV + sommeil des 14 derniers jours et les fusionne dans healthHistory
  // (upsert par date, comme le reste du fichier) + met à jour la valeur "actuelle" du
  // profil (dernier jour dispo) — remplace la saisie manuelle par une mesure automatique,
  // sans empêcher l'athlète de continuer à corriger à la main si besoin (voir
  // commitMetricValue plus bas, toujours actif).
  const handleWearableSync = async () => {
    if (!session?.access_token) return;
    setWearableSyncing(true);
    setWearableError('');
    setWearableMessage('');
    try {
      const res = await fetch('/api/wearables/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setWearableError(json?.error || 'La synchronisation a échoué.'); return; }

      const days = (json?.days || []).filter((d) => d?.date);
      if (days.length === 0) { setWearableMessage("Aucune donnée disponible pour l'instant côté fournisseur."); return; }

      setHistory((prev) => {
        let next = prev;
        days.forEach((d) => {
          if (Number.isFinite(d.vfcMs)) next = [...next.filter((h) => !(h.metric === 'vfc' && h.date === d.date)), { date: d.date, metric: 'vfc', value: d.vfcMs, source: json.provider }];
          if (Number.isFinite(d.sleepHours)) next = [...next.filter((h) => !(h.metric === 'sleepHours' && h.date === d.date)), { date: d.date, metric: 'sleepHours', value: d.sleepHours, source: json.provider }];
        });
        next = next.sort((a, b) => new Date(a.date) - new Date(b.date));
        saveToStorage(STORAGE_KEYS.healthHistory, next);
        return next;
      });

      const latest = [...days].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
      const profileUpdates = {};
      if (Number.isFinite(latest?.vfcMs)) profileUpdates.vfc = latest.vfcMs;
      if (Number.isFinite(latest?.sleepHours)) profileUpdates.sleepHours = latest.sleepHours;
      if (Object.keys(profileUpdates).length > 0) onProfileChange({ ...profileRef.current, ...profileUpdates });

      setWearableMessage(`✅ ${days.length} jour(s) synchronisé(s) depuis ${json.provider === 'whoop' ? 'Whoop' : 'Oura'}.`);
    } catch {
      setWearableError('La synchronisation a échoué. Vérifie ta connexion.');
    } finally {
      setWearableSyncing(false);
    }
  };

  useEffect(() => {
    if (hrvTrend.direction !== 'low') setLightenRequested(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hrvTrend.direction]);

  useEffect(() => {
    setHistory(loadFromStorage(STORAGE_KEYS.healthHistory, []));
    setEntryDate(new Date().toISOString().slice(0, 10));
  }, []);

  // `profile` change à chaque écriture (y compris celles faites par CET effet ci-dessous),
  // donc on le lit depuis une ref plutôt que de le mettre en dépendance de l'effet — sinon
  // boucle de re-déclenchement inutile. L'effet reste néanmoins idempotent : une fois la
  // meilleure valeur détectée déjà appliquée, un nouveau passage recalcule exactement la
  // même estimation et ne déclenche donc plus aucune écriture.
  const profileRef = useRef(profile);
  useEffect(() => { profileRef.current = profile; }, [profile]);

  // Détection AUTOMATIQUE de FTP / VMA / CSS natation depuis les vraies séances Strava
  // synchronisées (voir lib/zones.js:estimatePhysiologyFromActivities, même protocole
  // "test de 20 minutes" déjà utilisé pour les zones auto en mode Réglages > "Zones
  // d'entraînement" > Automatique) — jusqu'ici ce calcul restait cantonné à ZoneCharts.js
  // et n'était JAMAIS reporté sur le profil lui-même, donc les métriques clés du
  // Planificateur/coach IA (lib/physiology.js) ne bénéficiaient jamais d'une séance Strava
  // même excellente tant que l'athlète ne ressaisissait pas la valeur à la main.
  // RÈGLE : on ne met à jour QUE si c'est une amélioration (FTP/VMA plus hauts, CSS plus
  // rapide) par rapport à la valeur déjà connue du profil — jamais de dégradation
  // automatique sur la foi d'une seule sortie facile/récup, cohérent avec la philosophie
  // "jamais de valeur inventée ni dégradée sans que l'athlète le décide" de lib/physiology.js.
  // Une valeur encore vide est toujours acceptée (rien à dégrader).
  useEffect(() => {
    if (!Array.isArray(stravaActivities) || stravaActivities.length === 0) return;
    const estimates = estimatePhysiologyFromActivities(stravaActivities);
    const currentProfile = profileRef.current || {};
    const updates = {};
    const historyEntries = [];

    if (estimates.ftp && (!currentProfile.ftp || estimates.ftp.value > Number(currentProfile.ftp))) {
      updates.ftp = estimates.ftp.value;
      historyEntries.push({ date: String(estimates.ftp.basedOn.date).slice(0, 10), metric: 'ftp', value: estimates.ftp.value });
    }
    if (estimates.vma && (!currentProfile.vma || estimates.vma.value > Number(currentProfile.vma))) {
      updates.vma = estimates.vma.value;
      historyEntries.push({ date: String(estimates.vma.basedOn.date).slice(0, 10), metric: 'vma', value: estimates.vma.value });
    }
    if (estimates.nat100) {
      const estSec = swimPaceToSeconds(estimates.nat100.value);
      const currentSec = swimPaceToSeconds(currentProfile.nat100);
      if (estSec && (!currentSec || estSec < currentSec)) {
        updates.nat100 = estimates.nat100.value;
        // Pas de courbe de tendance pour la CSS (allure texte "m:ss", pas une métrique
        // numérique du graphe METRICS ci-dessus) — seule la valeur actuelle du profil
        // est mise à jour, comme pour une saisie manuelle dans la case CSS natation.
      }
    }

    if (Object.keys(updates).length > 0) {
      onProfileChange({ ...currentProfile, ...updates });
      const labels = { ftp: 'FTP', vma: 'VMA', nat100: 'CSS natation' };
      const updatedLabels = Object.keys(updates).map((k) => labels[k] || k);
      setAutoUpdateNotice(`📈 ${updatedLabels.join(', ')} mis à jour automatiquement depuis Strava (nouveau record détecté).`);
      const timeoutId = setTimeout(() => setAutoUpdateNotice(''), 8000);
      // Pas de cleanup formel du timeout (effet non ré-exécuté avant longtemps, voir
      // commentaire d'idempotence ci-dessus) — impact négligeable si le composant
      // démonte entre-temps (juste un setState ignoré par React).
      void timeoutId;
    }
    if (historyEntries.length > 0) {
      setHistory((prev) => {
        let next = prev;
        historyEntries.forEach((entry) => {
          // upsert sur (métrique, date de la séance source) — même logique que
          // commitMetricValue plus bas, pour qu'une meilleure estimation détectée plus
          // tard pour la même séance remplace le point plutôt que d'en empiler un autre.
          next = [...next.filter((h) => !(h.metric === entry.metric && h.date === entry.date)), entry];
        });
        next = next.sort((a, b) => new Date(a.date) - new Date(b.date));
        saveToStorage(STORAGE_KEYS.healthHistory, next);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stravaActivities]);

  // Clic : sélection simple = 1 entrée ; un 2e clic superpose une 2e courbe (double entrée).
  const toggleMetric = (key) => {
    setSelectedMetrics((prev) => {
      if (prev.includes(key)) {
        return prev.length > 1 ? prev.filter((k) => k !== key) : prev;
      }
      if (prev.length >= 2) return [prev[1], key];
      return [...prev, key];
    });
  };

  const addEntry = () => {
    if (!entryValue || !entryDate) return;
    const value = Number(entryValue);
    if (!Number.isFinite(value)) return;
    const targetMetric = selectedMetrics[selectedMetrics.length - 1];

    const nextHistory = [...history, { date: entryDate, metric: targetMetric, value }]
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    setHistory(nextHistory);
    saveToStorage(STORAGE_KEYS.healthHistory, nextHistory);
    onProfileChange({ ...profile, [targetMetric]: value });
    setEntryValue('');
  };

  // Ouvre le mode édition d'une case (crayon ✏️) : tant qu'une case n'est pas en édition,
  // cliquer dessus sert à la sélectionner comme courbe du graphique (toggleMetric) — la
  // saisie ne se fait qu'après un tap explicite sur le crayon, pour ne plus faire porter
  // les deux actions (sélectionner / modifier) au même geste.
  const startEditing = (key, currentValue) => {
    setEditingMetric(key);
    setDraftValue(currentValue === null || currentValue === undefined ? '' : String(currentValue));
  };

  const cancelEditing = () => {
    setEditingMetric(null);
    setDraftValue('');
  };

  // Valide la saisie (bouton ✓ ou touche Entrée) — rien n'est enregistré pendant la
  // frappe, uniquement à la confirmation, contrairement à l'ancien comportement qui
  // écrivait au blur (sujet à des enregistrements accidentels en cliquant ailleurs).
  const confirmEditing = (key) => {
    if (key === 'nat100') {
      const trimmed = draftValue.trim();
      onProfileChange({ ...profile, nat100: trimmed || null });
    } else {
      commitMetricValue(key, draftValue);
    }
    setEditingMetric(null);
    setDraftValue('');
  };

  // BUG RÉEL CORRIGÉ PAR LE PASSÉ (répété plusieurs fois par l'athlète, notamment sur la
  // FC) : la SEULE façon de changer une valeur actuelle (FC max, FC repos, VMA…) passait
  // par 3 étapes séparées — taper sur la case pour la "sélectionner" comme cible du
  // graphique, descendre jusqu'au formulaire "Saisie manuelle" plus bas, y retaper la
  // valeur, puis cliquer "Ajouter". La correction directe-dans-la-case (tout le champ
  // éditable au clic) a ensuite cassé la sélection de courbe (les deux actions se
  // disputaient le même clic) — d'où le mode édition explicite (crayon + ✓) ci-dessus :
  // la case sert de nouveau UNIQUEMENT à sélectionner tant qu'on ne clique pas sur ✏️.
  const commitMetricValue = (key, rawValue) => {
    const trimmed = String(rawValue ?? '').trim();
    if (trimmed === '') {
      if (profile[key] === null || profile[key] === undefined || profile[key] === '') return;
      onProfileChange({ ...profile, [key]: null });
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return; // saisie invalide (ex: lettres) : ignorée, rien n'est perdu
    if (profile[key] === value) return; // valeur inchangée : pas de sauvegarde/push cloud inutile

    onProfileChange({ ...profile, [key]: value });

    // Log automatiquement la mesure du jour dans l'historique (pour le graphe de
    // tendance) — upsert sur (métrique, date du jour) pour qu'une correction plus tard
    // dans la même journée remplace le point existant plutôt que d'empiler un doublon.
    const today = new Date().toISOString().slice(0, 10);
    setHistory((prev) => {
      const withoutToday = prev.filter((h) => !(h.metric === key && h.date === today));
      const next = [...withoutToday, { date: today, metric: key, value }].sort((a, b) => new Date(a.date) - new Date(b.date));
      saveToStorage(STORAGE_KEYS.healthHistory, next);
      return next;
    });
  };

  const activeMetrics = selectedMetrics.map((k) => METRICS.find((m) => m.key === k)).filter(Boolean);
  const allDates = [...new Set(history.filter((h) => selectedMetrics.includes(h.metric)).map((h) => h.date))].sort(
    (a, b) => new Date(a) - new Date(b)
  );

  const chartData = {
    labels: allDates.map((d) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(new Date(d))),
    datasets: activeMetrics.map((m, i) => ({
      label: `${m.label} (${m.unit})`,
      data: allDates.map((d) => history.find((h) => h.metric === m.key && h.date === d)?.value ?? null),
      borderColor: m.color,
      backgroundColor: `${m.color}33`,
      tension: 0.3,
      spanGaps: true,
      yAxisID: i === 0 ? 'y' : 'y1',
    })),
  };

  const chartOptions = {
    responsive: true,
    plugins: { legend: { display: activeMetrics.length > 1, labels: { color: '#565D67', font: { size: 10 } } } },
    scales: {
      y: { position: 'left', ticks: { color: activeMetrics[0]?.color || '#565D67' } },
      ...(activeMetrics.length > 1
        ? { y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: activeMetrics[1]?.color } } }
        : {}),
    },
  };

  const totalPoints = history.filter((h) => selectedMetrics.includes(h.metric)).length;

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-4 text-ink-100">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">Profil & données santé</span>
        <span className="text-[9px] text-ink-500">Touche une case = 1 courbe (2 cases = superposition) · ✏️ pour modifier une valeur</span>
      </div>

      {autoUpdateNotice && (
        <div className="p-3 rounded-xl border border-emerald-800/60 bg-emerald-950/30 text-emerald-300 text-[11px] leading-relaxed">
          {autoUpdateNotice}
        </div>
      )}

      {(missingMetrics.length > 0 || nat100Missing) && (
        <div className="p-3 rounded-xl border border-amber-800/60 bg-amber-950/30 text-amber-300 text-[11px] leading-relaxed">
          ⚠️ {missingMetrics.length + (nat100Missing ? 1 : 0)} donnée(s) non renseignée(s)
          ({[...missingMetrics.map((m) => m.label), ...(nat100Missing ? ['CSS natation'] : [])].join(', ')}).
          Pense à les remplir au fur et à mesure (ci-dessous, ou lors de la génération d'un nouveau plan) :
          tant qu'elles sont vides, le coach IA reste volontairement prudent et évite de calculer des allures/puissances précises pour ces disciplines.
        </div>
      )}

      {/* Point 3 — Récupération auto (HRV/sommeil) : connexion Whoop/Oura, voir
          lib/wearablesClient.js + pages/api/wearables/*.js. Garmin non proposé ici (OAuth
          1.0a + accord partenaire requis, voir lib/wearablesServer.js) — l'athlète équipé
          Garmin continue de saisir sa VFC à la main dans les cases ci-dessous. */}
      <div className="p-3 rounded-xl border border-ink-800 bg-ink-950 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-ink-400 uppercase font-bold">💍 Récupération automatique (VFC/sommeil)</span>
          {wearableStatus === 'connected' && (
            <span className="text-[9px] text-emerald-400">● {wearableProvider === 'whoop' ? 'Whoop' : 'Oura'} connecté</span>
          )}
        </div>
        {wearableError && <p className="text-[10px] text-amber-400">{wearableError}</p>}
        {wearableMessage && <p className="text-[10px] text-emerald-400">{wearableMessage}</p>}

        {wearableStatus === 'connected' ? (
          <div className="flex gap-2">
            <button onClick={handleWearableSync} disabled={wearableSyncing} className="flex-1 bg-volt-500 hover:bg-volt-400 text-ink-50 font-bold text-[11px] px-3 py-2 rounded-xl min-h-tap disabled:opacity-60">
              {wearableSyncing ? 'Synchronisation…' : '↻ Synchroniser maintenant'}
            </button>
            <button onClick={handleWearableDisconnect} disabled={wearableSyncing} className="bg-ink-900 border border-ink-800 text-ink-400 font-bold text-[11px] px-3 py-2 rounded-xl min-h-tap">
              Déconnecter
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            {WEARABLE_PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => handleWearableConnect(p.id)}
                disabled={!isWearableClientConfigured(p.id) || !session?.access_token}
                title={!isWearableClientConfigured(p.id) ? 'Non configuré côté serveur (voir WEARABLES_SETUP.md)' : undefined}
                className="flex-1 border border-ink-800 hover:border-ink-700 text-ink-100 font-bold text-[11px] px-3 py-2 rounded-xl min-h-tap disabled:opacity-40"
                style={{ color: p.color }}
              >
                Connecter {p.name}
              </button>
            ))}
          </div>
        )}
        <p className="text-[9px] text-ink-600">Remplace la saisie manuelle de VFC/sommeil ci-dessous par une synchronisation automatique quotidienne. Équipé Garmin : la saisie manuelle reste disponible juste en dessous.</p>
      </div>

      {sleepTrend.direction === 'low' && sleepTrend.sampleSize >= 3 && (
        <div className="p-3 rounded-xl border border-amber-800/60 bg-amber-950/30 text-amber-300 text-[11px] leading-relaxed">
          😴 {sleepTrend.label}
        </div>
      )}

      {hrvTrend.direction === 'low' && (
        <div className="p-3 rounded-xl border border-amber-800/60 bg-amber-950/30 text-amber-300 text-[11px] leading-relaxed space-y-2">
          <p>⚠️ {hrvTrend.label}</p>
          {lightenRequested ? (
            <p className="text-emerald-400 font-bold">✅ Demande envoyée au coach — va voir l'onglet Chat.</p>
          ) : (
            <button
              onClick={() => { onRequestLighten?.(hrvTrend); setLightenRequested(true); }}
              className="w-full bg-amber-500 hover:bg-amber-400 text-ink-950 font-bold px-3 py-2 rounded-xl text-[11px] uppercase min-h-tap"
            >
              Demander un allègement de la semaine
            </button>
          )}
        </div>
      )}

      {/* Menus des métriques — deux modes bien distincts par case :
          - Repos (par défaut) : la case entière est cliquable pour choisir la/les
            courbe(s) affichées dans le graphe (1 ou 2 clics, voir toggleMetric). La
            valeur est affichée en lecture seule.
          - Édition (après un tap sur ✏️) : la case affiche un champ de saisie + un
            bouton ✓ pour valider — la sélection de courbe est désactivée tant que la
            case est en édition, pour ne plus faire porter les deux gestes au même clic. */}
      <div className="grid grid-cols-3 sm:grid-cols-3 gap-2">
        {visibleMetrics.map((m) => {
          const rank = selectedMetrics.indexOf(m.key);
          const hasValue = profile[m.key] !== null && profile[m.key] !== undefined && profile[m.key] !== '';
          const isEditing = editingMetric === m.key;
          return (
            <div
              key={m.key}
              onClick={() => { if (!isEditing) toggleMetric(m.key); }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (!isEditing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleMetric(m.key); } }}
              className={`p-2.5 rounded-xl border text-left transition-all relative ${isEditing ? 'cursor-default' : 'cursor-pointer'} ${
                isEditing
                  ? 'border-volt-500 bg-ink-950'
                  : rank !== -1
                  ? 'border-volt-500/60 bg-volt-500/10'
                  : 'border-ink-800 bg-ink-950 hover:border-ink-700'
              }`}
            >
              {!isEditing && rank !== -1 && (
                <span className="absolute top-1 right-1.5 text-[9px] font-bold text-volt-400">{rank + 1}</span>
              )}
              <div className="flex items-center justify-between gap-1">
                <span className="text-[9px] text-ink-500 uppercase flex items-center gap-1 min-w-0">
                  <span className="truncate">{m.label}</span>
                  {m.key === 'vfc' && hrvTrend.sampleSize >= 3 && (
                    <span
                      title={hrvTrend.label}
                      className={`text-[10px] shrink-0 ${
                        hrvTrend.direction === 'low' ? 'text-amber-400' : hrvTrend.direction === 'high' ? 'text-emerald-400' : 'text-ink-500'
                      }`}
                    >
                      {hrvTrend.direction === 'low' ? '↓' : hrvTrend.direction === 'high' ? '↑' : '→'}
                    </span>
                  )}
                </span>
                {!isEditing && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); startEditing(m.key, profile[m.key]); }}
                    aria-label={`Modifier ${m.label}`}
                    title={`Modifier ${m.label}`}
                    className="shrink-0 text-[11px] text-ink-500 hover:text-volt-400 leading-none p-0.5"
                  >
                    ✏️
                  </button>
                )}
              </div>

              {isEditing ? (
                <div className="flex items-center gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    autoFocus
                    value={draftValue}
                    onChange={(e) => setDraftValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); confirmEditing(m.key); }
                      if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
                    }}
                    placeholder="Valeur"
                    className="w-0 flex-1 min-w-0 bg-ink-900 border border-ink-800 rounded-lg px-1.5 py-1 text-sm font-bold font-mono text-ink-50 placeholder-ink-600 focus:outline-none focus:border-volt-500"
                  />
                  <button
                    type="button"
                    onClick={() => confirmEditing(m.key)}
                    aria-label="Valider"
                    title="Valider"
                    className="shrink-0 bg-volt-500 hover:bg-volt-400 text-white font-bold text-xs w-6 h-6 rounded-lg flex items-center justify-center"
                  >
                    ✓
                  </button>
                </div>
              ) : (
                <div className="flex items-baseline gap-1">
                  <span
                    className={`text-sm font-bold font-mono ${hasValue ? '' : 'text-ink-600 italic font-normal text-xs'}`}
                    style={hasValue ? { color: m.color } : undefined}
                  >
                    {hasValue ? profile[m.key] : 'Non renseigné'}
                  </span>
                  {hasValue && <span className="text-[9px] text-ink-500 shrink-0">{m.unit}</span>}
                </div>
              )}
            </div>
          );
        })}
        {sportType !== 'running' && (() => {
          const isEditingNat100 = editingMetric === 'nat100';
          return (
            <div className={`p-2.5 rounded-xl border ${isEditingNat100 ? 'border-volt-500' : 'border-ink-800'} bg-ink-950`}>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[9px] text-ink-500 uppercase">CSS natation</span>
                {!isEditingNat100 && (
                  <button
                    type="button"
                    onClick={() => startEditing('nat100', profile.nat100)}
                    aria-label="Modifier CSS natation"
                    title="Modifier CSS natation"
                    className="shrink-0 text-[11px] text-ink-500 hover:text-volt-400 leading-none p-0.5"
                  >
                    ✏️
                  </button>
                )}
              </div>
              {isEditingNat100 ? (
                <div className="flex items-center gap-1 mt-1">
                  <input
                    type="text"
                    autoFocus
                    value={draftValue}
                    onChange={(e) => setDraftValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); confirmEditing('nat100'); }
                      if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
                    }}
                    placeholder="m:ss / 100m"
                    className="w-0 flex-1 min-w-0 bg-ink-900 border border-ink-800 rounded-lg px-1.5 py-1 text-sm font-bold font-mono text-cyan-400 placeholder-ink-600 focus:outline-none focus:border-volt-500"
                  />
                  <button
                    type="button"
                    onClick={() => confirmEditing('nat100')}
                    aria-label="Valider"
                    title="Valider"
                    className="shrink-0 bg-volt-500 hover:bg-volt-400 text-white font-bold text-xs w-6 h-6 rounded-lg flex items-center justify-center"
                  >
                    ✓
                  </button>
                </div>
              ) : (
                <span className={`text-sm font-bold font-mono ${profile.nat100 ? 'text-cyan-400' : 'text-ink-600 italic font-normal text-xs'}`}>
                  {profile.nat100 || 'Non renseigné'}
                </span>
              )}
            </div>
          );
        })()}
      </div>

      {/* Graphe d'évolution (1 ou 2 courbes superposées) */}
      <div className="bg-ink-950 border border-ink-800 rounded-xl p-3">
        {totalPoints > 1 ? (
          <Line data={chartData} options={chartOptions} />
        ) : (
          <p className="text-xs text-ink-500 text-center py-6">
            Ajoute au moins 2 mesures pour voir l'évolution de {activeMetrics.map((m) => m.label.toLowerCase()).join(' / ')}.
          </p>
        )}
      </div>

      {/* Saisie D'UNE DATE PASSÉE pour la courbe de tendance (cible la dernière métrique
          sélectionnée ci-dessus) — pour la valeur ACTUELLE, tape directement dans la case
          correspondante plus haut, c'est immédiat. Ce formulaire sert uniquement à
          compléter l'historique avec une mesure d'un autre jour (ex : pesée d'il y a une
          semaine) sans changer la valeur du jour affichée dans les cases. */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-[10px] text-ink-400 block mb-1">Date (mesure passée)</label>
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="w-full bg-ink-950 border border-ink-800 rounded-xl p-2 text-xs text-ink-50"
          />
        </div>
        <div className="flex-1">
          <label className="text-[10px] text-ink-400 block mb-1">
            {activeMetrics[activeMetrics.length - 1]?.label} ({activeMetrics[activeMetrics.length - 1]?.unit})
          </label>
          <input
            type="number"
            step="0.1"
            value={entryValue}
            onChange={(e) => setEntryValue(e.target.value)}
            className="w-full bg-ink-950 border border-ink-800 rounded-xl p-2 text-xs text-ink-50"
            placeholder="ex: 70.5"
          />
        </div>
        <button
          onClick={addEntry}
          className="bg-volt-500 hover:bg-volt-400 text-ink-50 font-bold text-xs px-4 py-2 rounded-xl min-h-tap"
        >
          Ajouter
        </button>
      </div>
    </div>
  );
}
