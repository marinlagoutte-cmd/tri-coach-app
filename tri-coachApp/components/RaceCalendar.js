// components/RaceCalendar.js
//
// Calendrier de courses multi-saisons (Point 7) — plusieurs échéances avec priorités
// A/B/C, articulées par lib/periodization.js:computeMultiRacePeriodization (mésocycles
// réels par échéance : affûtage complet pour une priorité A, mini-affûtage + courte
// récupération pour une B/C, sans remettre à zéro la trajectoire de fond). Stocké dans
// STORAGE_KEYS.raceCalendar. Reste vide par défaut : l'athlète mono-objectif continue
// d'utiliser uniquement le wizard (`constraints.targetDate`), sans que rien ne change pour
// lui tant qu'il n'ajoute rien ici.
//
// PLAN DE SAISON IMPORTÉ (lib/seasonImport.js) : ses courses sont ajoutées ici à l'import
// (source 'season-plan') et leur fiche (`sheets`, = seasonPlan.races) s'ouvre sous chaque
// course : date et incertitude, lieu, format, parcours, repères 2026, objectif, allures,
// stratégie.
import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '../lib/storage';
import { computeMultiRacePeriodization } from '../lib/periodization';

const PRIORITY_META = {
  A: { label: 'A — Objectif principal', color: '#FC4C02' },
  B: { label: 'B — Préparation', color: '#FBBF24' },
  C: { label: 'C — Découverte / forme', color: '#818CF8' },
};

function newId() {
  return `race_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function fmtDate(d) {
  try { return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; }
}

const SHEET_ROWS = [
  ['dateNote', 'Date'], ['place', 'Lieu'], ['format', 'Format'], ['course', 'Parcours'],
  ['ref2026', 'Repères 2026'], ['objective', 'Objectif'], ['paces', 'Allures'],
];

/** Fiche d'une course du plan de saison. */
function RaceSheet({ sheet }) {
  return (
    <div className="mt-2 space-y-2">
      <dl className="rounded-lg border border-ink-800 divide-y divide-ink-800 overflow-hidden">
        {SHEET_ROWS.filter(([k]) => sheet[k]).map(([k, label]) => (
          <div key={k} className="grid grid-cols-[80px_1fr] gap-2 px-2.5 py-1.5 bg-ink-900">
            <dt className="text-[11px] font-semibold text-ink-400 leading-snug">{label}</dt>
            <dd className="text-[12px] text-ink-100 leading-snug">{sheet[k]}</dd>
          </div>
        ))}
      </dl>
      {sheet.strategy?.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-ink-400 mb-1">Stratégie</p>
          <ul className="space-y-1">
            {sheet.strategy.map((x, i) => (
              <li key={i} className="text-[12px] text-ink-200 leading-snug pl-3 relative before:content-[''] before:absolute before:left-0 before:top-[7px] before:w-1.5 before:h-1.5 before:rounded-full before:bg-volt-500">{x}</li>
            ))}
          </ul>
        </div>
      )}
      {sheet.source && <p className="text-[10px] text-ink-500">Sources : {sheet.source}</p>}
    </div>
  );
}

export default function RaceCalendar({ sportType = 'triathlon', sheets = [] }) {
  const [races, setRaces] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', priority: 'B' });
  const [openSheet, setOpenSheet] = useState(null);

  // Relu aussi quand les fiches changent : un import de plan vient d'ajouter ses courses.
  useEffect(() => {
    setRaces(loadFromStorage(STORAGE_KEYS.raceCalendar, []));
  }, [sheets]);
  const sheetFor = (id) => (sheets || []).find((x) => x.id === id) || null;

  const persist = (next) => {
    setRaces(next);
    saveToStorage(STORAGE_KEYS.raceCalendar, next);
  };

  const addRace = () => {
    if (!form.name.trim() || !form.date) return;
    persist([...races, { id: newId(), name: form.name.trim(), date: form.date, priority: form.priority, sportType }]);
    setForm({ name: '', date: '', priority: 'B' });
    setAdding(false);
  };

  const removeRace = (id) => persist(races.filter((r) => r.id !== id));

  const { phases, races: upcoming } = computeMultiRacePeriodization(races);
  const past = races.filter((r) => new Date(r.date) < new Date());

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-4">
      <div>
        <span className="text-[13px] font-semibold text-ink-100 block">Calendrier de courses (multi-saisons)</span>
        <p className="text-[10px] text-ink-500 mt-1 leading-relaxed">
          Ajoute toutes tes échéances (course B de prépa, objectif A…) : la périodisation s'articule
          automatiquement autour — mini-affûtage + récupération courte pour une B/C, affûtage complet
          pour l'objectif A. Le coach IA en tient aussi compte dans les séances N/N+1.
        </p>
      </div>

      {upcoming.length > 0 && (
        <div className="space-y-1.5">
          {upcoming.map((r) => {
            const sheet = sheetFor(r.id);
            const isOpen = openSheet === r.id;
            return (
              <div key={r.id} className="p-2.5 rounded-xl bg-ink-950 border border-ink-800">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-ink-50">{r.name}</span>
                    <span className="text-[10px] ml-2" style={{ color: PRIORITY_META[r.priority]?.color }}>{PRIORITY_META[r.priority]?.label}</span>
                    <div className="text-[10px] text-ink-500 mt-0.5">{fmtDate(r.date)} · dans {r.daysAway ?? Math.round((new Date(r.date) - new Date()) / 86400000)} j{sheet?.format ? ` · ${sheet.format}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {sheet && (
                      <button
                        type="button"
                        onClick={() => setOpenSheet(isOpen ? null : r.id)}
                        aria-expanded={isOpen}
                        className="text-[10px] font-bold text-volt-500 border border-volt-500/40 rounded-lg px-2 py-1 min-h-tap inline-flex items-center gap-1"
                      >
                        Fiche <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                      </button>
                    )}
                    <button onClick={() => removeRace(r.id)} className="text-[10px] font-bold text-ink-500 border border-ink-800 rounded-lg px-2 py-1 min-h-tap">Suppr.</button>
                  </div>
                </div>
                {sheet && isOpen && <RaceSheet sheet={sheet} />}
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <div className="p-3 rounded-xl border border-ink-800 bg-ink-950 space-y-2.5">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Nom de la course (ex : Semi de Paris)"
            className="w-full bg-ink-900 border border-ink-800 rounded-xl p-2 text-xs text-ink-50"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="w-full bg-ink-900 border border-ink-800 rounded-xl p-2 text-xs text-ink-50 min-h-tap"
            />
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full bg-ink-900 border border-ink-800 rounded-xl p-2 text-xs text-ink-50 min-h-tap">
              {Object.entries(PRIORITY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={addRace} className="flex-1 bg-volt-500 hover:bg-volt-400 text-white font-bold text-xs py-2 rounded-xl min-h-tap">Ajouter</button>
            <button onClick={() => setAdding(false)} className="bg-ink-900 border border-ink-800 text-ink-400 font-bold text-xs px-3 py-2 rounded-xl min-h-tap">Annuler</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="w-full border border-dashed border-ink-800 text-ink-400 font-bold text-xs py-2.5 rounded-xl min-h-tap">
          + Ajouter une échéance
        </button>
      )}

      {phases.length > 0 && (
        <details className="text-[11px]" open={upcoming.length > 1}>
          <summary className="text-ink-500 cursor-pointer select-none">Périodisation calculée ({phases.length} bloc{phases.length > 1 ? 's' : ''})</summary>
          <div className="mt-2 space-y-1.5">
            {phases.map((p) => (
              <div key={p.id} className="p-2 rounded-lg bg-ink-950 border border-ink-800">
                <div className="flex justify-between">
                  <span className="text-ink-100 font-bold">{p.name}</span>
                  <span className="text-ink-500">{p.dates}</span>
                </div>
                <span className="text-[10px] text-ink-500">→ {p.forRaceName} ({p.forRacePriority})</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {past.length > 0 && (
        <details className="text-[11px]">
          <summary className="text-ink-500 cursor-pointer select-none">Courues ({past.length})</summary>
          <div className="mt-2 space-y-1">
            {past.map((r) => (
              <div key={r.id} className="flex items-center justify-between p-2 rounded-lg bg-ink-950 border border-ink-800">
                <span className="text-ink-400">{r.name} — {fmtDate(r.date)}</span>
                <button onClick={() => removeRace(r.id)} className="text-[10px] text-ink-500">Suppr.</button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
