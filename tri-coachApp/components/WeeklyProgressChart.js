import { useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from 'chart.js';
import { computeWeeklySportSeries } from '../lib/analytics';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

const AXIS_COLOR = '#565D67';
const GRID_COLOR = 'rgba(16, 19, 26, 0.08)';

const SPORT_TABS = [
  { key: 'ALL', label: 'Tout' },
  { key: 'C.A.P', label: 'Course' },
  { key: 'CYCLISME', label: 'Vélo' },
  { key: 'NATATION', label: 'Natation' },
  { key: 'AUTRE', label: 'Autre' },
];

/**
 * Carte "Progression" façon Strava (onglet Objectif, sous TrainingLoadChart) : filtre par
 * sport, stats de la semaine en cours (distance/temps/dénivelé), et courbe des 12 dernières
 * semaines calendaires (Lundi→Dimanche) — basculable volume (km) / temps (h). Voir
 * lib/analytics.js:computeWeeklySportSeries pour l'agrégation. Calculée UNIQUEMENT depuis les
 * activités Strava réellement synchronisées (`activities`), jamais de semaine inventée.
 */
export default function WeeklyProgressChart({ activities = [] }) {
  const [sportFilter, setSportFilter] = useState('ALL');
  const [metric, setMetric] = useState('distance'); // 'distance' | 'time'

  const series = computeWeeklySportSeries(activities, { weeks: 12, sportFilter, metric });

  const accentColor = '#FC4C02'; // orange Strava, cohérent avec le bloc Réglages > Strava déjà dans l'app

  const data = {
    labels: series.labels,
    datasets: [
      {
        data: series.values,
        borderColor: accentColor,
        backgroundColor: 'rgba(252, 76, 2, 0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: accentColor,
        pointBorderColor: accentColor,
        borderWidth: 2.5,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 4, right: 8 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        titleFont: { size: 12 },
        bodyFont: { size: 12 },
        callbacks: {
          label: (ctx) => (metric === 'time' ? `${ctx.parsed.y} h` : `${ctx.parsed.y} km`),
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          color: AXIS_COLOR,
          font: { size: 11 },
          callback: (v) => (metric === 'time' ? `${v}h` : `${v}km`),
        },
        grid: { color: GRID_COLOR },
      },
      x: {
        ticks: { color: AXIS_COLOR, font: { size: 9 }, maxTicksLimit: 6, autoSkip: true },
        grid: { display: false },
      },
    },
  };

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-3">
      <div>
        <span className="text-[10px] font-mono uppercase tracking-widest block" style={{ color: accentColor }}>
          Progression
        </span>
        <p className="text-[10px] text-ink-500 leading-relaxed mt-0.5">
          Volume hebdomadaire réel, calculé depuis tes activités Strava synchronisées.
        </p>
      </div>

      {/* Filtre par sport — chips horizontales, défilables si ça déborde sur petit écran */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
        {SPORT_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSportFilter(tab.key)}
            className={`shrink-0 text-[10px] font-bold px-3 py-1.5 rounded-full border whitespace-nowrap ${
              sportFilter === tab.key
                ? 'text-white border-transparent'
                : 'text-ink-400 border-ink-700 bg-ink-950 hover:bg-ink-800'
            }`}
            style={sportFilter === tab.key ? { backgroundColor: accentColor } : undefined}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!series.hasAnyActivity ? (
        <p className="text-xs text-ink-500 text-center py-8">
          {activities?.length > 0
            ? "Aucune activité de ce type dans tes séances Strava synchronisées."
            : "Connecte Strava (Réglages) pour voir ta progression ici."}
        </p>
      ) : (
        <>
          {/* Stats de la semaine en cours — mêmes 3 chiffres que l'écran Strava (distance,
              temps, dénivelé), toujours affichés tous les trois quel que soit le mode courbe. */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-ink-950 border border-ink-800 rounded-xl p-2.5">
              <span className="text-[9px] text-ink-500 uppercase block">Distance</span>
              <span className="text-base font-black text-ink-50 font-mono">{series.currentWeek.distanceKm} km</span>
            </div>
            <div className="bg-ink-950 border border-ink-800 rounded-xl p-2.5">
              <span className="text-[9px] text-ink-500 uppercase block">Temps</span>
              <span className="text-base font-black text-ink-50 font-mono">{series.currentWeek.hours} h</span>
            </div>
            <div className="bg-ink-950 border border-ink-800 rounded-xl p-2.5">
              <span className="text-[9px] text-ink-500 uppercase block">Dénivelé</span>
              <span className="text-base font-black text-ink-50 font-mono">{series.currentWeek.elevationM} m</span>
            </div>
          </div>

          {/* Toggle volume (km) / temps (h) pour la courbe */}
          <div className="flex justify-center gap-1.5">
            {[
              { key: 'distance', label: 'Volume (km)' },
              { key: 'time', label: 'Temps (h)' },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => setMetric(opt.key)}
                className={`text-[10px] font-bold px-3 py-1 rounded-full border ${
                  metric === opt.key
                    ? 'bg-ink-50 text-ink-950 border-ink-50'
                    : 'text-ink-400 border-ink-700 bg-ink-950 hover:bg-ink-800'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <p className="text-[9px] text-ink-600 text-center">12 dernières semaines</p>

          <div className="relative h-48 sm:h-56">
            <Line data={data} options={options} />
          </div>
        </>
      )}
    </div>
  );
}
