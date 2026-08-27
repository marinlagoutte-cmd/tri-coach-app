import { useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { STORAGE_KEYS, loadFromStorage } from '../lib/storage';
import { computeFeedbackTrendSeries, computeKeyMetrics } from '../lib/analytics';
import ZoneCharts from './ZoneCharts';
import TrainingLogChart from './TrainingLogChart';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const AXIS_COLOR = '#565D67';
const GRID_COLOR = 'rgba(16, 19, 26, 0.08)';

// Sparkline "forme" compacte dans l'en-tête : lecture en un coup d'œil de la
// tendance récente (capacity ressentie, données réelles de feedbackHistory —
// pas de CTL/ATL inventé), le graphe détaillé plus bas restant la vue complète.
function FormSparkline({ capacity }) {
  const points = capacity.filter((v) => v !== null && v !== undefined).slice(-8);
  if (points.length < 2) return null;
  const w = 72;
  const h = 24;
  const min = 0;
  const max = 10;
  const stepX = w / (points.length - 1);
  const coords = points.map((v, i) => `${(i * stepX).toFixed(1)},${(h - ((v - min) / (max - min)) * h).toFixed(1)}`);
  const last = points[points.length - 1];
  const first = points[0];
  const color = last >= first ? '#34D399' : '#FBBF24';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" title={`Forme ressentie : ${first} → ${last} sur les ${points.length} dernières validations`}>
      <polyline points={coords.join(' ')} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={coords[coords.length - 1].split(',')[0]} cy={coords[coords.length - 1].split(',')[1]} r="2" fill={color} />
    </svg>
  );
}

export default function PerformanceDashboard({ profile, feedbackHistory, sportType = 'triathlon', stravaActivities = [], onPaceZonesChange }) {
  const [healthHistory, setHealthHistory] = useState([]);

  useEffect(() => {
    setHealthHistory(loadFromStorage(STORAGE_KEYS.healthHistory, []));
  }, []);

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

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-4 text-ink-100">
      <div>
        <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">Analyses</span>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-black text-ink-50 font-display">Performance & progression</h2>
          <FormSparkline capacity={trend.capacity} />
        </div>
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

        {/* Journal d'entraînement façon Strava (bulles par activité, taille au choix,
            filtrable par sport) — remplace l'ancien face-à-face "Volume prévu / réalisé". */}
        <TrainingLogChart activities={stravaActivities} profile={profile} />

        {/* Distribution des zones (semaine PRÉVUE au plan) supprimée : redondante avec
            "Zones d'entraînement" juste en dessous (ZoneCharts), qui montre la répartition
            par zone des activités Strava RÉELLEMENT synchronisées, par discipline, avec
            bornes éditables — plus complète et plus fiable que ce résumé basé sur le champ
            `cardio` du plan (voir lib/analytics.js:computeZoneMinutes, plus utilisé ici).
            Métriques clés repassée en pleine largeur (elle partageait la grille 2 colonnes
            avec ce bloc). */}
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

        {/* Zones FC & Puissance (vélo/course, switch par bouton) — alimentées par les
            activités Strava synchronisées, bornes éditables manuellement. */}
        <div>
          <p className="text-xs font-bold text-ink-50 mb-0.5">Zones d'entraînement</p>
          <p className="text-[10px] text-ink-500 mb-2">Répartition du temps par zone (séances Strava) · bornes modifiables</p>
          <ZoneCharts profile={profile || {}} activities={stravaActivities} onPaceZonesChange={onPaceZonesChange} />
        </div>
      </div>
    </div>
  );
}
