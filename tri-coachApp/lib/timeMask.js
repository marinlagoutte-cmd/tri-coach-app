// lib/timeMask.js
//
// Saisie de temps au CLAVIER NUMÉRIQUE, façon « caisse enregistreuse » : l'athlète ne tape que
// des chiffres, les « : » se placent tout seuls, en partant de la droite.
//   format 'hh:mm'    : 3, 0      → "00:30"      ; 1, 1, 5 → "01:15"
//   format 'hh:mm:ss' : 3, 8, 3, 0 → "00:38:30"
//   format 'mm:ss'    : 1, 4, 5   → "01:45"
// Pourquoi : le clavier numérique des téléphones (Android notamment) n'a pas de touche « : »,
// donc un format « 00:30 » était impossible à saisir (retour de l'athlète).
// Le texte produit garde exactement le format lu par le reste de l'app.

const DIGITS = { 'hh:mm': 4, 'mm:ss': 4, 'hh:mm:ss': 6 };

export function maskTime(raw, format = 'hh:mm') {
  const max = DIGITS[format] || 4;
  const digits = String(raw ?? '').replace(/\D/g, '').slice(-max);
  if (!digits || /^0+$/.test(digits)) return '';
  const d = digits.padStart(max, '0');
  return max === 6 ? `${d.slice(0, 2)}:${d.slice(2, 4)}:${d.slice(4, 6)}` : `${d.slice(0, 2)}:${d.slice(2, 4)}`;
}

/** Valeur existante (ex. "1:45", "01:15", "38:30") → même texte au format masqué. */
export function normalizeTime(value, format = 'hh:mm') {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const parts = s.split(':');
  if (parts.length > 1 && parts.every((p) => /^\d+$/.test(p))) {
    const width = format === 'hh:mm:ss' ? 3 : 2;
    const padded = [...Array(Math.max(0, width - parts.length)).fill('0'), ...parts].slice(-width);
    return maskTime(padded.map((p) => p.padStart(2, '0').slice(-2)).join(''), format);
  }
  return maskTime(s, format);
}

/** Minutes ou secondes ≥ 60 (le premier bloc peut dépasser 59 en 'mm:ss'). */
export function timeIsInvalid(value, format = 'hh:mm') {
  if (!value) return false;
  const parts = String(value).split(':').map(Number);
  const check = format === 'mm:ss' ? parts.slice(1) : parts.slice(1);
  return check.some((n) => n >= 60);
}
