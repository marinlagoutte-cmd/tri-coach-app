// components/PlanPreferencesFields.js
//
// Réglages du plan qui manquaient à l'IA (voir lib/trainingCycle.js) :
//   - cycle charge/décharge + position de la semaine en cours dans le cycle ;
//   - priorités de l'athlète (chantiers à travailler) ;
//   - consignes libres pour le coach (créneaux imposés, matériel, lieux…).
// Utilisé dans l'assistant de création (étape 5) et dans l'onglet Objectif (modifiable
// à tout moment, sans régénérer le plan : pris en compte par le chat et par la prochaine
// génération de semaine).

import { LOAD_PATTERNS, FOCUS_AREAS } from '../lib/trainingCycle';
import { DAYS_OF_WEEK } from '../lib/defaults';

const CAP_OPTIONS = [
  [0, 'Sans limite'], [45, '45 min'], [60, '1h'], [90, '1h30'], [120, '2h'], [150, '2h30'],
  [180, '3h'], [240, '4h'], [300, '5h'], [360, '6h'],
];

/** Sélection de 0 à 3 jours de repos obligatoires (valeur : "Lundi,Dimanche"). */
export function OffDaysPicker({ value, onChange }) {
  const selected = String(value || '').split(',').map((d) => d.trim()).filter(Boolean);
  const toggle = (day) => {
    const next = selected.includes(day) ? selected.filter((d) => d !== day) : [...selected, day].slice(-3);
    onChange(DAYS_OF_WEEK.filter((d) => next.includes(d)).join(','));
  };
  return (
    <div className="grid grid-cols-7 gap-1" role="group" aria-label="Jours de repos obligatoires">
      {DAYS_OF_WEEK.map((d) => {
        const on = selected.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(d)}
            className={`min-h-[44px] rounded-lg text-xs font-bold border ${on ? 'bg-volt-500 border-volt-500 text-white' : 'bg-ink-950 border-ink-800 text-ink-400'}`}
          >
            {d.slice(0, 3)}
          </button>
        );
      })}
    </div>
  );
}

export default function PlanPreferencesFields({ value, onChange, showOffDays = false }) {
  const v = value || {};
  const pattern = v.loadCyclePattern || 'none';
  const conf = LOAD_PATTERNS[pattern] || LOAD_PATTERNS.none;
  const length = conf.charge + conf.decharge;
  const focus = Array.isArray(v.focusAreas) ? v.focusAreas : [];
  const set = (patch) => onChange({ ...v, ...patch });

  const toggleFocus = (id) => {
    const next = focus.includes(id) ? focus.filter((f) => f !== id) : [...focus, id].slice(0, 4);
    set({ focusAreas: next });
  };

  const caps = v.dayCaps || {};
  const setCap = (key, minutes) => set({ dayCaps: { ...caps, [key]: Number(minutes) || null } });

  return (
    <div className="space-y-4">
      {showOffDays && (
        <div>
          <span className="text-sm text-ink-300 block mb-1.5">Jour(s) de repos obligatoire(s)</span>
          <OffDaysPicker value={v.offDays} onChange={(offDays) => set({ offDays })} />
        </div>
      )}

      <div>
        <span className="text-sm text-ink-300 block mb-1.5">Temps disponible par jour (toutes séances cumulées)</span>
        <div className="grid grid-cols-2 gap-2">
          {[['weekday', 'Lun → ven'], ['weekend', 'Sam - dim']].map(([key, label]) => (
            <div key={key}>
              <label htmlFor={`cap-${key}`} className="text-xs text-ink-400 block mb-1">{label}</label>
              <select
                id={`cap-${key}`}
                value={Number(caps[key]) || 0}
                onChange={(e) => setCap(key, e.target.value)}
                className="w-full bg-ink-950 border border-ink-800 rounded-xl p-3 text-base text-ink-50 min-h-tap"
              >
                {CAP_OPTIONS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
              </select>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-ink-500 mt-1.5 leading-snug">Le coach place les séances longues sur les jours où tu as le temps, et ne dépasse jamais ta disponibilité.</p>
      </div>

      <div>
        <label htmlFor="loadCyclePattern" className="text-sm text-ink-300 block mb-1.5">Cycle de charge</label>
        <select
          id="loadCyclePattern"
          value={pattern}
          onChange={(e) => set({ loadCyclePattern: e.target.value, loadCycleWeek: 1 })}
          className="w-full bg-ink-950 border border-ink-800 rounded-xl p-3 text-base text-ink-50 min-h-tap"
        >
          {Object.entries(LOAD_PATTERNS).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
        </select>
        {pattern !== 'none' && (
          <div className="mt-2">
            <label htmlFor="loadCycleWeek" className="text-xs text-ink-400 block mb-1">Cette semaine, tu es en…</label>
            <select
              id="loadCycleWeek"
              value={Math.min(Number(v.loadCycleWeek) || 1, length)}
              onChange={(e) => set({ loadCycleWeek: Number(e.target.value) })}
              className="w-full bg-ink-950 border border-ink-800 rounded-xl p-3 text-base text-ink-50 min-h-tap"
            >
              {Array.from({ length }, (_, i) => i + 1).map((i) => (
                <option key={i} value={i}>
                  {i <= conf.charge ? `Semaine de charge ${i}/${conf.charge}` : 'Semaine de décharge'}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-ink-500 mt-1.5 leading-snug">
              Les semaines de décharge sont générées à ~70 % du volume, avec très peu d'intensité.
            </p>
          </div>
        )}
      </div>

      <div>
        <span className="text-sm text-ink-300 block mb-1.5">Tes priorités (4 max)</span>
        <div className="flex flex-wrap gap-2">
          {FOCUS_AREAS.map((f) => {
            const active = focus.includes(f.id);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => toggleFocus(f.id)}
                aria-pressed={active}
                className={`min-h-[40px] px-3 rounded-xl text-xs font-bold border transition-colors ${
                  active ? 'bg-volt-500/15 border-volt-500 text-volt-400' : 'bg-ink-950 border-ink-800 text-ink-400'
                }`}
              >
                {active ? '✓ ' : ''}{f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor="coachNotes" className="text-sm text-ink-300 block mb-1.5">Infos pour ton coach (optionnel)</label>
        <textarea
          id="coachNotes"
          value={v.coachNotes || ''}
          maxLength={600}
          rows={3}
          onChange={(e) => set({ coachNotes: e.target.value })}
          placeholder="Ex : natation club mardi matin et vendredi matin, piste le jeudi soir, home-trainer dispo…"
          className="w-full bg-ink-950 border border-ink-800 rounded-xl p-3 text-base text-ink-50 leading-snug"
        />
        <p className="text-[11px] text-ink-500 mt-1 text-right">{(v.coachNotes || '').length}/600</p>
      </div>
    </div>
  );
}
