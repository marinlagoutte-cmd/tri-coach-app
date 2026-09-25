// components/RaceTimePredictor.js
//
// "Avec ta forme actuelle, tu es sur un chrono estimé de X sur ton format" — synthèse finale
// entre le profil physiologique courant (VMA/FTP/CSS, déjà dans `profile`) et la forme
// actuelle (TSB, lib/analytics.js), voir lib/racePredictor.js pour le détail du calcul et
// ses limites (jamais un modèle vélo watts→vitesse inventé, entre autres — chaque segment
// n'apparaît que s'il est réellement estimable).
import React, { useMemo } from 'react';
import { computeTrainingLoadSeries } from '../lib/analytics';
import { predictRaceTime, formatHms } from '../lib/racePredictor';
import { runningDistanceFromWizard } from '../lib/physiology';

const SEGMENT_META = {
  swim: { icon: '🏊', label: 'Natation', color: '#22D3EE' },
  bike: { icon: '🚴', label: 'Vélo', color: '#FBBF24' },
  run: { icon: '🏃', label: 'Course', color: '#34D399' },
};

export default function RaceTimePredictor({ sportType, constraints, profile, stravaActivities = [] }) {
  const distances = useMemo(() => {
    if (sportType === 'triathlon') return constraints?.customDistances || {};
    return { run: runningDistanceFromWizard(constraints || {}) };
  }, [sportType, constraints]);

  const hasDistances = sportType === 'triathlon'
    ? Object.values(distances || {}).some((v) => Number(v) > 0)
    : Number(distances?.run) > 0;

  const loadSeries = useMemo(() => computeTrainingLoadSeries(stravaActivities, profile), [stravaActivities, profile]);
  const tsb = loadSeries?.current?.tsb ?? null;

  const prediction = useMemo(() => {
    if (!hasDistances) return { available: false, reason: "Distance de l'épreuve non renseignée." };
    return predictRaceTime({ sportType, distances, physio: profile, activities: stravaActivities, tsb });
  }, [hasDistances, sportType, distances, profile, stravaActivities, tsb]);

  if (!hasDistances) return null;

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-3">
      <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">
        🔮 Prédiction de chrono — ta forme actuelle
      </span>

      {!prediction.available && (
        <p className="text-[11px] text-ink-500 leading-relaxed">{prediction.reason}</p>
      )}

      {prediction.available && (
        <>
          <div className="bg-ink-950 border border-ink-800 rounded-xl p-3 text-center">
            <span className="text-[9px] text-ink-500 uppercase block">Chrono estimé aujourd'hui</span>
            <span className="text-2xl font-black text-volt-400 font-mono block mt-1">{formatHms(prediction.totalS)}</span>
          </div>

          {prediction.splits && (prediction.splits.swim || prediction.splits.bike || prediction.splits.run) && (
            <div className="grid grid-cols-3 gap-2 text-center">
              {['swim', 'bike', 'run'].map((key) => {
                const seg = prediction.splits[key];
                const meta = SEGMENT_META[key];
                if (!seg && sportType !== 'triathlon' && key !== 'run') return null;
                return (
                  <div key={key} className="bg-ink-950 border border-ink-800 rounded-xl p-2.5">
                    <span className="text-[9px] uppercase block" style={{ color: meta.color }}>{meta.icon} {meta.label}</span>
                    <span className="text-sm font-black text-ink-50 font-mono block">{seg ? formatHms(seg.timeS) : '—'}</span>
                    {seg?.avgSpeedKmh && <span className="text-[9px] text-ink-600 block mt-0.5">{seg.avgSpeedKmh} km/h (vitesse réelle Strava, {seg.basedOnRides} sortie{seg.basedOnRides > 1 ? 's' : ''})</span>}
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[9px] text-ink-600 leading-relaxed pt-1 border-t border-ink-800">
            {prediction.formLabel}.
            {prediction.partial && prediction.missing?.length > 0 && ` Estimation partielle — manque : ${prediction.missing.join(', ')}.`}
            {' '}Ce chrono évolue avec ta progression (VMA/FTP/CSS) et ta forme (charge d'entraînement) — pas une prédiction figée.
          </p>
        </>
      )}
    </div>
  );
}
