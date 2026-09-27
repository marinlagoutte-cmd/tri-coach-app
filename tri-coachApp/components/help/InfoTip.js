// components/help/InfoTip.js — petit « ? » à côté d'un terme technique : ouvre sa définition
// (lexique de lib/helpContent.js) sans quitter l'écran. Zone tactile de 40 px, visuel discret.
import { useState } from 'react';
import Sheet from './Sheet';
import { glossaryEntry } from '../../lib/helpContent';

export default function InfoTip({ id, className = '', label = null }) {
  const [open, setOpen] = useState(false);
  const entry = glossaryEntry(id);
  if (!entry) return null;
  const trigger = label ? (
    // Variante « pastille » avec libellé (ex. rangée « Comprendre : VMA ? FTP ? »).
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
      className={`min-h-[36px] px-3 rounded-full border border-ink-700 bg-ink-950 text-xs font-bold text-ink-300 inline-flex items-center gap-1.5 ${className}`}
    >
      {label}
      <span className="w-4 h-4 rounded-full border border-ink-600 text-[10px] font-black leading-none flex items-center justify-center" aria-hidden="true">?</span>
    </button>
  ) : null;
  return (
    <>
      {trigger || (
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        aria-label={`Qu'est-ce que ${entry.term.split(' — ')[0]} ?`}
        className={`inline-flex items-center justify-center min-w-[40px] min-h-[40px] -my-3 -mx-2 align-middle ${className}`}
      >
        <span className="w-[18px] h-[18px] rounded-full border border-ink-600 text-ink-400 text-[11px] font-black leading-none flex items-center justify-center" aria-hidden="true">?</span>
      </button>
      )}
      {open && (
        <Sheet title={entry.term} onClose={() => setOpen(false)} labelId={`tip-${id}`}>
          <p className="text-sm text-ink-200 leading-relaxed">{entry.text}</p>
          <button type="button" onClick={() => setOpen(false)} className="w-full min-h-[48px] rounded-xl bg-volt-500 text-white font-bold">Compris</button>
        </Sheet>
      )}
    </>
  );
}
