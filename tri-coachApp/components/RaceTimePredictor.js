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
import { SportDot } from './ui/sport';

const SEGMENT_META = {
  swim: { icon: '🏊', label: 'Natation', color: '#22D3EE' },
  bike: { icon: '🚴', label: 'Vélo', color: '#FBBF24' },
  run: { icon: '🏃', label: 'Course', color: '#34D399' },
};

export default function RaceTimePredictor({ sportType, constraints, profile, stravaActivities = [] }) {
  const distances = useMemo(() => {
    if (sportType === 'triathlon' || sportType === 'duathlon') return constraints?.customDistances || {};
    return { run: runningDistanceFromWizard(constraints || {}) };
  }, [sportType, constraints]);

  const hasDistances = (sportType === 'triathlon' || sportType === 'duathlon')
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
      <span className="text-[13px] font-semibold text-ink-100 block">
        Prédiction de chrono (forme actuelle)
      </span>

      {!prediction.available && (
        <p className="text-[11px] text-ink-500 leading-relaxed">{prediction.reason}</p>
      )}

      {prediction.available && (
        <>
          <div>
            <span className="text-[28px] font-bold text-ink-50 block leading-none tabular-nums">{formatHms(prediction.totalS)}</span>
            <span className="text-[12px] text-ink-500 block mt-1">Chrono estimé aujourd'hui</span>
          </div>

          {prediction.splits && (prediction.splits.swim || prediction.splits.bike || prediction.splits.run) && (
            <div className="grid grid-cols-3 gap-3">
              {['swim', 'bike', 'run'].map((key) => {
                const seg = prediction.splits[key];
                const meta = SEGMENT_META[key];
                if (!seg && sportType !== 'triathlon' && key !== 'run') return null;
                const type = key === 'swim' ? 'NATATION' : key === 'bike' ? 'CYCLISME' : 'C.A.P';
                return (
                  <div key={key}>
                    <span className="text-[15px] font-semibold text-ink-50 block tabular-nums">{seg ? formatHms(seg.timeS) : '—'}</span>
                    <span className="text-[11px] text-ink-500 mt-0.5 inline-flex items-center gap-1"><SportDot type={type} size={12} /> {meta.label}</span>
                    {seg?.avgSpeedKmh && <span className="text-[10px] text-ink-500 block mt-0.5">{seg.avgSpeedKmh} km/h (Strava, {seg.basedOnRides} sortie{seg.basedOnRides > 1 ? 's' : ''})</span>}
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[12px] text-ink-500 leading-relaxed pt-2 border-t border-ink-800">
            {prediction.formLabel}.
            {prediction.partial && prediction.missing?.length > 0 && ` Estimation partielle — manque : ${prediction.missing.join(', ')}.`}
            {' '}Ce chrono évolue avec ta progression (VMA/FTP/CSS) et ta forme (charge d'entraînement) — pas une prédiction figée.
          </p>
        </>
      )}
    </div>
  );
}
