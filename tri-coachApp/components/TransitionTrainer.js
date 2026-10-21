// components/TransitionTrainer.js
//
// OUTIL « TRANSITIONS » (onglet Outils) : checklist de course + routines T1/T2 + rappels du
// règlement. (Le chrono de transition a été retiré à la demande de l'athlète.)
//
// Sources des rappels du règlement (réglementation FFTri, reprise par les règlements
// d'épreuves) : même tenue du départ à l'arrivée hors distances L et plus ; tenue club
// obligatoire sous la combinaison en championnat des clubs ; combinaison néoprène obligatoire
// sous 16 °C, autorisée jusqu'à 24,5 °C, interdite au-delà ; tenue 100 % textile si la
// combinaison est interdite ; mains et pieds non couverts en natation ; torse couvert à vélo et
// en course ; dossard dans le dos à vélo, devant en course ; casque attaché avant de toucher le
// vélo, détaché une fois le vélo raccroché ; appareils audio interdits ; licence ou Pass
// Compétition et pièce d'identité au retrait du dossard. Toujours vérifier le règlement de
// l'épreuve (seuils et obligations peuvent varier).
//
// La checklist s'adapte au sport de l'objectif (pas de natation en duathlon, ni de vélo en
// course à pied). Les ajouts personnels et les éléments cochés sont conservés (y compris ceux
// de l'ancienne liste à plat, migrés automatiquement).

import { useEffect, useMemo, useState } from 'react';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '../lib/storage';
import { CHECKLIST_CATEGORIES, ROUTINES, RULES, migrateChecklistState } from '../lib/raceChecklist';

export default function TransitionTrainer({ sportType = 'triathlon' }) {
  const [state, setState] = useState(() => migrateChecklistState(loadFromStorage(STORAGE_KEYS.transitionsChecklist, null)));
  const [newItem, setNewItem] = useState('');
  const [openRoutines, setOpenRoutines] = useState(false);
  const [openRules, setOpenRules] = useState(false);

  useEffect(() => { saveToStorage(STORAGE_KEYS.transitionsChecklist, { version: 2, ...state }); }, [state]);

  const sport = ['triathlon', 'duathlon', 'running'].includes(sportType) ? sportType : 'triathlon';
  const groups = useMemo(() => [
    ...CHECKLIST_CATEGORIES.filter((c) => c.sports.includes(sport)).map((c) => ({ ...c, items: c.items.filter((i) => !state.hidden.includes(i)) })),
    ...(state.custom.length ? [{ id: 'perso', label: 'Mes ajouts', items: state.custom }] : []),
  ].filter((g) => g.items.length), [sport, state]);
  const all = groups.flatMap((g) => g.items);
  const checkedCount = all.filter((i) => state.checked.includes(i)).length;

  const toggle = (item) => setState((s) => ({ ...s, checked: s.checked.includes(item) ? s.checked.filter((i) => i !== item) : [...s.checked, item] }));
  const remove = (item) => setState((s) => ({
    custom: s.custom.filter((i) => i !== item),
    hidden: s.custom.includes(item) ? s.hidden : [...s.hidden, item],
    checked: s.checked.filter((i) => i !== item),
  }));
  const add = () => {
    const v = newItem.trim();
    if (!v || all.includes(v)) return;
    setState((s) => ({ ...s, custom: [...s.custom, v] }));
    setNewItem('');
  };

  const t1Label = sport === 'duathlon' ? 'course → vélo' : 'natation → vélo';

  return (
    <div className="space-y-3">
      <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-ink-50">Checklist de course</p>
            <p className="text-xs text-ink-400">{checkedCount} / {all.length} prêts</p>
          </div>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setState((s) => ({ ...s, checked: [] }))} className="min-h-[34px] px-2.5 rounded-lg border border-ink-800 text-xs font-bold text-ink-400">Tout décocher</button>
            {state.hidden.length > 0 && (
              <button type="button" onClick={() => setState((s) => ({ ...s, hidden: [] }))} className="min-h-[34px] px-2.5 rounded-lg border border-ink-800 text-xs font-bold text-ink-400">Restaurer</button>
            )}
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-ink-950 overflow-hidden" aria-hidden="true">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${all.length ? Math.round((checkedCount / all.length) * 100) : 0}%` }} />
        </div>

        {groups.map((g) => (
          <section key={g.id} aria-label={g.label}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500 pt-1.5">{g.label}</p>
            <ul className="divide-y divide-ink-800/70">
              {g.items.map((item) => (
                <li key={item} className="flex items-center gap-1">
                  <label className="flex-1 flex items-center gap-2.5 min-h-[40px] cursor-pointer">
                    <input type="checkbox" checked={state.checked.includes(item)} onChange={() => toggle(item)} className="w-[18px] h-[18px] accent-volt-500 shrink-0" />
                    <span className={`text-sm leading-snug ${state.checked.includes(item) ? 'text-ink-500 line-through' : 'text-ink-100'}`}>{item}</span>
                  </label>
                  <button type="button" onClick={() => remove(item)} className="min-h-[40px] min-w-[36px] text-ink-600 text-sm" aria-label={`Retirer ${item}`}>✕</button>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <div className="flex gap-2 pt-1">
          <input
            type="text"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="Ajouter un élément…"
            className="flex-1 min-w-0 bg-ink-950 border border-ink-800 rounded-xl px-3 min-h-[40px] text-base text-ink-50"
          />
          <button type="button" onClick={add} className="min-h-[40px] px-4 rounded-xl bg-volt-500 text-white text-sm font-bold shrink-0">Ajouter</button>
        </div>
      </div>

      {sport !== 'running' && (
        <div className="bg-ink-900 border border-ink-800 rounded-2xl">
          <button type="button" aria-expanded={openRoutines} onClick={() => setOpenRoutines((o) => !o)} className="w-full min-h-[44px] px-3.5 flex items-center justify-between">
            <span className="text-sm font-bold text-ink-50">Routines T1 et T2</span>
            <span className={`text-ink-500 text-lg transition-transform ${openRoutines ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
          </button>
          {openRoutines && (
            <div className="px-3.5 pb-3.5 space-y-3">
              {Object.entries(ROUTINES).map(([k, steps]) => (
                <div key={k}>
                  <p className="text-xs font-bold text-ink-300 mb-1">{k} — {k === 'T1' ? t1Label : 'vélo → course'}</p>
                  <ol className="space-y-0.5 list-decimal list-inside">
                    {steps.filter((st) => !(sport === 'duathlon' && /Bonnet|Combinaison/.test(st))).map((st) => (
                      <li key={st} className="text-sm text-ink-300 leading-snug">{st}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-ink-900 border border-ink-800 rounded-2xl">
        <button type="button" aria-expanded={openRules} onClick={() => setOpenRules((o) => !o)} className="w-full min-h-[44px] px-3.5 flex items-center justify-between">
          <span className="text-sm font-bold text-ink-50">Rappels du règlement</span>
          <span className={`text-ink-500 text-lg transition-transform ${openRules ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
        </button>
        {openRules && (
          <div className="px-3.5 pb-3.5 space-y-2">
            <ul className="space-y-1.5 list-disc list-inside">
              {RULES.filter((r) => sport === 'triathlon' || !/natation|néoprène/i.test(r)).map((r) => (
                <li key={r} className="text-sm text-ink-300 leading-snug">{r}</li>
              ))}
            </ul>
            <p className="text-[11px] text-ink-500 leading-snug">D'après la réglementation FFTri reprise par les règlements d'épreuves. Vérifie toujours le règlement de ta course : seuils et obligations peuvent varier.</p>
          </div>
        )}
      </div>
    </div>
  );
}
