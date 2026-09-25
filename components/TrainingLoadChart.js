import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { computeTrainingLoadSeries, describeTsb } from '../lib/analytics';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

const AXIS_COLOR = '#565D67';
const GRID_COLOR = 'rgba(16, 19, 26, 0.08)';

/**
 * Carte "Charge d'entraînement" (CTL/ATL/TSB), onglet Objectif — voir
 * lib/analytics.js:computeTrainingLoadSeries pour le calcul. Calculée
 * UNIQUEMENT depuis les activités Strava réellement synchronisées
 * (`activities`) : pas de génération d'historique fictif si le compte
 * Strava n'est pas connecté ou vient d'être connecté (peu d'activités).
 */
export default function TrainingLoadChart({ activities = [], profile }) {
  const series = computeTrainingLoadSeries(activities, profile);
  const tsbInfo = describeTsb(series.current?.tsb);

  const data = {
    labels: series.labels,
    datasets: [
      {
        label: 'Fitness (CTL, 42j)',
        data: series.ctl,
        borderColor: '#22D3EE',
        backgroundColor: 'rgba(34, 211, 238, 0.12)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2.5,
      },
      {
        label: 'Fatigue (ATL, 7j)',
        data: series.atl,
        borderColor: '#FB7185',
        backgroundColor: 'rgba(251, 113, 133, 0.08)',
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2,
      },
      {
        label: 'Forme (TSB)',
        data: series.tsb,
        borderColor: '#FBBF24',
        backgroundColor: 'transparent',
        fill: false,
        borderDash: [4, 3],
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 1.75,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 4, right: 8 } },
    plugins: {
      legend: { position: 'bottom', labels: { color: '#3D434C', font: { size: 10, weight: '600' }, boxWidth: 10, padding: 10 } },
      tooltip: { titleFont: { size: 12 }, bodyFont: { size: 12 } },
    },
    scales: {
      y: { ticks: { color: AXIS_COLOR, font: { size: 11 } }, grid: { color: GRID_COLOR } },
      x: {
        ticks: {
          color: AXIS_COLOR,
          font: { size: 10 },
          maxTicksLimit: 7,
          autoSkip: true,
        },
        grid: { display: false },
      },
    },
  };

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-3">
      <div>
        <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">Charge d'entraînement</span>
        <p className="text-[10px] text-ink-500 leading-relaxed mt-0.5">
          Fitness (CTL) / Fatigue (ATL) / Forme (TSB), calculées depuis tes activités Strava synchronisées — pas un test terrain,
          un indicateur de tendance.
        </p>
      </div>

      {series.spanDays < 2 ? (
        <p className="text-xs text-ink-500 text-center py-8">
          {activities?.length > 0
            ? "Pas encore assez de jours d'activités Strava synchronisées pour tracer une courbe de charge."
            : 'Connecte Strava (onglet Profil) pour voir apparaître ta charge d\'entraînement ici.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-ink-950 border border-ink-800 rounded-xl p-2.5">
              <span className="text-[9px] text-cyan-400 uppercase block">Fitness</span>
              <span className="text-base font-black text-ink-50 font-mono">{series.current.ctl}</span>
            </div>
            <div className="bg-ink-950 border border-ink-800 rounded-xl p-2.5">
              <span className="text-[9px] text-rose-400 uppercase block">Fatigue</span>
              <span className="text-base font-black text-ink-50 font-mono">{series.current.atl}</span>
            </div>
            <div className="bg-ink-950 border border-ink-800 rounded-xl p-2.5">
              <span className="text-[9px] text-amber-400 uppercase block">Forme</span>
              <span className="text-base font-black font-mono" style={{ color: tsbInfo?.color || '#E9EAEC' }}>
                {series.current.tsb}
              </span>
            </div>
          </div>

          {tsbInfo && (
            <p className="text-[10px] font-bold text-center" style={{ color: tsbInfo.color }}>
              {tsbInfo.label}
            </p>
          )}

          <div className="relative h-48 sm:h-56">
            <Line data={data} options={options} />
          </div>

          <p className="text-[9px] text-ink-600 leading-relaxed">
            Basé sur {series.totalCount} activité(s) Strava sur {series.spanDays} jour(s)
            {series.spanDays < 42 ? ' — courbe encore courte, elle se stabilise après ~6 semaines de données' : ''}.
            {series.estimatedCount > 0
              ? ` ${series.estimatedCount} séance(s) sans FC/puissance moyenne exploitable : comptée(s) en zone Z2 par défaut (estimation, pas une mesure).`
              : ''}
          </p>
        </>
      )}
    </div>
  );
}
