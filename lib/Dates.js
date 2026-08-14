// lib/dates.js
// Formatage des dates au format français (jour/mois/année)

/**
 * Formate une date en jj/mm/aaaa (ex: '2026-06-15' -> '15/06/2026').
 * Accepte une date ISO, un objet Date, ou tout ce que `new Date()` sait parser.
 * Renvoie la valeur d'origine (en string) si elle n'est pas parseable, pour ne jamais planter l'UI.
 */
export function formatDateFR(dateInput) {
  if (!dateInput) return '';
  try {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(d.getTime())) return String(dateInput);
    return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  } catch {
    return String(dateInput);
  }
}

/**
 * Version courte jj/mm (sans année) — pour les libellés compacts (graphiques, chips).
 */
export function formatDateShortFR(dateInput) {
  if (!dateInput) return '';
  try {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(d.getTime())) return String(dateInput);
    return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' }).format(d);
  } catch {
    return String(dateInput);
  }
}

/**
 * Version longue avec le jour de la semaine (ex: 'lundi 15 juin 2026') —
 * utile pour les confirmations où le contexte aide à la lecture.
 */
export function formatDateLongFR(dateInput) {
  if (!dateInput) return '';
  try {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(d.getTime())) return String(dateInput);
    return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(d);
  } catch {
    return String(dateInput);
  }
}
