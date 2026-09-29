// components/ui/sport.js — icône, nom et teinte de chaque discipline (icônes au trait lucide).
import { Waves, Bike, Footprints, Repeat, Dumbbell, Moon } from 'lucide-react';
import { shortLabel } from '../../lib/workouts';

const META = {
  SWIM: { Icon: Waves, name: 'Natation', dot: 'bg-cyan-500', tint: 'bg-cyan-500/10 border-cyan-500/25', text: 'text-cyan-500' },
  BIKE: { Icon: Bike, name: 'Vélo', dot: 'bg-amber-500', tint: 'bg-amber-500/10 border-amber-500/25', text: 'text-amber-500' },
  RUN: { Icon: Footprints, name: 'Course à pied', dot: 'bg-emerald-500', tint: 'bg-emerald-500/10 border-emerald-500/25', text: 'text-emerald-500' },
  BRICK: { Icon: Repeat, name: 'Enchaînement', dot: 'bg-violet-500', tint: 'bg-violet-500/10 border-violet-500/25', text: 'text-violet-500' },
  REPOS: { Icon: Moon, name: 'Repos', dot: 'bg-ink-600', tint: 'bg-ink-900 border-ink-800', text: 'text-ink-400' },
  OTHER: { Icon: Dumbbell, name: 'Renforcement', dot: 'bg-ink-500', tint: 'bg-ink-900 border-ink-800', text: 'text-ink-300' },
};

export function sportMeta(type) {
  const key = shortLabel(type);
  if (/ppg|gainage|renfo/i.test(String(type || ''))) return META.OTHER;
  return META[key] || META.OTHER;
}

/** Pastille ronde colorée avec l'icône du sport. */
export function SportDot({ type, size = 28, title }) {
  const m = sportMeta(type);
  const I = m.Icon;
  return (
    <span className={`inline-flex items-center justify-center rounded-full text-white shrink-0 ${m.dot}`} style={{ width: size, height: size }} aria-hidden={title ? undefined : 'true'} title={title}>
      <I size={Math.round(size * 0.55)} strokeWidth={2.2} />
    </span>
  );
}
