import React, { useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '../lib/storage';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const METRICS = [
  { key: 'weight', label: 'Poids', unit: 'kg', color: '#FF5722' },
  { key: 'fcRepos', label: 'FC repos', unit: 'bpm', color: '#6366F1' },
  { key: 'vfc', label: 'VFC (HRV)', unit: 'ms', color: '#10B981' },
  { key: 'fcMax', label: 'FC max', unit: 'bpm', color: '#F43F5E' },
  { key: 'vma', label: 'VMA', unit: 'km/h', color: '#EAB308' },
  { key: 'ftp', label: 'FTP', unit: 'W', color: '#3B82F6', hideForRunning: true },
];

export default function ProfileHealth({ profile, onProfileChange, sportType = 'triathlon' }) {
  const [history, setHistory] = useState([]);
  const [selectedMetrics, setSelectedMetrics] = useState(['weight']);
  const [entryDate, setEntryDate] = useState('');
  const [entryValue, setEntryValue] = useState('');

  const visibleMetrics = METRICS.filter((m) => !(sportType === 'running' && m.hideForRunning));

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
    plugins: { legend: { display: activeMetrics.length > 1, labels: { color: '#94a3b8', font: { size: 10 } } } },
    scales: {
      y: { position: 'left', ticks: { color: activeMetrics[0]?.color || '#94a3b8' } },
      ...(activeMetrics.length > 1
        ? { y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: activeMetrics[1]?.color } } }
        : {}),
    },
  };

  const totalPoints = history.filter((h) => selectedMetrics.includes(h.metric)).length;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4 text-slate-100">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-orange-400 uppercase tracking-widest block">Profil & données santé</span>
        <span className="text-[9px] text-slate-500">1 clic = 1 courbe · 2 clics = superposition</span>
      </div>

      {/* Menus des métriques */}
      <div className="grid grid-cols-3 sm:grid-cols-3 gap-2">
        {visibleMetrics.map((m) => {
          const rank = selectedMetrics.indexOf(m.key);
          return (
            <button
              key={m.key}
              onClick={() => toggleMetric(m.key)}
              className={`p-2.5 rounded-xl border text-left transition-all relative ${
                rank !== -1
                  ? 'border-orange-500/60 bg-orange-500/10'
                  : 'border-slate-800 bg-slate-950 hover:border-slate-700'
              }`}
            >
              {rank !== -1 && (
                <span className="absolute top-1 right-1.5 text-[9px] font-bold text-orange-400">{rank + 1}</span>
              )}
              <span className="text-[9px] text-slate-500 uppercase block">{m.label}</span>
              <span className="text-sm font-bold font-mono" style={{ color: m.color }}>
                {profile[m.key] ?? '-'} <span className="text-[9px] text-slate-500">{m.unit}</span>
              </span>
            </button>
          );
        })}
        <div className="p-2.5 rounded-xl border border-slate-800 bg-slate-950">
          <span className="text-[9px] text-slate-500 uppercase block">CSS natation</span>
          <input
            type="text"
            value={profile.nat100 || ''}
            onChange={(e) => onProfileChange({ ...profile, nat100: e.target.value })}
            className="w-full bg-transparent text-sm font-bold font-mono text-cyan-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Graphe d'évolution (1 ou 2 courbes superposées) */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
        {totalPoints > 1 ? (
          <Line data={chartData} options={chartOptions} />
        ) : (
          <p className="text-xs text-slate-500 text-center py-6">
            Ajoute au moins 2 mesures pour voir l'évolution de {activeMetrics.map((m) => m.label.toLowerCase()).join(' / ')}.
          </p>
        )}
      </div>

      {/* Saisie manuelle (cible la dernière métrique sélectionnée) */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-[10px] text-slate-400 block mb-1">Date</label>
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white"
          />
        </div>
        <div className="flex-1">
          <label className="text-[10px] text-slate-400 block mb-1">
            {activeMetrics[activeMetrics.length - 1]?.label} ({activeMetrics[activeMetrics.length - 1]?.unit})
          </label>
          <input
            type="number"
            step="0.1"
            value={entryValue}
            onChange={(e) => setEntryValue(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-white"
            placeholder="ex: 70.5"
          />
        </div>
        <button
          onClick={addEntry}
          className="bg-orange-500 hover:bg-orange-400 text-slate-950 font-bold text-xs px-4 py-2 rounded-xl min-h-tap"
        >
          Ajouter
        </button>
      </div>
    </div>
  );
}
