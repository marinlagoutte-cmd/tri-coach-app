import React, { useMemo, useState } from 'react';
import { checkPlanCoherence } from '../lib/workouts';

const AVG_TIME_TABLE = {
  running: {
    '5km': { homme: '20 - 24 min', femme: '23 - 28 min' },
    '10km': { homme: '42 - 50 min', femme: '48 - 58 min' },
    'Semi-marathon': { homme: '1h35 - 1h50', femme: '1h50 - 2h05' },
    Marathon: { homme: '3h30 - 4h00', femme: '3h55 - 4h30' },
  },
  triathlon: {
    XS: '40 - 50 min',
    S: '1h10 - 1h25',
    M: '2h30 - 2h50',
    L: '4h45 - 5h30',
    XL: '10h00 - 12h00',
  },
};

export default function WizardModal({ isOpen, onClose, onComplete, submitting = false, submitError = null }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    eventName: '',
    gender: 'homme',
    weight: '',
    fitnessLevel: 3,
    sportType: 'running', // 'running' | 'triathlon'

    runningSubtype: 'road', // 'road' | 'trail'
    distance: '10km',
    trailKm: '',
    trailElevation: '',
    triathlonFormat: 'M',
    customDistances: { swim: 1.5, bike: 40, run: 10 },

    targetTime: '',
    // Replace single transition by two transitions and per-discipline times
    triathlonTimes: { swim: '', transition_t1: '', bike: '', transition_t2: '', run: '', total: '' },

    targetDate: '',
    hoursPerWeek: 8,
    maxSessionsPerWeek: 4,
    offDays: 'Mercredi',

    // running-specific pace (min per km)
    runningPace: 6.0,
  });

  // custom coherence check for hoursPerWeek vs sessions
  const hoursSessionsWarning = useMemo(() => {
    const hours = Number(formData.hoursPerWeek) || 0;
    const sessions = Number(formData.maxSessionsPerWeek) || 1;
    const avgMinutes = (hours * 60) / sessions;
    if (avgMinutes < 30) return 'Trop peu de temps par séance en moyenne (< 30 min).';
    if (avgMinutes > 300) return 'Trop long par séance en moyenne (> 5 h).';
    return null;
  }, [formData.hoursPerWeek, formData.maxSessionsPerWeek]);

  const coherenceWarnings = useMemo(() => {
    const base = checkPlanCoherence(formData) || [];
    if (hoursSessionsWarning) base.unshift(hoursSessionsWarning);
    return base;
  }, [formData, hoursSessionsWarning]);

  if (!isOpen) return null;

  const getAverageTimeIndicator = () => {
    if (formData.sportType === 'running') {
      return AVG_TIME_TABLE.running[formData.distance]?.[formData.gender] || 'Variable selon niveau';
    }
    return AVG_TIME_TABLE.triathlon[formData.triathlonFormat] || 'Variable selon niveau';
  };

  const handleNext = () => setStep((s) => Math.min(4, s + 1));
  const handlePrev = () => setStep((s) => Math.max(1, s - 1));

  const hhmmToMinutes = (str) => {
    if (!str) return 0;
    if (typeof str === 'number') return str;
    const m = String(str).trim();
    if (m.includes(':')) {
      const [h, mm] = m.split(':').map(Number);
      return (h || 0) * 60 + (mm || 0);
    }
    if (m.endsWith('h')) return parseFloat(m) * 60;
    if (m.endsWith('min')) return parseFloat(m);
    // fallback parse float as minutes
    return parseFloat(m) || 0;
  };

  const minutesToHHMM = (mins) => {
    if (!Number.isFinite(mins)) return '';
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h${m.toString().padStart(2, '0')}m` : `${m}m`;
  };

  // for triathlon, compute total automatically
  const computeTriTotal = () => {
    const swim = hhmmToMinutes(formData.triathlonTimes.swim);
    const t1 = hhmmToMinutes(formData.triathlonTimes.transition_t1);
    const bike = hhmmToMinutes(formData.triathlonTimes.bike);
    const t2 = hhmmToMinutes(formData.triathlonTimes.transition_t2);
    const run = hhmmToMinutes(formData.triathlonTimes.run);
    const total = swim + t1 + bike + t2 + run;
    return total;
  };

  // when triathlon times change, update total field
  const updateTriField = (key, value) => {
    const next = { ...formData, triathlonTimes: { ...formData.triathlonTimes, [key]: value } };
    // compute total
    const total = (() => {
      const swim = hhmmToMinutes(next.triathlonTimes.swim);
      const t1 = hhmmToMinutes(next.triathlonTimes.transition_t1);
      const bike = hhmmToMinutes(next.triathlonTimes.bike);
      const t2 = hhmmToMinutes(next.triathlonTimes.transition_t2);
      const run = hhmmToMinutes(next.triathlonTimes.run);
      return minutesToHHMM(swim + t1 + bike + t2 + run);
    })();
    next.triathlonTimes.total = total;
    setFormData(next);
  };

  // running: pace <-> total time (based on distance)
  const runningDistanceKm = useMemo(() => {
    if (formData.runningSubtype === 'trail') return Number(formData.trailKm) || 0;
    const map = { '5km': 5, '10km': 10, 'Semi-marathon': 21.0975, Marathon: 42.195 };
    return map[formData.distance] || 0;
  }, [formData.runningSubtype, formData.distance, formData.trailKm]);

  const runningTotalMinutes = useMemo(() => {
    return formData.runningPace * runningDistanceKm;
  }, [formData.runningPace, runningDistanceKm]);

  const onRunningTotalChange = (valMinutes) => {
    const pace = runningDistanceKm > 0 ? valMinutes / runningDistanceKm : formData.runningPace;
    setFormData({ ...formData, runningPace: Number(pace), targetTime: minutesToHHMM(valMinutes) });
  };

  const stepIsValid = () => {
    if (step === 1) return Boolean(formData.weight);
    if (step === 4) return Boolean(formData.targetDate) && Number(formData.hoursPerWeek) > 0 && Number(formData.maxSessionsPerWeek) > 0;
    return true;
  };

  const formatDateFR = (iso) => {
    if (!iso) return '';
    try {
      return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(iso));
    } catch (e) {
      return iso;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-6 text-slate-100 max-h-[90vh] overflow-y-auto">

        <div className="flex justify-between items-center border-b border-slate-800 pb-4">
          <div>
            <span className="text-[10px] font-mono text-orange-400 uppercase tracking-widest block">Assistant de création</span>
            <h2 className="text-lg font-bold">Configuration de ton plan d'entraînement</h2>
          </div>
          <span className="text-xs font-mono text-slate-500 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">Étape {step} / 4</span>
        </div>

        <div className="space-y-4">

          {/* STEP 1 */}
          {step === 1 && (
            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wide text-orange-400">1. Profil & discipline</h3>
              {/* ... same as before for basic fields ... */}
            </div>
          )}

          {/* STEP 2 same as before ... */}

          {/* STEP 3 : Objectif & prédiction */}
          {step === 3 && (
            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wide text-orange-400">3. Objectif & prédiction de temps</h3>

              <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl text-xs space-y-1">
                <span className="text-[10px] text-slate-500 uppercase block font-mono">💡 Indicateur de référence moyen ({formData.gender})</span>
                <p className="text-slate-300">Temps moyen estimé : <strong className="text-orange-400 font-mono">{getAverageTimeIndicator()}</strong></p>
              </div>

              {formData.sportType === 'triathlon' ? (
                <div className="space-y-2">
                  <label className="text-[10px] text-slate-400 block">Temps visé par discipline (hh:mm)</label>
                  <div className="grid grid-cols-6 gap-2 font-mono text-xs">
                    <input type="text" placeholder="Nat (ex: 00:30)" value={formData.triathlonTimes.swim} onChange={(e) => updateTriField('swim', e.target.value)} className="col-span-1 bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs" />
                    <input type="text" placeholder="T1 (ex: 00:02)" value={formData.triathlonTimes.transition_t1} onChange={(e) => updateTriField('transition_t1', e.target.value)} className="col-span-1 bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs" />
                    <input type="text" placeholder="Vélo (ex: 01:15)" value={formData.triathlonTimes.bike} onChange={(e) => updateTriField('bike', e.target.value)} className="col-span-2 bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs" />
                    <input type="text" placeholder="T2 (ex: 00:01)" value={formData.triathlonTimes.transition_t2} onChange={(e) => updateTriField('transition_t2', e.target.value)} className="col-span-1 bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs" />
                    <input type="text" placeholder="Course (ex: 00:45)" value={formData.triathlonTimes.run} onChange={(e) => updateTriField('run', e.target.value)} className="col-span-1 bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs" />
                    <div className="col-span-6 text-xs text-slate-400">Temps global calculé : <strong className="text-orange-400">{formData.triathlonTimes.total}</strong></div>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Chrono cible visé</label>
                  <div className="flex items-center gap-3">
                    <input type="text" placeholder="ex: 42 min ou 1h35" value={formData.targetTime} onChange={(e) => setFormData({ ...formData, targetTime: e.target.value })} className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono" />
                    <div className="w-48">
                      <label className="text-xs text-slate-400 block mb-1">Allure (min/km)</label>
                      <input type="range" min="3" max="8" step="0.1" value={formData.runningPace} onChange={(e) => setFormData({ ...formData, runningPace: Number(e.target.value) })} className="w-full" />
                      <div className="text-xs text-slate-400">Allure actuelle : <strong className="text-orange-400">{formData.runningPace.toFixed(2)} min/km</strong></div>
                      <div className="text-xs text-slate-400">Temps estimé : <strong className="text-orange-400">{minutesToHHMM(runningTotalMinutes)}</strong></div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 4 */}
          {step === 4 && (
            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wide text-orange-400">4. Date & disponibilités</h3>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Date de l'objectif</label>
                <input type="date" value={formData.targetDate} onChange={(e) => setFormData({ ...formData, targetDate: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono" />
                {formData.targetDate && <div className="text-xs text-slate-400 mt-1">Format: {formatDateFR(formData.targetDate)}</div>}
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Volume horaire hebdo disponible : <strong className="text-orange-400 font-mono">{formData.hoursPerWeek} h</strong></label>
                <input type="range" min="2" max="20" step="0.5" value={formData.hoursPerWeek} onChange={(e) => setFormData({ ...formData, hoursPerWeek: Number(e.target.value) })} className="w-full accent-orange-500 cursor-pointer" />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Nombre de séances par semaine : <strong className="text-orange-400 font-mono">{formData.maxSessionsPerWeek} séances</strong></label>
                <input type="range" min="2" max="12" step="1" value={formData.maxSessionsPerWeek} onChange={(e) => setFormData({ ...formData, maxSessionsPerWeek: Number(e.target.value) })} className="w-full accent-orange-500 cursor-pointer" />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Jour(s) de repos obligatoire</label>
                <select value={formData.offDays} onChange={(e) => setFormData({ ...formData, offDays: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white">
                  {['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              {/* Vérification de cohérence heures/séances + format */}
              {coherenceWarnings.length > 0 && (
                <div className="bg-rose-950/50 border border-rose-800/80 p-3 rounded-xl text-xs text-rose-300 space-y-1.5">
                  <span className="font-bold block font-mono">⚠️ Alerte de cohérence :</span>
                  {coherenceWarnings.map((w, i) => (
                    <p key={i} className="leading-relaxed">{w}</p>
                  ))}
                </div>
              )}

              {submitError && (
                <div className="bg-rose-950/50 border border-rose-800/80 p-3 rounded-xl text-xs text-rose-300">{submitError}</div>
              )}
            </div>
          )}

        </div>

        <div className="flex justify-between items-center border-t border-slate-800 pt-4">
          {step > 1 ? (
            <button type="button" onClick={handlePrev} disabled={submitting} className="px-4 py-2 rounded-xl border border-slate-800 text-xs text-slate-400 hover:text-white">Retour</button>
          ) : (
            <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 rounded-xl border border-slate-800 text-xs text-slate-400 hover:text-white">Annuler</button>
          )}

          {step < 4 ? (
            <button type="button" onClick={handleNext} disabled={!stepIsValid()} className="px-5 py-2 rounded-xl bg-orange-500 text-slate-950 font-bold text-xs hover:bg-orange-400">Suivant</button>
          ) : (
            <button type="button" onClick={() => onComplete && onComplete(formData)} disabled={submitting || !stepIsValid()} className="px-5 py-2 rounded-xl bg-orange-500 text-slate-950 font-bold text-xs hover:bg-orange-400">{submitting ? 'Génération en cours…' : 'Générer mon plan'}</button>
          )}
        </div>

      </div>
    </div>
  );
}
