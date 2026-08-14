import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

export default function ForecastChart({ daily = {}, timezone }) {
  const labels = (daily.time || []).map((t) => t);
  const tempsMax = daily.temperature_2m_max || [];
  const tempsMin = daily.temperature_2m_min || [];

  const data = {
    labels,
    datasets: [
      {
        label: 'Max °C',
        data: tempsMax,
        borderColor: 'rgba(255,99,132,1)',
        backgroundColor: 'rgba(255,99,132,0.2)',
        tension: 0.3,
      },
      {
        label: 'Min °C',
        data: tempsMin,
        borderColor: 'rgba(54,162,235,1)',
        backgroundColor: 'rgba(54,162,235,0.2)',
        tension: 0.3,
      },
    ],
  };

  const options = {
    responsive: true,
    plugins: {
      legend: { position: 'top' },
      title: { display: true, text: `Prévisions (${labels.length} jours)` },
    },
  };

  return <Line options={options} data={data} />;
}
