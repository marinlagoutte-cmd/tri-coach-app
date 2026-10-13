// components/help/Sheet.js — fenêtre du bas (mobile) / boîte centrée (grand écran), même style
// que les autres fenêtres de l'app. Fermeture : bouton, fond, ou touche Échap.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function Sheet({ title, onClose, children, labelId = 'help-sheet-title', z = 'z-[70]' }) {
  const closeRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Rendu dans <body> (portail) : une bulle « ? » placée dans un titre en MAJUSCULES /
  // police mono héritait sinon de ce style (définition illisible, constaté en test).
  const sheet = (
    <div className={`fixed inset-0 bg-black/80 backdrop-blur-md ${z} flex items-end sm:items-center justify-center animate-sheetBackdrop`} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        onClick={(e) => e.stopPropagation()}
        className="font-body normal-case tracking-normal text-left bg-ink-900 border border-ink-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-4 shadow-2xl text-ink-100 max-h-[92dvh] overflow-y-auto animate-slideUp sm:animate-none"
      >
        <div className="w-10 h-1 rounded-full bg-ink-700 mx-auto sm:hidden" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <h2 id={labelId} className="text-base font-black text-ink-50 leading-snug">{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Fermer" className="min-w-[40px] min-h-[40px] -m-2 flex items-center justify-center text-ink-400 text-lg">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
  return typeof document !== 'undefined' ? createPortal(sheet, document.body) : sheet;
}
