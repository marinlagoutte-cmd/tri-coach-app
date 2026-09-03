// components/CycleTracker.js
//
// Suivi du cycle menstruel (Point 8) — voir lib/cycleTracking.js pour le détail du calcul
// et le principe "entièrement opt-in" (rien n'est actif tant que l'athlète n'a pas coché
// la case et saisi au moins une date). Repliable/masquable à tout moment ; désactiver
// n'efface PAS l'historique déjà saisi (juste arrête de l'utiliser), pour ne pas perdre la
// saisie en cas de désactivation par erreur.
//
// ÉVOLUTION (demande explicite de l'athlète) : jusqu'ici la seule saisie possible était
// "mes règles ont commencé aujourd'hui" — impossible de déclarer une date passée (ex: en
// renseignant l'historique après coup). On ajoute maintenant : (1) un vrai champ date libre,
// (2) un calendrier simple du mois affiché avec les phases projetées jour par jour et des
// flèches pour naviguer mois par mois (avant/après), pour suivre l'évolution sur la durée,
// (3) un éditeur de durée de phase par phase, pour une athlète qui connaît déjà son propre
// rythme plutôt que de subir le modèle proportionnel par défaut (référentiel 28 jours).
import React, { useEffect, useMemo, useState } from 'react';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '../lib/storage';
import { CYCLE_PHASES, computeCurrentPhase, getPhaseBoundaries, getMonthPhaseMap } from '../lib/cycleTracking';

function fmtDate(d) {
  try { return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }); } catch { return d; }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const DEFAULT_DATA = { enabled: false, periodStartDates: [], avgCycleLength: 28, phaseLengths: null };

// Couleurs de fond par phase pour le calendrier + la légende — volontairement discrètes
// (opacité réduite) pour ne pas surcharger visuellement une grille de 28-31 jours.
const PHASE_DOT_CLASS = {
  menstrual: 'bg-rose-500',
  follicular: 'bg-emerald-500',
  ovulation: 'bg-amber-400',
  luteal: 'bg-violet-500',
};

const WEEKDAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export default function CycleTracker() {
  const [data, setData] = useState(DEFAULT_DATA);
  const [expanded, setExpanded] = useState(false);
  const [newDate, setNewDate] = useState(todayISO());
  const [showPhaseEditor, setShowPhaseEditor] = useState(false);
  // Mois affiché dans le calendrier — indépendant du mois réel, pour permettre de naviguer
  // en avant (projection à venir) ou en arrière (relire un mois passé) sans jamais perdre
  // le mois "aujourd'hui" (bouton dédié pour y revenir directement, voir plus bas).
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());

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

  // Remplace l'ancien "logToday" : accepte n'importe quelle date choisie dans le champ
  // (par défaut aujourd'hui, mais librement modifiable) — permet de saisir un historique
  // passé, pas seulement le jour même.
  const addDate = () => {
    if (!newDate) return;
    if (data.periodStartDates.includes(newDate)) return;
    persist({ ...data, periodStartDates: [...data.periodStartDates, newDate].sort() });
  };

  const removeDate = (d) => {
    persist({ ...data, periodStartDates: data.periodStartDates.filter((x) => x !== d) });
  };

  const setCycleLength = (v) => {
    persist({ ...data, avgCycleLength: Math.min(Math.max(Number(v) || 28, 21), 40) });
  };

  // Durées de phase actuellement EFFECTIVES (override déclaré si présent, sinon modèle par
  // défaut recalé sur la longueur de cycle) — sert de valeur de départ à l'éditeur, pour que
  // l'athlète ajuste depuis une base réaliste plutôt que de repartir de zéro.
  const effectiveBoundaries = useMemo(() => getPhaseBoundaries(data), [data.avgCycleLength, data.phaseLengths]);
  const effectivePhaseLengths = useMemo(() => {
    const out = {};
    effectiveBoundaries.forEach((p) => { out[p.key] = p.endDay - p.startDay + 1; });
    return out;
  }, [effectiveBoundaries]);

  const setPhaseLength = (key, days) => {
    const nextLengths = { ...effectivePhaseLengths, [key]: Math.max(1, Number(days) || 1) };
    persist({ ...data, phaseLengths: nextLengths });
  };

  const resetPhaseLengths = () => {
    persist({ ...data, phaseLengths: null });
  };

  const phase = computeCurrentPhase(data);
  const recentDates = [...data.periodStartDates].sort((a, b) => new Date(b) - new Date(a)).slice(0, 6);

  const monthMap = useMemo(() => getMonthPhaseMap(data, viewYear, viewMonth), [data, viewYear, viewMonth]);
  const monthLabel = useMemo(
    () => new Date(viewYear, viewMonth, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    [viewYear, viewMonth]
  );
  // Décalage (Lundi=0) du 1er jour du mois affiché, pour aligner la grille sur une semaine
  // commençant le lundi (convention FR) plutôt que le dimanche (convention par défaut de Date).
  const firstDayOffset = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const today = todayISO();

  const goToMonth = (delta) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };
  const goToToday = () => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
  };

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
                <span className="text-xs font-bold text-ink-50 flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${PHASE_DOT_CLASS[phase.key]}`} />
                  {phase.label}
                </span>
                <span className="text-[10px] text-ink-500">Jour {phase.dayInCycle} / {phase.cycleLength}</span>
              </div>
              <p className="text-[11px] text-ink-400 mt-1.5 leading-relaxed">{phase.guidance}</p>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-ink-950 border border-ink-800 text-[11px] text-ink-500">
              Saisis la date de début de tes dernières règles pour obtenir une estimation de phase.
            </div>
          )}

          {/* Saisie de date libre (remplace l'ancien bouton "aujourd'hui" uniquement) */}
          <div>
            <label className="text-[10px] text-ink-400 block mb-1">Date de début de règles à enregistrer</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={newDate}
                max={todayISO()}
                onChange={(e) => setNewDate(e.target.value)}
                className="flex-1 bg-ink-950 border border-ink-800 rounded-xl p-2.5 text-sm text-ink-50 min-h-tap"
              />
              <button onClick={addDate} className="shrink-0 bg-volt-500 hover:bg-volt-400 text-ink-50 font-bold text-xs px-4 rounded-xl min-h-tap">
                Ajouter
              </button>
            </div>
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

          {/* Calendrier simple du mois affiché — projette les phases jour par jour à partir
              de la dernière date déclarée + longueur de cycle (et durées de phase, si
              ajustées ci-dessous). Flèches pour suivre l'évolution sur les mois suivants
              (projection) ou relire un mois passé. */}
          {data.periodStartDates.length > 0 && (
            <div className="p-3 rounded-xl bg-ink-950 border border-ink-800">
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => goToMonth(-1)} aria-label="Mois précédent" className="w-8 h-8 rounded-lg border border-ink-800 text-ink-300 flex items-center justify-center active:bg-ink-800">
                  ←
                </button>
                <button onClick={goToToday} className="text-[11px] font-bold text-ink-50 capitalize hover:text-volt-400">
                  {monthLabel}
                </button>
                <button onClick={() => goToMonth(1)} aria-label="Mois suivant" className="w-8 h-8 rounded-lg border border-ink-800 text-ink-300 flex items-center justify-center active:bg-ink-800">
                  →
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 mb-1">
                {WEEKDAY_LABELS.map((w, i) => (
                  <div key={`${w}-${i}`} className="text-center text-[9px] text-ink-600 font-bold">{w}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: firstDayOffset }).map((_, i) => <div key={`pad-${i}`} />)}
                {monthMap.map((entry) => (
                  <div
                    key={entry.date}
                    title={entry.phase ? entry.phase.label : ''}
                    className={`aspect-square rounded-md flex items-center justify-center text-[10px] font-bold relative ${
                      entry.phase ? `${PHASE_DOT_CLASS[entry.phase.key]}/25 text-ink-50` : 'bg-ink-900 text-ink-600'
                    } ${entry.date === today ? 'ring-2 ring-volt-400' : ''}`}
                  >
                    {entry.day}
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">
                {CYCLE_PHASES.map((p) => (
                  <span key={p.key} className="flex items-center gap-1 text-[9px] text-ink-500">
                    <span className={`inline-block w-2 h-2 rounded-full ${PHASE_DOT_CLASS[p.key]}`} />
                    {p.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Éditeur de durée de phase — pour une athlète qui connaît déjà son propre rythme
              (ex: phase menstruelle plus longue que la moyenne) plutôt que de subir le modèle
              proportionnel par défaut. Repliable : la plupart des athlètes n'auront jamais
              besoin d'y toucher. */}
          <div>
            <button onClick={() => setShowPhaseEditor((v) => !v)} className="text-[10px] font-bold text-ink-400 hover:text-ink-200">
              {showPhaseEditor ? '▾' : '▸'} Décaler mes phases si je les connais
            </button>
            {showPhaseEditor && (
              <div className="mt-2 space-y-2 p-3 rounded-xl bg-ink-950 border border-ink-800">
                <p className="text-[10px] text-ink-500 leading-relaxed">
                  Durée de chaque phase, en jours (ajustée automatiquement pour retomber sur les {data.avgCycleLength} jours du cycle
                  si le total ne correspond plus exactement).
                </p>
                {CYCLE_PHASES.map((p) => (
                  <div key={p.key} className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-ink-300 flex items-center gap-1.5">
                      <span className={`inline-block w-2 h-2 rounded-full ${PHASE_DOT_CLASS[p.key]}`} />
                      {p.label}
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={effectivePhaseLengths[p.key]}
                      onChange={(e) => setPhaseLength(p.key, e.target.value)}
                      className="w-16 bg-ink-900 border border-ink-800 rounded-lg p-1.5 text-xs text-ink-50 text-center"
                    />
                  </div>
                ))}
                {data.phaseLengths && (
                  <button onClick={resetPhaseLengths} className="text-[10px] text-ink-500 underline">
                    Revenir aux durées par défaut (proportionnelles)
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
