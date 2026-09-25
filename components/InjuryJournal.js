// components/InjuryJournal.js
//
// Journal de douleurs/blessures — signale une gêne récurrente (genou, épaule…) qui doit
// influencer la génération du plan (voir lib/gemini.js:buildInjuryBlock, injecté dans le
// prompt IA exactement comme hrvBlock). Stocké dans STORAGE_KEYS.injuryLog (voir
// lib/storage.js), synchronisé comme le reste via le snapshot cloud (lib/cloudSync.js).
import React, { useEffect, useState } from 'react';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '../lib/storage';

export const BODY_PARTS = ['Genou', 'Épaule', 'Hanche', 'Cheville / pied', 'Dos / lombaires', "Mollet / tendon d'Achille", 'Autre'];

const SEVERITY_LABELS = { 1: 'Légère gêne', 2: 'Gêne notable', 3: 'Douleur modérée', 4: 'Douleur forte', 5: "Empêche l'entraînement" };

function fmtDate(d) {
  try { return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; }
}

function newId() {
  return `inj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function InjuryJournal() {
  const [entries, setEntries] = useState([]);
  const [bodyPart, setBodyPart] = useState(BODY_PARTS[0]);
  const [severity, setSeverity] = useState(2);
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    setEntries(loadFromStorage(STORAGE_KEYS.injuryLog, []));
    setDate(new Date().toISOString().slice(0, 10));
  }, []);

  const persist = (next) => {
    setEntries(next);
    saveToStorage(STORAGE_KEYS.injuryLog, next);
  };

  const addEntry = () => {
    if (!date) return;
    const entry = { id: newId(), date, bodyPart, severity, note: note.trim(), resolved: false, resolvedDate: null };
    persist([entry, ...entries]);
    setNote('');
    setSeverity(2);
  };

  const markResolved = (id) => {
    persist(entries.map((e) => (e.id === id ? { ...e, resolved: true, resolvedDate: new Date().toISOString().slice(0, 10) } : e)));
  };
  const reactivate = (id) => {
    persist(entries.map((e) => (e.id === id ? { ...e, resolved: false, resolvedDate: null } : e)));
  };
  const removeEntry = (id) => {
    persist(entries.filter((e) => e.id !== id));
  };

  const active = entries.filter((e) => !e.resolved).sort((a, b) => new Date(b.date) - new Date(a.date));
  const resolved = entries.filter((e) => e.resolved).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-4 text-ink-100">
      <div>
        <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">🩹 Journal de douleurs / blessures</span>
        <p className="text-[10px] text-ink-500 mt-1 leading-relaxed">
          Signale une gêne récurrente : tant qu'elle reste active, le coach IA en tient compte pour éviter
          d'aggraver la zone concernée (voir onglet Chat pour lui en parler directement aussi).
        </p>
      </div>

      {active.length > 0 && (
        <div className="space-y-2">
          <span className="text-[9px] text-amber-400 uppercase font-bold">Gênes actives ({active.length})</span>
          {active.map((e) => (
            <div key={e.id} className="p-3 rounded-xl border border-amber-800/60 bg-amber-950/20">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-xs font-bold text-ink-50">{e.bodyPart}</span>
                  <span className="text-[10px] text-amber-400 ml-2">{SEVERITY_LABELS[e.severity]}</span>
                  <div className="text-[10px] text-ink-500 mt-0.5">Depuis le {fmtDate(e.date)}</div>
                  {e.note && <p className="text-[11px] text-ink-300 mt-1.5 leading-relaxed">{e.note}</p>}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button onClick={() => markResolved(e.id)} className="text-[9px] font-bold text-emerald-400 border border-emerald-800/60 rounded-lg px-2 py-1 min-h-tap">✓ Résolue</button>
                  <button onClick={() => removeEntry(e.id)} className="text-[9px] font-bold text-ink-500 border border-ink-800 rounded-lg px-2 py-1 min-h-tap">Suppr.</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Formulaire d'ajout */}
      <div className="p-3 rounded-xl border border-ink-800 bg-ink-950 space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-ink-400 block mb-1">Zone</label>
            <select value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} className="w-full bg-ink-900 border border-ink-800 rounded-xl p-2 text-xs text-ink-50 min-h-tap">
              {BODY_PARTS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-ink-400 block mb-1">Depuis le</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full bg-ink-900 border border-ink-800 rounded-xl p-2 text-xs text-ink-50 min-h-tap" />
          </div>
        </div>
        <div>
          <label className="text-[10px] text-ink-400 block mb-1">Intensité : <span className="text-amber-400 font-bold">{SEVERITY_LABELS[severity]}</span></label>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                onClick={() => setSeverity(s)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold min-h-tap ${severity === s ? 'bg-amber-500 text-ink-950' : 'bg-ink-900 border border-ink-800 text-ink-400'}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[10px] text-ink-400 block mb-1">Note (optionnel)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ex : douleur au genou externe après les sorties longues vélo"
            rows={2}
            className="w-full bg-ink-900 border border-ink-800 rounded-xl p-2 text-xs text-ink-50 resize-none"
          />
        </div>
        <button onClick={addEntry} className="w-full bg-volt-500 hover:bg-volt-400 text-ink-50 font-bold text-xs py-2.5 rounded-xl min-h-tap">
          Signaler cette gêne
        </button>
      </div>

      {resolved.length > 0 && (
        <details className="text-[11px]">
          <summary className="text-ink-500 cursor-pointer select-none">Historique ({resolved.length} résolue{resolved.length > 1 ? 's' : ''})</summary>
          <div className="mt-2 space-y-1.5">
            {resolved.map((e) => (
              <div key={e.id} className="flex items-center justify-between p-2 rounded-lg bg-ink-950 border border-ink-800">
                <span className="text-ink-400">{e.bodyPart} — {fmtDate(e.date)} → {fmtDate(e.resolvedDate)}</span>
                <div className="flex gap-2">
                  <button onClick={() => reactivate(e.id)} className="text-[9px] text-amber-400">Réactiver</button>
                  <button onClick={() => removeEntry(e.id)} className="text-[9px] text-ink-500">Suppr.</button>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
