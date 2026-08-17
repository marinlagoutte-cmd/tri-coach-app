import { useEffect, useState } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { STORAGE_KEYS, loadFromStorage } from '../lib/storage';
import { computeWeeklyDurationByDiscipline, computeZoneMinutes, computeFeedbackTrendSeries, computeKeyMetrics } from '../lib/analytics';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend);

const AXIS_COLOR = '#565D67';
const GRID_COLOR = 'rgba(16, 19, 26, 0.08)';

export default function PerformanceDashboard({ profile, workouts, feedbackHistory, sportType = 'triathlon' }) {
  const [healthHistory, setHealthHistory] = useState([]);

  useEffect(() => {
    setHealthHistory(loadFromStorage(STORAGE_KEYS.healthHistory, []));
  }, []);

  const volume = computeWeeklyDurationByDiscipline(workouts || {});
  const zones = computeZoneMinutes(workouts?.N || []);
  const trend = computeFeedbackTrendSeries(feedbackHistory || []);
  const metrics = computeKeyMetrics(profile || {}, healthHistory, sportType);

  const trendData = {
    labels: trend.labels,
    datasets: [
      { label: 'Difficulté ressentie /10', data: trend.difficulty, borderColor: '#FB7185', backgroundColor: '#FB7185', tension: 0.3, spanGaps: true, pointRadius: 4, pointHoverRadius: 6, borderWidth: 2.5 },
      { label: 'Forme ressentie /10', data: trend.capacity, borderColor: '#34D399', backgroundColor: '#34D399', tension: 0.3, spanGaps: true, pointRadius: 4, pointHoverRadius: 6, borderWidth: 2.5 },
    ],
  };
  const trendOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 4, right: 8 } },
    plugins: {
      legend: { position: 'bottom', labels: { color: '#3D434C', font: { size: 11, weight: '600' }, boxWidth: 10, padding: 12 } },
      tooltip: { titleFont: { size: 12 }, bodyFont: { size: 12 } },
    },
    scales: {
      y: { min: 0, max: 10, ticks: { color: AXIS_COLOR, stepSize: 2, font: { size: 11 } }, grid: { color: GRID_COLOR } },
      x: { ticks: { color: AXIS_COLOR, font: { size: 11 } }, grid: { display: false } },
    },
  };

  const volumeData = {
    labels: volume.labels,
    datasets: volume.disciplines.map((d) => ({
      label: d.label,
      data: volume.series[d.key],
      backgroundColor: d.color,
      borderRadius: 6,
      maxBarThickness: 42,
    })),
  };
  const volumeOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 4, right: 8 } },
    plugins: {
      legend: { position: 'bottom', labels: { color: '#3D434C', font: { size: 11, weight: '600' }, boxWidth: 10, padding: 12 } },
      tooltip: { titleFont: { size: 12 }, bodyFont: { size: 12 }, callbacks: { label: (ctx) => `${ctx.dataset.label} : ${ctx.parsed.y} h` } },
    },
    scales: {
      y: { beginAtZero: true, ticks: { color: AXIS_COLOR, font: { size: 11 }, callback: (v) => `${v}h` }, grid: { color: GRID_COLOR } },
      x: { ticks: { color: '#3D434C', font: { size: 12, weight: '600' } }, grid: { display: false } },
    },
  };

  const zonesTotalMinutes = zones.reduce((a, z) => a + z.minutes, 0);

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-4 text-ink-100">
      <div>
        <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">Analyses</span>
        <h2 className="text-lg font-black text-ink-50 font-display">Performance & progression</h2>
      </div>

      <div className="space-y-4">
        {/* Charge & forme ressenties — basé sur feedbackHistory (réel, daté) */}
        <div className="bg-ink-950 border border-ink-800 rounded-xl p-3">
          <p className="text-xs font-bold text-ink-50">Charge & forme ressenties</p>
          <p className="text-[10px] text-ink-500 mb-2">D'après tes validations de séances (pas de capteur externe connecté)</p>
          {trend.labels.length >= 2 ? (
            <div className="relative h-56 sm:h-64">
              <Line data={trendData} options={trendOptions} />
            </div>
          ) : (
            <p className="text-xs text-ink-500 text-center py-8">
              Valide au moins 2 séances (ressenti dureté/forme) pour voir apparaître ta courbe de charge & forme.
            </p>
          )}
        </div>

        {/* Volume prévu par discipline — 100% réel : les 2 semaines réellement en mémoire (N / N+1) */}
        <div className="bg-ink-950 border border-ink-800 rounded-xl p-3">
          <p className="text-xs font-bold text-ink-50">Volume prévu</p>
          <p className="text-[10px] text-ink-500 mb-2">Heures par discipline — semaine en cours et suivante</p>
          {volume.labels.length > 0 ? (
            <div className="relative h-56 sm:h-64">
              <Bar data={volumeData} options={volumeOptions} />
            </div>
          ) : (
            <p className="text-xs text-ink-500 text-center py-8">Aucun plan généré pour l'instant.</p>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {/* Distribution des zones — semaine en cours, déduite du champ cardio des séances */}
          <div className="bg-ink-950 border border-ink-800 rounded-xl p-3">
            <p className="text-xs font-bold text-ink-50">Distribution des zones</p>
            <p className="text-[10px] text-ink-500 mb-3">Minutes par zone d'intensité — semaine en cours</p>
            {zonesTotalMinutes > 0 ? (
              <div className="space-y-2.5">
                {zones.map((z) => (
                  <div key={z.zone} className="flex items-center gap-2 text-[11px]">
                    <span className="w-6 font-bold shrink-0" style={{ color: z.color }}>{z.zone}</span>
                    <span className="w-[4.5rem] text-ink-400 truncate shrink-0">{z.label}</span>
                    <div className="flex-1 h-2 rounded-full bg-ink-800 overflow-hidden min-w-[2rem]">
                      <div className="h-full rounded-full" style={{ width: `${z.pct}%`, backgroundColor: z.color }} />
                    </div>
                    <span className="w-12 text-right text-ink-300 font-mono shrink-0">{z.minutes}m</span>
                    <span className="w-9 text-right font-mono shrink-0" style={{ color: z.color }}>{z.pct}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-500 text-center py-8">Pas assez d'info de zone dans le plan actuel.</p>
            )}
          </div>

          {/* Métriques clés — profil + delta réel vs mesure précédente (healthHistory) */}
          <div className="bg-ink-950 border border-ink-800 rounded-xl p-3">
            <p className="text-xs font-bold text-ink-50 mb-2">Métriques clés</p>
            {metrics.length > 0 ? (
              <div className="divide-y divide-ink-800/80">
                {metrics.map((m) => (
                  <div key={m.label} className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
                    <span className="text-[10px] text-ink-400 leading-tight">{m.label}</span>
                    <span className="text-right shrink-0">
                      <span className="text-xs font-bold font-mono text-ink-50">{m.value}</span>
                      {m.delta && (
                        <span className={`ml-1.5 text-[9px] font-mono ${m.positive ? 'text-emerald-400' : 'text-ink-500'}`}>{m.delta}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-500 text-center py-8">Renseigne ton profil (VMA, FTP, poids…) pour voir tes métriques clés.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


