// components/ui/QuickActions.js — actions rapides ouvertes par le bouton central : les gestes
// fréquents (séance du jour, coach) puis les outils, en tuiles. Fond assombri, fermeture par
// le fond, la croix du bouton central ou Échap.
import { useEffect, useRef } from 'react';
import { Activity, MessageCircle, ListChecks, CloudSun, Utensils, Map, Gauge, Wrench } from 'lucide-react';

export const QUICK_ACTIONS = [
  { id: 'today-session', label: 'Séance du jour', Icon: Activity, main: true },
  { id: 'chat', label: 'Demander au coach', Icon: MessageCircle, main: true },
  { id: 'transitions', label: 'Checklist course', Icon: ListChecks },
  { id: 'weather', label: 'Météo', Icon: CloudSun },
  { id: 'nutrition', label: 'Nutrition', Icon: Utensils },
  { id: 'route', label: 'Parcours', Icon: Map },
  { id: 'tirePressure', label: 'Pression pneus', Icon: Gauge },
  { id: 'equipment', label: 'Matériel', Icon: Wrench },
];

export default function QuickActions({ open, onClose, onAction }) {
  const firstRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    firstRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const main = QUICK_ACTIONS.filter((a) => a.main);
  const tools = QUICK_ACTIONS.filter((a) => !a.main);
  return (
    <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[2px] animate-sheetBackdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Actions rapides et outils"
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+84px)] mx-auto max-w-md px-3 animate-slideUp"
      >
        <div className="bg-ink-900 border border-ink-800 rounded-3xl p-3 space-y-3 shadow-2xl">
          <div className="grid grid-cols-2 gap-2">
            {main.map((a, i) => (
              <button
                key={a.id}
                ref={i === 0 ? firstRef : null}
                type="button"
                onClick={() => onAction(a.id)}
                className="min-h-[52px] rounded-2xl bg-volt-500 text-white flex items-center justify-center gap-2 text-[13px] font-semibold"
              >
                <a.Icon size={18} strokeWidth={2.2} aria-hidden="true" />
                {a.label}
              </button>
            ))}
          </div>
          <p className="text-[12px] font-semibold text-ink-300 px-1">Outils</p>
          <div className="grid grid-cols-3 gap-2">
            {tools.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onAction(a.id)}
                className="min-h-[72px] rounded-2xl bg-ink-950 border border-ink-800 flex flex-col items-center justify-center gap-1.5 text-ink-200"
              >
                <a.Icon size={20} strokeWidth={1.9} aria-hidden="true" />
                <span className="text-[11px] font-medium leading-tight text-center px-1">{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
