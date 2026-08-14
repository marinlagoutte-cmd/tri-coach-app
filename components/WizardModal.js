// components/WizardModal.js
import React, { useState } from 'react';

export default function WizardModal({ isOpen, onClose, onComplete }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    // Étape 1 : Profil de base
    gender: 'homme',
    weight: '',
    fitnessLevel: 3,
    sportType: 'running', // 'running' | 'triathlon'
    
    // Étape 2 : Spécificités course
    runningSubtype: 'road', // 'road' | 'trail'
    distance: '10km',
    trailKm: '',
    trailElevation: '',
    triathlonFormat: 'M',
    customDistances: { swim: 1.5, bike: 40, run: 10 },

    // Étape 3 : Objectifs & Temps
    targetTime: '',
    triathlonTimes: { swim: '', transition: '', bike: '', total: '' },

    // Étape 4 : Disponibilités & Charge
    maxSessionsPerWeek: 4,
  });

  if (!isOpen) return null;

  // Calcul d'un indicateur de temps moyen indicatif selon le profil
  const getAverageTimeIndicator = () => {
    if (formData.sportType === 'running') {
      if (formData.distance === '5km') return formData.gender === 'homme' ? '20 - 24 min' : '23 - 28 min';
      if (formData.distance === '10km') return formData.gender === 'homme' ? '42 - 50 min' : '48 - 58 min';
      if (formData.distance === 'Semi-marathon') return formData.gender === 'homme' ? '1h35 - 1h50' : '1h50 - 2h05';
      if (formData.distance === 'Marathon') return formData.gender === 'homme' ? '3h30 - 4h00' : '3h55 - 4h30';
    }
    if (formData.sportType === 'triathlon') {
      if (formData.triathlonFormat === 'XS') return '40 - 50 min';
      if (formData.triathlonFormat === 'S') return '1h10 - 1h25';
      if (formData.triathlonFormat === 'M') return '2h30 - 2h50';
      if (formData.triathlonFormat === 'L') return '4h45 - 5h30';
      if (formData.triathlonFormat === 'XL') return '10h00 - 12h00';
    }
    return 'Variable selon niveau';
  };

  const handleNext = () => setStep((s) => s + 1);
  const handlePrev = () => setStep((s) => Math.max(1, s - 1));

  const handleSubmit = () => {
    if (onComplete) onComplete(formData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-6 text-slate-100">
        
        {/* En-tête */}
        <div className="flex justify-between items-center border-b border-slate-800 pb-4">
          <div>
            <span className="text-[10px] font-mono text-orange-400 uppercase tracking-widest block">Assistant de création</span>
            <h2 className="text-lg font-bold">Configuration de ton Plan d'Entraînement</h2>
          </div>
          <span className="text-xs font-mono text-slate-500 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
            Étape {step} / 4
          </span>
        </div>

        {/* Corps des étapes */}
        <div className="space-y-4">
          
          {/* ÉTAPE 1 : Profil & Discipline */}
          {step === 1 && (
            <div className="space-y-4 animate-fadeIn">
              <h3 className="text-xs font-black uppercase tracking-wide text-orange-400">1. Profil & Discipline</h3>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Genre</label>
                  <select 
                    value={formData.gender} 
                    onChange={(e) => setFormData({...formData, gender: e.target.value})}
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
                    onChange={(e) => setFormData({...formData, weight: e.target.value})}
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
                  onChange={(e) => setFormData({...formData, fitnessLevel: Number(e.target.value)})}
                  className="w-full accent-orange-500 cursor-pointer"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Discipline principale</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData({...formData, sportType: 'running'})}
                    className={`p-3 rounded-xl border text-xs font-bold text-left transition-all ${
                      formData.sportType === 'running' 
                        ? 'bg-orange-500/10 border-orange-500 text-orange-400' 
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    🏃‍♂️ Course à pied
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({...formData, sportType: 'triathlon'})}
                    className={`p-3 rounded-xl border text-xs font-bold text-left transition-all ${
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

          {/* ÉTAPE 2 : Spécificités de la course ou du triathlon */}
          {step === 2 && (
            <div className="space-y-4 animate-fadeIn">
              {formData.sportType === 'running' ? (
                <div className="space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-wide text-orange-400">2. Format Course à Pied</h3>
                  
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({...formData, runningSubtype: 'road'})}
                      className={`px-3 py-1.5 rounded-lg border text-xs ${formData.runningSubtype === 'road' ? 'bg-slate-800 text-white border-slate-700' : 'text-slate-500 border-slate-900'}`}
                    >
                      Route
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({...formData, runningSubtype: 'trail'})}
                      className={`px-3 py-1.5 rounded-lg border text-xs ${formData.runningSubtype === 'trail' ? 'bg-slate-800 text-white border-slate-700' : 'text-slate-500 border-slate-900'}`}
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
                          onClick={() => setFormData({...formData, distance: dist})}
                          className={`p-3 rounded-xl border text-xs font-mono font-bold ${formData.distance === dist ? 'bg-orange-500 text-slate-950 border-orange-400' : 'bg-slate-950 text-slate-300 border-slate-800'}`}
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
                          onChange={(e) => setFormData({...formData, trailKm: e.target.value})}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 block mb-1">Dénivelé positif (D+ m)</label>
                        <input 
                          type="number" 
                          placeholder="ex: 2500"
                          value={formData.trailElevation}
                          onChange={(e) => setFormData({...formData, trailElevation: e.target.value})}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-wide text-orange-400">2. Format Triathlon</h3>
                  
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
                          setFormData({...formData, triathlonFormat: fmt, customDistances: d});
                        }}
                        className={`py-2 rounded-xl border text-xs font-mono font-bold text-center ${formData.triathlonFormat === fmt ? 'bg-orange-500 text-slate-950 border-orange-400' : 'bg-slate-950 text-slate-300 border-slate-800'}`}
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
                        <input type="number" step="0.1" value={formData.customDistances.swim} onChange={(e)=>setFormData({...formData, customDistances: {...formData.customDistances, swim: Number(e.target.value)}})} className="w-full bg-slate-900 border border-slate-800 p-1.5 rounded text-white text-center" />
                      </div>
                      <div>
                        <span className="text-[9px] text-amber-400 block">Vélo</span>
                        <input type="number" step="1" value={formData.customDistances.bike} onChange={(e)=>setFormData({...formData, customDistances: {...formData.customDistances, bike: Number(e.target.value)}})} className="w-full bg-slate-900 border border-slate-800 p-1.5 rounded text-white text-center" />
                      </div>
                      <div>
                        <span className="text-[9px] text-emerald-400 block">Course</span>
                        <input type="number" step="0.5" value={formData.customDistances.run} onChange={(e)=>setFormData({...formData, customDistances: {...formData.customDistances, run: Number(e.target.value)}})} className="w-full bg-slate-900 border border-slate-800 p-1.5 rounded text-white text-center" />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ÉTAPE 3 : Objectif de temps & Prédiction */}
          {step === 3 && (
            <div className="space-y-4 animate-fadeIn">
              <h3 className="text-xs font-black uppercase tracking-wide text-orange-400">3. Objectif & Prédiction de Temps</h3>
              
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
                    <input type="text" placeholder="Nat (ex: 30m)" value={formData.triathlonTimes.swim} onChange={(e)=>setFormData({...formData, triathlonTimes: {...formData.triathlonTimes, swim: e.target.value}})} className="bg-slate-950 border border-slate-800 p-2 rounded-xl text-white text-center" />
                    <input type="text" placeholder="Transits" value={formData.triathlonTimes.transition} onChange={(e)=>setFormData({...formData, triathlonTimes: {...formData.triathlonTimes, transition: e.target.value}})} className="bg-slate-950 border border-slate-800 p-2 rounded-xl text-white text-center" />
                    <input type="text" placeholder="Vélo (ex: 1h15)" value={formData.triathlonTimes.bike} onChange={(e)=>setFormData({...formData, triathlonTimes: {...formData.triathlonTimes, bike: e.target.value}})} className="bg-slate-950 border border-slate-800 p-2 rounded-xl text-white text-center" />
                  </div>
                  <input type="text" placeholder="Temps global visé (ex: 2h35)" value={formData.triathlonTimes.total} onChange={(e)=>setFormData({...formData, triathlonTimes: {...formData.triathlonTimes, total: e.target.value}})} className="w-full bg-slate-950 border border-slate-800 p-2.5 rounded-xl text-white text-center font-mono text-xs" />
                </div>
              ) : (
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Chrono cible visé</label>
                  <input 
                    type="text" 
                    placeholder="ex: 42 min ou 1h35" 
                    value={formData.targetTime}
                    onChange={(e) => setFormData({...formData, targetTime: e.target.value})}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-mono"
                  />
                </div>
              )}
            </div>
          )}

          {/* ÉTAPE 4 : Disponibilités & Cohérence */}
          {step === 4 && (
            <div className="space-y-4 animate-fadeIn">
              <h3 className="text-xs font-black uppercase tracking-wide text-orange-400">4. Disponibilités & Charge</h3>
              
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Nombre maximum de séances par semaine : <strong className="text-orange-400 font-mono">{formData.maxSessionsPerWeek} séances</strong>
                </label>
                <input 
                  type="range" 
                  min="2" 
                  max="7" 
                  step="1"
                  value={formData.maxSessionsPerWeek}
                  onChange={(e) => setFormData({...formData, maxSessionsPerWeek: Number(e.target.value)})}
                  className="w-full accent-orange-500 cursor-pointer"
                />
              </div>

              {/* Vérification de cohérence */}
              {((formData.distance === 'Marathon' || formData.triathlonFormat === 'L' || formData.triathlonFormat === 'XL') && formData.maxSessionsPerWeek < 4) && (
                <div className="bg-rose-950/50 border border-rose-800/80 p-3 rounded-xl text-xs text-rose-300 font-mono space-y-1">
                  <span className="font-bold block">⚠️ Alerte de cohérence :</span>
                  Préparer un format long avec moins de 4 séances par semaine est insuffisant pour un entraînement sécurisé et qualitatif.
                </div>
              )}
            </div>
          )}

        </div>

        {/* Boutons de navigation */}
        <div className="flex justify-between items-center border-t border-slate-800 pt-4">
          {step > 1 ? (
            <button 
              type="button" 
              onClick={handlePrev}
              className="px-4 py-2 rounded-xl border border-slate-800 text-xs text-slate-400 hover:text-white"
            >
              Retour
            </button>
          ) : <div />}

          {step < 4 ? (
            <button 
              type="button" 
              onClick={handleNext}
              className="px-5 py-2 rounded-xl bg-orange-500 text-slate-950 font-bold text-xs hover:bg-orange-400 transition-colors"
            >
              Suivant
            </button>
          ) : (
            <button 
              type="button" 
              onClick={handleSubmit}
              className="px-5 py-2 rounded-xl bg-orange-500 text-slate-950 font-bold text-xs hover:bg-orange-400 transition-colors"
            >
              Générer mon plan
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
