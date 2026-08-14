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
  const [selectedMetric, setSelectedMetric] = useState('weight');
  const [entryDate, setEntryDate] = useState('');
  const [entryValue, setEntryValue] = useState('');

  const visibleMetrics = METRICS.filter((m) => !(sportType === 'running' && m.hideForRunning));

  useEffect(() => {
    setHistory(loadFromStorage(STORAGE_KEYS.healthHistory, []));
    setEntryDate(new Date().toISOString().slice(0, 10));
  }, []);

  const addEntry = () => {
    if (!entryValue || !entryDate) return;
    const value = Number(entryValue);
    if (!Number.isFinite(value)) return;

    const nextHistory = [...history, { date: entryDate, metric: selectedMetric, value }]
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    setHistory(nextHistory);
    saveToStorage(STORAGE_KEYS.healthHistory, nextHistory);
    onProfileChange({ ...profile, [selectedMetric]: value });
    setEntryValue('');
  };

  const metricHistory = history.filter((h) => h.metric === selectedMetric);
  const activeMetric = METRICS.find((m) => m.key === selectedMetric);

  const chartData = {
    labels: metricHistory.map((h) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(new Date(h.date))),
    datasets: [
      {
        label: `${activeMetric?.label} (${activeMetric?.unit})`,
        data: metricHistory.map((h) => h.value),
        borderColor: activeMetric?.color,
        backgroundColor: `${activeMetric?.color}33`,
        tension: 0.3,
      },
    ],
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4 text-slate-100">
      <span className="text-[10px] font-mono text-orange-400 uppercase tracking-widest block">Profil & données santé</span>

      {/* Menus des métriques */}
      <div className="grid grid-cols-3 sm:grid-cols-3 gap-2">
        {visibleMetrics.map((m) => (
          <button
            key={m.key}
            onClick={() => setSelectedMetric(m.key)}
            className={`p-2.5 rounded-xl border text-left transition-all ${
              selectedMetric === m.key
                ? 'border-orange-500/60 bg-orange-500/10'
                : 'border-slate-800 bg-slate-950 hover:border-slate-700'
            }`}
          >
            <span className="text-[9px] text-slate-500 uppercase block">{m.label}</span>
            <span className="text-sm font-bold font-mono" style={{ color: m.color }}>
              {profile[m.key] ?? '-'} <span className="text-[9px] text-slate-500">{m.unit}</span>
            </span>
          </button>
        ))}
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

      {/* Graphe d'évolution */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
        {metricHistory.length > 1 ? (
          <Line data={chartData} options={{ responsive: true, plugins: { legend: { display: false } } }} />
        ) : (
          <p className="text-xs text-slate-500 text-center py-6">
            Ajoute au moins 2 mesures pour voir l'évolution de {activeMetric?.label.toLowerCase()}.
          </p>
        )}
      </div>

      {/* Saisie manuelle */}
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
            {activeMetric?.label} ({activeMetric?.unit})
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
