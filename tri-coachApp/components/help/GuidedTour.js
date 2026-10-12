// components/help/GuidedTour.js
//
// VISITE GUIDÉE — plein écran, un écran par grande fonctionnalité (lib/helpContent.js).
// Pensée pour un athlète qui découvre l'app : aperçus dessinés avec le vrai style de l'app
// (pour reconnaître ensuite ce qu'il voit), navigation au doigt (glisser) ou par boutons,
// points de progression, « Passer » toujours visible. Lancée une fois après le premier plan,
// rejouable depuis le bouton ❓.
import { useEffect, useRef, useState } from 'react';
import { TOUR_STEPS } from '../../lib/helpContent';
import { CircleHelp, Check, X, Plus } from 'lucide-react';
import { SportDot, sportMeta } from '../ui/sport';

const Card = ({ children, className = '' }) => (
  <div className={`bg-ink-950 border border-ink-800 rounded-xl p-2.5 ${className}`}>{children}</div>
);
const Badge = ({ children, color }) => (
  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase font-mono ${color}`}>{children}</span>
);
const BIKE = 'bg-amber-950/60 border-amber-800 text-amber-400';
const RUN = 'bg-emerald-950/60 border-emerald-800 text-emerald-400';
const SWIM = 'bg-cyan-950/60 border-cyan-800 text-cyan-400';

function StepVisual({ visual }) {
  switch (visual) {
    case 'welcome':
      return (
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-volt-500 to-flare-500 flex items-center justify-center font-black text-xl text-white shadow-glow-sm">TC</div>
          <div className="flex gap-2 text-2xl" aria-hidden="true"><span>🏊</span><span>🚴</span><span>🏃</span></div>
        </div>
      );
    case 'today':
      return (
        <div className="space-y-2.5">
          <p className="text-base font-bold text-ink-50">Samedi 26 septembre</p>
          <div className={`rounded-2xl border p-3 ${sportMeta('CYCLISME').tint}`}>
            <div className="flex items-center gap-2"><SportDot type="CYCLISME" size={22} /><span className="text-[12px] text-ink-200">Vélo</span></div>
            <p className="text-[15px] font-bold text-ink-50 mt-1.5">Sortie longue Z2</p>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {[['2h00', 'Durée'], ['240 W', 'Intensité'], ['Z2', 'Zone']].map(([v, l]) => (
                <div key={l}><p className="text-[14px] font-semibold text-ink-50 tabular-nums">{v}</p><p className="text-[10px] text-ink-500">{l}</p></div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 bg-ink-950 rounded-xl px-2.5 py-2">
            <SportDot type="C.A.P" size={20} />
            <span className="text-[12px] text-ink-200 flex-1">Mardi · Côtes courtes</span>
            <span className="inline-flex items-center gap-0.5 text-[11px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-500 font-semibold"><Check size={12} /> Faite</span>
            <span className="inline-flex items-center gap-0.5 text-[11px] px-2 py-1 rounded-full bg-ink-800 text-ink-300 font-semibold"><X size={12} /> Pas faite</span>
          </div>
        </div>
      );
    case 'calendar':
      return (
        <div className="space-y-2">
          <div className="flex border-b border-ink-800 text-[12px]">
            <span className="flex-1 text-center pb-1.5 font-semibold text-ink-50 border-b-2 border-volt-500">Semaine 40</span>
            <span className="flex-1 text-center pb-1.5 text-ink-400">Semaine 41</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[['LUN 21', 'Repos', null], ['MAR 22', 'Côtes', 'C.A.P'], ['MER 23', 'Seuil vélo', 'CYCLISME']].map(([d, t, type], i) => (
              <Card key={d} className={i === 2 ? 'border-volt-500 ring-1 ring-volt-500/40' : ''}>
                <p className={`text-[10px] font-bold ${i === 2 ? 'text-volt-500' : 'text-ink-500'}`}>{d}</p>
                {type ? <><div className="mt-1"><SportDot type={type} size={16} /></div><p className="text-[11px] font-bold text-ink-100 mt-1">{t}</p></> : <p className="text-[11px] text-ink-500 mt-1">{t}</p>}
              </Card>
            ))}
          </div>
          <p className="text-[11px] text-ink-500 text-center">Glisse pour voir toute la semaine</p>
        </div>
      );
    case 'detail':
      return (
        <Card className="space-y-2">
          <p className="text-sm font-black text-ink-50">Seuil 3x10' · 1h10</p>
          <div className="text-xs font-mono text-ink-300 leading-relaxed">
            <p><span className="text-ink-500">Échauffement :</span> 20' footing Z2</p>
            <p><span className="text-volt-400">Corps de séance :</span> 3*(10' @Z4 seuil - 2' trot)</p>
            <p><span className="text-ink-500">Retour au calme :</span> 15' Z1</p>
          </div>
          <div className="w-full rounded-lg bg-emerald-600 text-white text-xs font-bold text-center py-2">✔ Valider la séance</div>
        </Card>
      );
    case 'coach':
      return (
        <div className="space-y-2">
          <div className="ml-8 bg-volt-500 text-white text-sm rounded-2xl rounded-br-md px-3 py-2">Je suis cuit, tu peux alléger demain ?</div>
          <div className="mr-8 bg-ink-950 border border-ink-800 text-ink-100 text-sm rounded-2xl rounded-bl-md px-3 py-2">C'est fait : ton seuil de demain devient 45' faciles en Z2. On reprend l'intensité jeudi.</div>
        </div>
      );
    case 'objective':
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-1 text-[11px] font-bold">
            {['Base', 'Dévelop.', 'Spécif.', 'Affût.'].map((p, i) => (
              <span key={p} className={`flex-1 text-center py-1.5 rounded-lg border ${i === 1 ? 'bg-volt-500 border-volt-500 text-white' : 'border-ink-800 text-ink-400'}`}>{p}</span>
            ))}
            <span aria-hidden="true">🏁</span>
          </div>
          <Card className="text-xs text-ink-300 space-y-1">
            <p className="font-bold text-ink-100">Réglages du plan</p>
            <p>Repos : lun · Semaine 1h30/jour · Week-end 4h</p>
            <p>Priorités : transitions, allure course</p>
          </Card>
        </div>
      );
    case 'profile':
      return (
        <div className="grid grid-cols-3 gap-2 text-center">
          {[['VMA', '17 km/h'], ['FTP', '250 W'], ['CSS', "1'45"]].map(([k, v]) => (
            <Card key={k}><p className="text-[10px] font-bold text-ink-500">{k}</p><p className="text-sm font-mono font-black text-ink-50">{v}</p></Card>
          ))}
          <p className="col-span-3 text-[11px] text-ink-500">Vide ? Le coach te propose un test simple.</p>
        </div>
      );
    case 'tools':
      return (
        <div className="space-y-2">
        <div className="flex justify-center"><span className="w-11 h-11 rounded-full bg-volt-500 text-white flex items-center justify-center"><Plus size={22} /></span></div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {['Allures', 'Checklist', 'Météo', 'Nutrition', 'Parcours', 'Pneus'].map((l) => (
            <Card key={l}><p className="text-xs font-bold text-ink-200 py-1.5">{l}</p></Card>
          ))}
        </div>
        </div>
      );
    case 'strava':
      return (
        <div className="space-y-2">
          <Card className="flex items-center gap-2">
            <span className="text-[11px] font-black px-2 py-1 rounded bg-orange-600 text-white">STRAVA</span>
            <span className="text-xs text-ink-300 flex-1">Sortie vélo · 2h04</span>
            <span className="text-xs font-bold text-emerald-400">✓ reconnue</span>
          </Card>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[['Forme', '62'], ['Fatigue', '71'], ['Fraîcheur', '-9']].map(([k, v]) => (
              <Card key={k}><p className="text-[10px] font-bold text-ink-500">{k}</p><p className="text-sm font-mono font-black text-ink-50">{v}</p></Card>
            ))}
          </div>
        </div>
      );
    case 'end':
      return (
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="w-14 h-14 rounded-full bg-ink-950 border border-ink-700 flex items-center justify-center text-ink-200" aria-hidden="true"><CircleHelp size={28} /></div>
          <p className="text-xs text-ink-400">En haut à droite, à tout moment</p>
        </div>
      );
    default:
      return null;
  }
}

export default function GuidedTour({ onClose }) {
  const [index, setIndex] = useState(0);
  const touchX = useRef(null);
  const nextRef = useRef(null);
  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;
  const go = (d) => setIndex((i) => Math.min(TOUR_STEPS.length - 1, Math.max(0, i + d)));

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => { nextRef.current?.focus(); }, [index]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      className="fixed inset-0 z-[80] bg-ink-900 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] animate-sheetBackdrop"
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        touchX.current = null;
      }}
    >
      <div className="flex items-center justify-between px-5 pt-4">
        <span className="text-xs font-mono text-ink-500">{index + 1} / {TOUR_STEPS.length}</span>
        <button type="button" onClick={onClose} className="min-h-[40px] px-3 text-sm font-bold text-ink-400">Passer</button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col justify-center max-w-md w-full mx-auto">
        <div key={step.id} className="space-y-5 animate-slideUp">
          <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 shadow-xl" aria-hidden="true">
            <StepVisual visual={step.visual} />
          </div>
          <div className="space-y-2">
            {step.tab && <span className="inline-block text-xs font-bold text-volt-400">{step.tab}</span>}
            <h2 id="tour-title" className="text-2xl font-black text-ink-50 font-display leading-tight">{step.title}</h2>
            <p className="text-base text-ink-300 leading-relaxed">{step.text}</p>
          </div>
        </div>
      </div>

      <div className="px-6 pb-5 space-y-4 max-w-md w-full mx-auto">
        <div className="flex justify-center gap-1.5" aria-hidden="true">
          {TOUR_STEPS.map((s, i) => (
            <span key={s.id} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-6 bg-volt-500' : 'w-1.5 bg-ink-700'}`} />
          ))}
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <button type="button" onClick={() => go(-1)} disabled={index === 0} className="min-h-[52px] px-5 rounded-2xl border border-ink-800 text-ink-300 font-bold disabled:opacity-30">←</button>
          <button
            ref={nextRef}
            type="button"
            onClick={() => (last ? onClose() : go(1))}
            className="min-h-[52px] rounded-2xl bg-volt-500 text-white font-black text-base"
          >
            {last ? "C'est parti !" : 'Suivant'}
          </button>
        </div>
      </div>
    </div>
  );
}
