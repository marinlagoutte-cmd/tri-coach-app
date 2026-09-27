// components/TransitionTrainer.js
//
// OUTIL « TRANSITIONS » (onglet Outils). Chantier prioritaire de l'athlète : une
// disqualification en 2026 venait d'une erreur de transition (dossard oublié, confusion
// casque/bonnet). Trois blocs :
//   1. Checklist de course personnalisable (à cocher la veille / au parc à vélos).
//   2. Routines T1 et T2 dans l'ordre, rappelées avec les règles FFTri les plus citées
//      par les règlements d'épreuves (casque attaché AVANT de décrocher le vélo et détaché
//      seulement APRÈS l'avoir raccroché ; dossard dans le dos à vélo, devant en course,
//      3 points d'attache). Toujours vérifier le règlement de l'épreuve.
//   3. Chrono d'entraînement T1/T2 (gros bouton utilisable en tenue) + historique avec
//      meilleur temps et moyenne des 5 derniers.
// Tout est stocké localement (et synchronisé avec le compte, voir lib/storage.js).

import { useEffect, useMemo, useRef, useState } from 'react';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '../lib/storage';

const DEFAULT_CHECKLIST = [
  'Dossard sur porte-dossard 3 points',
  'Puce de chronométrage',
  'Licence / pièce d\'identité',
  'Casque (numéro collé, jugulaire réglée)',
  'Bonnet + lunettes de natation',
  'Combinaison (si autorisée)',
  'Chaussures vélo (élastiques si départ pieds dessus)',
  'Lunettes de vélo',
  'Chaussures de course (lacets rapides)',
  'Bidon + gels',
  'Plaque de cadre / sticker tige de selle',
];

const ROUTINES = {
  T1: [
    'Bonnet et lunettes retirés en courant vers le parc',
    'Combinaison retirée (si portée)',
    'Casque sur la tête, jugulaire ATTACHÉE',
    'Lunettes de vélo',
    'Porte-dossard : dossard DANS LE DOS (si exigé à vélo)',
    'Décrocher le vélo, sortir à pied vélo à la main',
    'Monter APRÈS la ligne de montée',
  ],
  T2: [
    'Descendre AVANT la ligne de descente',
    'Raccrocher le vélo à ton emplacement',
    'Détacher le casque SEULEMENT maintenant',
    'Chaussures de course',
    'Dossard tourné DEVANT',
    'Sortir du parc en courant',
  ],
};

function formatMs(ms) {
  const totalTenths = Math.floor(ms / 100);
  const tenths = totalTenths % 10;
  const totalSec = Math.floor(totalTenths / 10);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60);
  return `${min}:${String(sec).padStart(2, '0')}.${tenths}`;
}

export default function TransitionTrainer() {
  const [items, setItems] = useState(() => loadFromStorage(STORAGE_KEYS.transitionsChecklist, null)?.items || DEFAULT_CHECKLIST);
  const [checked, setChecked] = useState(() => loadFromStorage(STORAGE_KEYS.transitionsChecklist, null)?.checked || []);
  const [newItem, setNewItem] = useState('');
  const [log, setLog] = useState(() => loadFromStorage(STORAGE_KEYS.transitionsLog, []));
  const [kind, setKind] = useState('T1');
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [lastResult, setLastResult] = useState(null);
  const startRef = useRef(0);

  useEffect(() => { saveToStorage(STORAGE_KEYS.transitionsChecklist, { items, checked }); }, [items, checked]);
  useEffect(() => { saveToStorage(STORAGE_KEYS.transitionsLog, log); }, [log]);

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setElapsed(Date.now() - startRef.current), 100);
    return () => clearInterval(id);
  }, [running]);

  const toggle = (item) => setChecked((prev) => (prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]));
  const addItem = () => {
    const v = newItem.trim();
    if (!v || items.includes(v)) return;
    setItems([...items, v]);
    setNewItem('');
  };
  const removeItem = (item) => {
    setItems(items.filter((i) => i !== item));
    setChecked(checked.filter((i) => i !== item));
  };

  const startStop = () => {
    if (!running) {
      startRef.current = Date.now();
      setElapsed(0);
      setLastResult(null);
      setRunning(true);
      return;
    }
    const ms = Date.now() - startRef.current;
    setRunning(false);
    setElapsed(ms);
    if (ms >= 1000) {
      const entry = { id: `t_${Date.now()}`, kind, ms, date: new Date().toISOString() };
      setLog((prev) => [entry, ...prev].slice(0, 100));
      setLastResult(entry);
    }
  };

  const stats = useMemo(() => {
    const out = {};
    ['T1', 'T2'].forEach((k) => {
      const list = log.filter((e) => e.kind === k);
      const last5 = list.slice(0, 5);
      out[k] = {
        count: list.length,
        best: list.length ? Math.min(...list.map((e) => e.ms)) : null,
        avg5: last5.length ? last5.reduce((s, e) => s + e.ms, 0) / last5.length : null,
      };
    });
    return out;
  }, [log]);

  const isBest = lastResult && stats[lastResult.kind]?.best === lastResult.ms && stats[lastResult.kind].count > 1;

  return (
    <div className="space-y-4">
      {/* CHRONO */}
      <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-volt-400 uppercase tracking-widest">Chrono de transition</span>
          <div className="flex bg-ink-950 border border-ink-800 rounded-xl p-0.5" role="tablist">
            {['T1', 'T2'].map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                disabled={running}
                onClick={() => setKind(k)}
                className={`min-h-[40px] min-w-[52px] px-3 rounded-lg text-sm font-bold ${kind === k ? 'bg-volt-500 text-white' : 'text-ink-400'}`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
        <p className="text-5xl font-mono font-black text-ink-50 text-center tabular-nums py-2" aria-live="polite">{formatMs(elapsed)}</p>
        <button
          type="button"
          onClick={startStop}
          className={`w-full min-h-[72px] rounded-2xl text-lg font-black text-white transition-colors ${running ? 'bg-rose-600' : 'bg-volt-500'}`}
        >
          {running ? '■ STOP' : `▶ DÉPART ${kind}`}
        </button>
        {lastResult && (
          <p className="text-sm text-center font-bold text-emerald-400">
            {isBest ? '🏆 Nouveau record ! ' : '✓ Enregistré : '}{lastResult.kind} en {formatMs(lastResult.ms)}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          {['T1', 'T2'].map((k) => (
            <div key={k} className="bg-ink-950 border border-ink-800 rounded-xl p-2.5">
              <span className="text-xs font-bold text-ink-300">{k} · {stats[k].count} essai(s)</span>
              <p className="text-xs font-mono text-ink-400 mt-1">Record : <span className="text-ink-50 font-bold">{stats[k].best != null ? formatMs(stats[k].best) : '—'}</span></p>
              <p className="text-xs font-mono text-ink-400">Moy. 5 derniers : <span className="text-ink-50 font-bold">{stats[k].avg5 != null ? formatMs(stats[k].avg5) : '—'}</span></p>
            </div>
          ))}
        </div>
        {log.length > 0 && (
          <details className="text-xs text-ink-400">
            <summary className="min-h-[40px] flex items-center cursor-pointer font-bold text-ink-300">Historique ({log.length})</summary>
            <ul className="divide-y divide-ink-800 mt-1">
              {log.slice(0, 20).map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2">
                  <span className="font-mono">{e.kind} · {formatMs(e.ms)}</span>
                  <span className="text-ink-500">{new Date(e.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</span>
                  <button type="button" onClick={() => setLog(log.filter((x) => x.id !== e.id))} className="min-h-[36px] min-w-[36px] text-ink-500" aria-label={`Supprimer ${e.kind} ${formatMs(e.ms)}`}>✕</button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* ROUTINES */}
      <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-3">
        <span className="text-[11px] font-mono text-volt-400 uppercase tracking-widest block">Routines dans l'ordre</span>
        {Object.entries(ROUTINES).map(([k, steps]) => (
          <div key={k}>
            <p className="text-sm font-bold text-ink-50 mb-1.5">{k} — {k === 'T1' ? 'natation → vélo' : 'vélo → course'}</p>
            <ol className="space-y-1">
              {steps.map((step, i) => (
                <li key={step} className="flex gap-2 text-sm text-ink-300 leading-snug">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-ink-950 border border-ink-800 text-xs font-bold flex items-center justify-center text-volt-400">{i + 1}</span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
        <p className="text-[11px] text-ink-500 leading-snug">
          Règles courantes de la réglementation FFTri, reprises par la plupart des règlements
          d'épreuves : casque attaché avant de toucher le vélo et détaché seulement une fois le
          vélo raccroché, circulation à pied dans le parc, dossard dans le dos à vélo et devant
          en course. Vérifie toujours le règlement de ta course (certaines épreuves n'exigent
          pas le dossard à vélo).
        </p>
      </div>

      {/* CHECKLIST */}
      <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-volt-400 uppercase tracking-widest">Checklist de course · {checked.length}/{items.length}</span>
          <button type="button" onClick={() => setChecked([])} className="min-h-[36px] px-3 rounded-lg border border-ink-800 text-xs font-bold text-ink-400">Tout décocher</button>
        </div>
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item} className="flex items-center gap-2">
              <label className="flex-1 flex items-center gap-3 min-h-[44px] px-3 rounded-xl bg-ink-950 border border-ink-800 cursor-pointer">
                <input type="checkbox" checked={checked.includes(item)} onChange={() => toggle(item)} className="w-5 h-5 accent-volt-500 shrink-0" />
                <span className={`text-sm leading-snug ${checked.includes(item) ? 'text-ink-500 line-through' : 'text-ink-100'}`}>{item}</span>
              </label>
              <button type="button" onClick={() => removeItem(item)} className="min-h-[44px] min-w-[40px] text-ink-500" aria-label={`Retirer ${item}`}>✕</button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            type="text"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
            placeholder="Ajouter un élément…"
            className="flex-1 min-w-0 bg-ink-950 border border-ink-800 rounded-xl px-3 min-h-[44px] text-base text-ink-50"
          />
          <button type="button" onClick={addItem} className="min-h-[44px] px-4 rounded-xl bg-volt-500 text-white text-sm font-bold shrink-0">Ajouter</button>
        </div>
      </div>
    </div>
  );
}
