import { useState } from 'react';
export default function WizardModal({ wizardData, setWizardData, wizardStep, setWizardStep, onClose, onFinish, loading }) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-t-3xl sm:rounded-3xl p-5 space-y-4 shadow-2xl">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <h3 className="text-sm font-black uppercase text-white">
            Nouveau Plan <span className="text-orange-400">({wizardStep}/3)</span>
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 font-bold text-sm p-1">✕</button>
        </div>
        {wizardStep === 1 && (
          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-400 font-mono mb-1">Nom du Triathlon / Épreuve</label>
              <input
                type="text"
                value={wizardData.eventName}
                onChange={(e) => setWizardData({ ...wizardData, eventName: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white font-bold focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 font-mono mb-1">Date de l&apos;événement</label>
              <input
                type="date"
                value={wizardData.targetDate}
                onChange={(e) => setWizardData({ ...wizardData, targetDate: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white font-bold focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>
        )}
        {wizardStep === 2 && (
          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-400 font-mono mb-1">Volume disponible (heures/semaine)</label>
              <input
                type="number"
                min={4}
                max={25}
                value={wizardData.hoursPerWeek}
                onChange={(e) => setWizardData({ ...wizardData, hoursPerWeek: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white font-bold focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 font-mono mb-1">Jour de repos obligatoire</label>
              <select
                value={wizardData.offDays}
                onChange={(e) => setWizardData({ ...wizardData, offDays: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white font-bold focus:border-orange-500 focus:outline-none"
              >
                {['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'].map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        {wizardStep === 3 && (
          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-400 font-mono mb-1">Cible Chrono Global</label>
              <input
                type="text"
                value={wizardData.targetGoal}
                onChange={(e) => setWizardData({ ...wizardData, targetGoal: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white font-bold focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-xl text-orange-300 text-[11px]">
              Le coach IA va générer 14 séances (N + N+1) calibrées sur ton profil.
            </div>
          </div>
        )}
        <div className="flex justify-between pt-2 gap-2">
          {wizardStep > 1 && (
            <button
              type="button"
              onClick={() => setWizardStep((s) => s - 1)}
              disabled={loading}
              className="bg-slate-950 border border-slate-800 text-slate-300 font-bold px-4 py-2.5 rounded-xl text-xs uppercase"
            >
              Retour
            </button>
          )}
          {wizardStep < 3 ? (
            <button
              type="button"
              onClick={() => setWizardStep((s) => s + 1)}
              className="bg-orange-500 text-white font-bold px-5 py-2.5 rounded-xl text-xs uppercase ml-auto"
            >
              Suivant
            </button>
          ) : (
            <button
              type="button"
              onClick={onFinish}
              disabled={loading}
              className="bg-gradient-to-r from-orange-500 to-rose-500 disabled:opacity-50 text-white font-black px-5 py-2.5 rounded-xl text-xs uppercase ml-auto shadow-lg"
            >
              {loading ? 'Génération…' : 'Générer le Plan'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
