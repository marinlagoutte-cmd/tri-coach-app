// components/TimeInput.js — champ de temps saisi au clavier numérique (voir lib/timeMask.js).
import { maskTime, normalizeTime, timeIsInvalid } from '../lib/timeMask';

const HINT = { 'hh:mm': 'heures:minutes', 'hh:mm:ss': 'heures:minutes:secondes', 'mm:ss': 'minutes:secondes' };

export default function TimeInput({ value, onChange, format = 'hh:mm', className = '', placeholder, id, ariaLabel, autoFocus = false }) {
  const shown = normalizeTime(value, format);
  const invalid = timeIsInvalid(shown, format);
  return (
    <>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9:]*"
        autoComplete="off"
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        placeholder={placeholder || format.replace(/[hms]/g, '0')}
        value={shown}
        onChange={(e) => onChange(maskTime(e.target.value, format))}
        onFocus={(e) => { const el = e.target; setTimeout(() => el.setSelectionRange?.(el.value.length, el.value.length), 0); }}
        className={`${className} ${invalid ? '!border-rose-500' : ''}`}
      />
      {invalid && <span className="block text-[11px] text-rose-400 mt-1">Minutes et secondes : 59 au maximum.</span>}
      {!invalid && !shown && <span className="sr-only">Format {HINT[format]} : tape seulement les chiffres.</span>}
    </>
  );
}
