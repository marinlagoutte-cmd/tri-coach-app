import React, { useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '../lib/storage';
import { summarizeHrvTrend } from '../lib/feedback';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const METRICS = [
  { key: 'weight', label: 'Poids', unit: 'kg', color: '#FC4C02' },
  { key: 'fcRepos', label: 'FC repos', unit: 'bpm', color: '#F03D00' },
  { key: 'vfc', label: 'VFC (HRV)', unit: 'ms', color: '#34D399' },
  { key: 'fcMax', label: 'FC max', unit: 'bpm', color: '#F43F5E' },
  { key: 'vma', label: 'VMA', unit: 'km/h', color: '#FBBF24' },
  { key: 'ftp', label: 'FTP', unit: 'W', color: '#22D3EE', hideForRunning: true },
];

export default function ProfileHealth({ profile, onProfileChange, sportType = 'triathlon', onRequestLighten }) {
  const [history, setHistory] = useState([]);
  const [selectedMetrics, setSelectedMetrics] = useState(['weight']);
  const [entryDate, setEntryDate] = useState('');
  const [entryValue, setEntryValue] = useState('');
  // Point 2 — Auto-régulation VFC (HRV) : évite de renvoyer plusieurs fois la même
  // demande d'allègement tant que le signal de fatigue reste actif (une seule
  // proposition par "épisode" de baisse) ; se réinitialise dès que la tendance
  // n'est plus 'low' (nouvelle mesure encourageante, ou fatigue qui s'estompe).
  const [lightenRequested, setLightenRequested] = useState(false);

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

  useEffect(() => {
    if (hrvTrend.direction !== 'low') setLightenRequested(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hrvTrend.direction]);

  useEffect(() => {
    setHistory(loadFromStorage(STORAGE_KEYS.healthHistory, []));
    setEntryDate(new Date().toISOString().slice(0, 10));
  }, []);

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

  // BUG RÉEL CORRIGÉ (répété plusieurs fois par l'athlète, notamment sur la FC) : la
  // SEULE façon de changer une valeur actuelle (FC max, FC repos, VMA…) passait par 3
  // étapes séparées — taper sur la case pour la "sélectionner" comme cible du graphique,
  // descendre jusqu'au formulaire "Saisie manuelle" plus bas, y retaper la valeur, puis
  // cliquer "Ajouter". Rien n'indiquait clairement ce lien case-sélectionnée → champ du
  // bas, donc taper directement une nouvelle valeur (en pensant que ça suffisait, ou sur
  // la mauvaise case restée sélectionnée d'une session précédente) ne sauvegardait rien
  // côté FC. Chaque case est maintenant éditable DIRECTEMENT (même principe que le champ
  // CSS natation juste à côté, qui lui fonctionnait déjà ainsi) : on tape la valeur, on
  // quitte le champ (Tab/clic ailleurs) ou on appuie sur Entrée, et c'est enregistré tout
  // de suite — plus d'étape intermédiaire à deviner.
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
        <span className="text-[9px] text-ink-500">Tape une valeur dans une case pour l'enregistrer · 1 clic = 1 courbe · 2 clics = superposition</span>
      </div>

      {(missingMetrics.length > 0 || nat100Missing) && (
        <div className="p-3 rounded-xl border border-amber-800/60 bg-amber-950/30 text-amber-300 text-[11px] leading-relaxed">
          ⚠️ {missingMetrics.length + (nat100Missing ? 1 : 0)} donnée(s) non renseignée(s)
          ({[...missingMetrics.map((m) => m.label), ...(nat100Missing ? ['CSS natation'] : [])].join(', ')}).
          Pense à les remplir au fur et à mesure (ci-dessous, ou lors de la génération d'un nouveau plan) :
          tant qu'elles sont vides, le coach IA reste volontairement prudent et évite de calculer des allures/puissances précises pour ces disciplines.
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

      {/* Menus des métriques — chaque case reste cliquable pour choisir la/les courbe(s)
          affichées dans le graphe (1 ou 2 clics, voir toggleMetric), MAIS la valeur
          elle-même est maintenant modifiable directement dans la case (voir
          commitMetricValue plus haut) : plus besoin de passer par le formulaire du bas
          pour changer la valeur ACTUELLE. `stopPropagation` sur l'input évite qu'y
          taper déclenche aussi la sélection de courbe du conteneur parent. */}
      <div className="grid grid-cols-3 sm:grid-cols-3 gap-2">
        {visibleMetrics.map((m) => {
          const rank = selectedMetrics.indexOf(m.key);
          const hasValue = profile[m.key] !== null && profile[m.key] !== undefined && profile[m.key] !== '';
          return (
            <div
              key={m.key}
              onClick={() => toggleMetric(m.key)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMetric(m.key); } }}
              className={`p-2.5 rounded-xl border text-left transition-all relative cursor-pointer ${
                rank !== -1
                  ? 'border-volt-500/60 bg-volt-500/10'
                  : 'border-ink-800 bg-ink-950 hover:border-ink-700'
              }`}
            >
              {rank !== -1 && (
                <span className="absolute top-1 right-1.5 text-[9px] font-bold text-volt-400">{rank + 1}</span>
              )}
              <span className="text-[9px] text-ink-500 uppercase flex items-center gap-1">
                {m.label}
                {m.key === 'vfc' && hrvTrend.sampleSize >= 3 && (
                  <span
                    title={hrvTrend.label}
                    className={`text-[10px] ${
                      hrvTrend.direction === 'low' ? 'text-amber-400' : hrvTrend.direction === 'high' ? 'text-emerald-400' : 'text-ink-500'
                    }`}
                  >
                    {hrvTrend.direction === 'low' ? '↓' : hrvTrend.direction === 'high' ? '↑' : '→'}
                  </span>
                )}
              </span>
              <div className="flex items-baseline gap-1">
                <input
                  key={`${m.key}-${profile[m.key] ?? 'empty'}`}
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  defaultValue={profile[m.key] ?? ''}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => commitMetricValue(m.key, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                  placeholder="Non renseigné"
                  className="w-0 flex-1 min-w-0 bg-transparent text-sm font-bold font-mono placeholder-ink-600 placeholder:text-xs placeholder:italic placeholder:font-normal focus:outline-none"
                  style={hasValue ? { color: m.color } : undefined}
                />
                {hasValue && <span className="text-[9px] text-ink-500 shrink-0">{m.unit}</span>}
              </div>
            </div>
          );
        })}
        {sportType !== 'running' && (
          <div className="p-2.5 rounded-xl border border-ink-800 bg-ink-950">
            <span className="text-[9px] text-ink-500 uppercase block">CSS natation</span>
            <input
              type="text"
              value={profile.nat100 || ''}
              onChange={(e) => onProfileChange({ ...profile, nat100: e.target.value || null })}
              placeholder="Non renseigné"
              className="w-full bg-transparent text-sm font-bold font-mono text-cyan-400 placeholder-ink-600 focus:outline-none"
            />
          </div>
        )}
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
