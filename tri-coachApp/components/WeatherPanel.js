import React from 'react';
import dynamic from 'next/dynamic';

// La carte radar utilise Leaflet (accès direct à `window`) : chargement client-only,
// impossible/inutile de la faire passer par le rendu serveur Next.js.
const WeatherRadarMap = dynamic(() => import('./WeatherRadarMap'), {
  ssr: false,
  loading: () => <p className="text-xs text-ink-500 animate-pulse text-center py-8">Chargement de la carte radar…</p>,
});

// SIMPLIFIÉ (demande explicite) : la vue "Résumé" (météo de l'heure actuelle + tuiles
// des 7 prochains jours) est retirée — seule la carte radar vent + pluie sur 24h reste,
// c'est le vrai outil de préparation des sorties (heure par heure, pas un instantané).
export default function WeatherPanel() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-black uppercase text-ink-50">🌦️ Météo d'entraînement — vent &amp; pluie 24h</h2>
      </div>
      <WeatherRadarMap />
    </div>
  );
}
