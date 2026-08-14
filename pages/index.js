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
    triathlonTimes: { swim: '', transition: '', bike: '', total: '' },

    targetDate: '',
    hoursPerWeek: 8,
    maxSessionsPerWeek: 4,
    offDays: 'Mercredi',
  });

  const coherenceWarnings = useMemo(() => checkPlanCoherence(formData), [formData]);

  if (!isOpen) return null;

  const getAverageTimeIndicator = () => {
    if (formData.sportType === 'running') {
      return AVG_TIME_TABLE.running[formData.distance]?.[formData.gender] || 'Variable selon niveau';
    }
    return AVG_TIME_TABLE.triathlon[formData.triathlonFormat] || 'Variable selon niveau';
  };

  const handleNext = () => setStep((s) => Math.min(4, s + 1));
  const handlePrev = () => setStep((s) => Math.max(1, s - 1));

  const handleSubmit = () => {
    if (submitting) return;
    if (onComplete) onComplete(formData);
    // Parent decides when to close (after success), so it can show errors otherwise.
  };

  const stepIsValid = () => {
    if (step === 1) return Boolean(formData.weight);
    if (step === 4) return Boolean(formData.targetDate) && Number(formData.hoursPerWeek) > 0 && Number(formData.maxSessionsPerWeek) > 0;
    return true;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-6 text-slate-100 max-h-[90vh] overflow-y-auto">

        <div className="flex justify-between items-center border-b border-slate-800 pb-4">
          <div>
            <span className="text-[10px] font-mono text-orange-400 uppercase tracking-widest block">Assistant de création</span>
            <h2 className="text-lg font-bold">Configuration de ton plan d'entraînement</h2>
          </div>
          <span className="text-xs font-mono text-slate-500 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
            Étape {step} / 4
          </span>
        </div>

        <div className="space-y-4">

          {/* ÉTAPE 1 : Profil & Discipline */}
          {step === 1 && (
            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wide text-orange-400">1. Profil & discipline</h3>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Nom de l'objectif (optionnel)</label>
                <input
                  type="text"
                  value={formData.eventName}
                  onChange={(e) => setFormData({ ...formData, eventName: e.target.value })}
                  placeholder="ex: Marathon de Paris"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Genre</label>
                  <select
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
                  >
                    <option value="homme">Homme</option>
                    <option value="femme">Femme</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Poids (kg)</label>
                  <input
                    type="number"
                    value={formData.weight}
                    onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                    placeholder="ex: 72"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Niveau de condition physique (1 = Débutant, 5 = Expert) : <strong className="text-orange-400">{formData.fitnessLevel}/5</strong>
                </label>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={formData.fitnessLevel}
                  onChange={(e) => setFormData({ ...formData, fitnessLevel: Number(e.target.value) })}
                  className="w-full accent-orange-500 cursor-pointer"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Discipline principale</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, sportType: 'running' })}
                    className={`p-3 rounded-xl border text-xs font-bold text-left transition-all min-h-tap ${
                      formData.sportType === 'running'
                        ? 'bg-orange-500/10 border-orange-500 text-orange-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    🏃‍♂️ Course à pied
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, sportType: 'triathlon' })}
                    className={`p-3 rounded-xl border text-xs font-bold text-left transition-all min-h-tap ${
                      formData.sportType === 'triathlon'
                        ? 'bg-orange-500/10 border-orange-500 text-orange-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    🏊‍♂️🚴‍♂️🏃‍♂️ Triathlon
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ÉTAPE 2 : Spécificités selon la discipline choisie */}
          {step === 2 && (
            <div className="space-y-4">
              {formData.sportType === 'running' ? (
                <div className="space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-wide text-orange-400">2. Format course à pied</h3>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, runningSubtype: 'road' })}
                      className={`px-3 py-1.5 rounded-lg border text-xs min-h-tap ${formData.runningSubtype === 'road' ? 'bg-slate-800 text-white border-slate-700' : 'text-slate-500 border-slate-900'}`}
                    >
                      Route
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, runningSubtype: 'trail' })}
                      className={`px-3 py-1.5 rounded-lg border text-xs min-h-tap ${formData.runningSubtype === 'trail' ? 'bg-slate-800 text-white border-slate-700' : 'text-slate-500 border-slate-900'}`}
                    >
                      Trail
                    </button>
                  </div>

                  {formData.runningSubtype === 'road' ? (
                    <div className="grid grid-cols-2 gap-2">
                      {['5km', '10km', 'Semi-marathon', 'Marathon'].map((dist) => (
                        <button
                          key={dist}
                          type="button"
                          onClick={() => setFormData({ ...formData, distance: dist })}
                          className={`p-3 rounded-xl border text-xs font-mono font-bold min-h-tap ${formData.distance === dist ? 'bg-orange-500 text-slate-950 border-orange-400' : 'bg-slate-950 text-slate-300 border-slate-800'}`}
                        >
                          {dist}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">Distance (km)</label>
                        <input
                          type="number"
                          placeholder="ex: 45"
                          value={formData.trailKm}
                          onChange={(e) => setFormData({ ...formData, trailKm: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">Dénivelé positif (D+ m)</label>
                        <input
                          type="number"
                          placeholder="ex: 2500"
                          value={formData.trailElevation}
                          onChange={(e) => setFormData({ ...formData, trailElevation: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-wide text-orange-400">2. Format triathlon</h3>

                  <div className="grid grid-cols-5 gap-1.5">
                    {['XS', 'S', 'M', 'L', 'XL'].map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => {
                          let d = { swim: 0.75, bike: 20, run: 5 };
                          if (fmt === 'S') d = { swim: 0.75, bike: 20, run: 5 };
                          if (fmt === 'M') d = { swim: 1.5, bike: 40, run: 10 };
                          if (fmt === 'L') d = { swim: 1.9, bike: 90, run: 21.1 };
                          if (fmt === 'XL') d = { swim: 3.8, bike: 180, run: 42.2 };
                          setFormData({ ...formData, triathlonFormat: fmt, customDistances: d });
                        }}
                        className={`py-2 rounded-xl border text-xs font-mono font-bold text-center min-h-tap ${formData.triathlonFormat === fmt ? 'bg-orange-500 text-slate-950 border-orange-400' : 'bg-slate-950 text-slate-300 border-slate-800'}`}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>

                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2 text-xs">
                    <span className="text-[10px] text-slate-500 uppercase font-mono block">Ajustement fin des distances (km)</span>
                    <div className="grid grid-cols-3 gap-2 font-mono">
                      <div>
                        <span className="text-[9px] text-cyan-400 block">Natation</span>
                        <input type="number" step="0.1" value={formData.customDistances.swim} onChange={(e) => setFormData({ ...formData, customDistances: { ...formData.customDistances, swim: Number(e.target.value) } })} className="w-full bg-slate-900 border border-slate-800 p-1.5 rounded text-white text-center" />
                      </div>
                      <div>
                        <span className="text-[9px] text-amber-400 block">Vélo</span>
                        <input type="number" step="1" value={formData.customDistances.bike} onChange={(e) => setFormData({ ...formData, customDistances: { ...formData.customDistances, bike: Number(e.target.value) } })} className="w-full bg-slate-900 border border-slate-800 p-1.5 rounded text-white text-center" />
                      </div>
                      <div>
                        <span className="text-[9px] text-emerald-400 block">Course</span>
                        <input type="number" step="0.5" value={formData.customDistances.run} onChange={(e) => setFormData({ ...formData, customDistances: { ...formData.customDistances, run: Number(e.target.value) } })} className="w-full bg-slate-900 border border-slate-800 p-1.5 rounded text-white text-center" />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ÉTAPE 3 : Objectif de temps & prédiction */}
          {step === 3 && (
            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wide text-orange-400">3. Objectif & prédiction de temps</h3>

              <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl text-xs space-y-1">
                <span className="text-[10px] text-slate-500 uppercase block font-mono">💡 Indicateur de référence moyen ({formData.gender})</span>
                <p className="text-slate-300">
                  Temps moyen estimé : <strong className="text-orange-400 font-mono">{getAverageTimeIndicator()}</strong>
                </p>
              </div>

              {formData.sportType === 'triathlon' ? (
                <div className="space-y-2">
                  <label className="text-[10px] text-slate-400 block">Temps visé par discipline (hh:mm)</label>
                  <div className="grid grid-cols-3 gap-2 font-mono text-xs">
                    <input type="text" placeholder="Nat (ex: 30m)" value={formData.triathlonTimes.swim} onChange={(e) => setFormData({ ...formData, triathlonTimes: { ...formData.triathlonTimes, swim: e.target.value } })} className="bg-slate-950 border border-slate-800 p-2 rounded-xl text-white text-center" />
                    <input type="text" placeholder="Transits" value={formData.triathlonTimes.transition} onChange={(e) => setFormData({ ...formData, triathlonTimes: { ...formData.triathlonTimes, transition: e.target.value } })} className="bg-slate-950 border border-slate-800 p-2 rounded-xl text-white text-center" />
                    <input type="text" placeholder="Vélo (ex: 1h15)" value={formData.triathlonTimes.bike} onChange={(e) => setFormData({ ...formData, triathlonTimes: { ...formData.triathlonTimes, bike: e.target.value } })} className="bg-slate-950 border border-slate-800 p-2 rounded-xl text-white text-center" />
                  </div>
                  <input type="text" placeholder="Temps global visé (ex: 2h35)" value={formData.triathlonTimes.total} onChange={(e) => setFormData({ ...formData, triathlonTimes: { ...formData.triathlonTimes, total: e.target.value } })} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white text-center font-mono text-xs" />
                </div>
              ) : (
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Chrono cible visé</label>
                  <input
                    type="text"
                    placeholder="ex: 42 min ou 1h35"
                    value={formData.targetTime}
                    onChange={(e) => setFormData({ ...formData, targetTime: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono"
                  />
                </div>
              )}
            </div>
          )}

          {/* ÉTAPE 4 : Date, disponibilités & cohérence */}
          {step === 4 && (
            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wide text-orange-400">4. Date & disponibilités</h3>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Date de l'objectif</label>
                <input
                  type="date"
                  value={formData.targetDate}
                  onChange={(e) => setFormData({ ...formData, targetDate: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Volume horaire hebdo disponible : <strong className="text-orange-400 font-mono">{formData.hoursPerWeek} h</strong>
                </label>
                <input
                  type="range"
                  min="2"
                  max="20"
                  step="0.5"
                  value={formData.hoursPerWeek}
                  onChange={(e) => setFormData({ ...formData, hoursPerWeek: Number(e.target.value) })}
                  className="w-full accent-orange-500 cursor-pointer"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Nombre de séances par semaine : <strong className="text-orange-400 font-mono">{formData.maxSessionsPerWeek} séances</strong>
                </label>
                <input
                  type="range"
                  min="2"
                  max="12"
                  step="1"
                  value={formData.maxSessionsPerWeek}
                  onChange={(e) => setFormData({ ...formData, maxSessionsPerWeek: Number(e.target.value) })}
                  className="w-full accent-orange-500 cursor-pointer"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Jour(s) de repos obligatoire</label>
                <input
                  type="text"
                  value={formData.offDays}
                  onChange={(e) => setFormData({ ...formData, offDays: e.target.value })}
                  placeholder="ex: Mercredi"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white"
                />
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
                <div className="bg-rose-950/50 border border-rose-800/80 p-3 rounded-xl text-xs text-rose-300">
                  {submitError}
                </div>
              )}
            </div>
          )}

        </div>

        <div className="flex justify-between items-center border-t border-slate-800 pt-4">
          {step > 1 ? (
            <button
              type="button"
              onClick={handlePrev}
              disabled={submitting}
              className="px-4 py-2 rounded-xl border border-slate-800 text-xs text-slate-400 hover:text-white min-h-tap disabled:opacity-50"
            >
              Retour
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-xl border border-slate-800 text-xs text-slate-400 hover:text-white min-h-tap disabled:opacity-50"
            >
              Annuler
            </button>
          )}

          {step < 4 ? (
            <button
              type="button"
              onClick={handleNext}
              disabled={!stepIsValid()}
              className="px-5 py-2 rounded-xl bg-orange-500 text-slate-950 font-bold text-xs hover:bg-orange-400 transition-colors min-h-tap disabled:opacity-40"
            >
              Suivant
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !stepIsValid()}
              className="px-5 py-2 rounded-xl bg-orange-500 text-slate-950 font-bold text-xs hover:bg-orange-400 transition-colors min-h-tap disabled:opacity-60 flex items-center gap-2"
            >
              {submitting && <span className="w-3 h-3 border-2 border-slate-950/40 border-t-slate-950 rounded-full animate-spin" />}
              {submitting ? 'Génération en cours…' : 'Générer mon plan'}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
