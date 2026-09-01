// components/CycleTracker.js
//
// Suivi du cycle menstruel (Point 8) — voir lib/cycleTracking.js pour le détail du calcul
// et le principe "entièrement opt-in" (rien n'est actif tant que l'athlète n'a pas coché
// la case et saisi au moins une date). Repliable/masquable à tout moment ; désactiver
// n'efface PAS l'historique déjà saisi (juste arrête de l'utiliser), pour ne pas perdre la
// saisie en cas de désactivation par erreur.
import React, { useEffect, useState } from 'react';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '../lib/storage';
import { computeCurrentPhase } from '../lib/cycleTracking';

function fmtDate(d) {
  try { return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }); } catch { return d; }
}

const DEFAULT_DATA = { enabled: false, periodStartDates: [], avgCycleLength: 28 };

export default function CycleTracker() {
  const [data, setData] = useState(DEFAULT_DATA);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const loaded = loadFromStorage(STORAGE_KEYS.menstrualCycle, DEFAULT_DATA);
    setData(loaded);
    setExpanded(Boolean(loaded.enabled));
  }, []);

  const persist = (next) => {
    setData(next);
    saveToStorage(STORAGE_KEYS.menstrualCycle, next);
  };

  const toggleEnabled = () => {
    const next = { ...data, enabled: !data.enabled };
    persist(next);
    if (next.enabled) setExpanded(true);
  };

  const logToday = () => {
    const today = new Date().toISOString().slice(0, 10);
    if (data.periodStartDates.includes(today)) return;
    persist({ ...data, periodStartDates: [...data.periodStartDates, today].sort() });
  };

  const removeDate = (d) => {
    persist({ ...data, periodStartDates: data.periodStartDates.filter((x) => x !== d) });
  };

  const setCycleLength = (v) => {
    persist({ ...data, avgCycleLength: Math.min(Math.max(Number(v) || 28, 21), 40) });
  };

  const phase = computeCurrentPhase(data);
  const recentDates = [...data.periodStartDates].sort((a, b) => new Date(b) - new Date(a)).slice(0, 6);

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">🌙 Suivi du cycle menstruel</span>
          <p className="text-[10px] text-ink-500 mt-1 leading-relaxed">
            Optionnel — ajuste le ressenti attendu (RPE, récupération) selon la phase du cycle. Rien n'est activé
            par défaut ; tu peux désactiver à tout moment sans perdre ton historique.
          </p>
        </div>
        <button
          onClick={toggleEnabled}
          className={`shrink-0 text-[10px] font-bold px-3 py-1.5 rounded-full min-h-tap ${data.enabled ? 'bg-volt-500 text-ink-50' : 'bg-ink-950 border border-ink-800 text-ink-400'}`}
        >
          {data.enabled ? 'Activé' : 'Désactivé'}
        </button>
      </div>

      {data.enabled && expanded && (
        <>
          {phase ? (
            <div className="p-3 rounded-xl bg-ink-950 border border-ink-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-ink-50">{phase.label}</span>
                <span className="text-[10px] text-ink-500">Jour {phase.dayInCycle} / {phase.cycleLength}</span>
              </div>
              <p className="text-[11px] text-ink-400 mt-1.5 leading-relaxed">{phase.guidance}</p>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-ink-950 border border-ink-800 text-[11px] text-ink-500">
              Saisis la date de début de tes dernières règles pour obtenir une estimation de phase.
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={logToday} className="flex-1 bg-volt-500 hover:bg-volt-400 text-ink-50 font-bold text-xs py-2.5 rounded-xl min-h-tap">
              Mes règles ont commencé aujourd'hui
            </button>
          </div>

          <div>
            <label className="text-[10px] text-ink-400 block mb-1">Longueur moyenne de cycle : <span className="text-ink-100 font-bold">{data.avgCycleLength} jours</span></label>
            <input
              type="range"
              min={21}
              max={40}
              value={data.avgCycleLength}
              onChange={(e) => setCycleLength(e.target.value)}
              className="w-full accent-volt-500"
            />
          </div>

          {recentDates.length > 0 && (
            <div className="space-y-1">
              <span className="text-[9px] text-ink-500 uppercase">Dates enregistrées</span>
              {recentDates.map((d) => (
                <div key={d} className="flex items-center justify-between p-1.5 px-2.5 rounded-lg bg-ink-950 border border-ink-800">
                  <span className="text-[11px] text-ink-300">{fmtDate(d)}</span>
                  <button onClick={() => removeDate(d)} className="text-[9px] text-ink-500">Suppr.</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
