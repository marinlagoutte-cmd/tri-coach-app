// lib/supabaseFallback.js
//
// TOLÉRANCE À UNE BASE SUPABASE INCOMPLÈTE : si une migration n'a pas été appliquée (cas réel :
// colonne `cost_eur` absente → « Could not find the 'cost_eur' column of 'equipment_components'
// in the schema cache »), l'écriture est rejouée SANS la colonne manquante — uniquement pour
// des colonnes déclarées facultatives — au lieu d'échouer en entier. La colonne manquante est
// signalée (missingColumns) pour inviter à exécuter supabase-migration-mise-a-niveau-2026-10.sql.

/** Nom de la colonne absente d'après le message d'erreur PostgREST, sinon null. */
export function missingColumnFrom(error) {
  const msg = String(error?.message || error || '');
  const m = msg.match(/Could not find the '([^']+)' column/i) || msg.match(/column "?([a-z_]+)"? (?:of relation \S+ )?does not exist/i);
  return m ? m[1] : null;
}

const strip = (row, cols) => Object.fromEntries(Object.entries(row).filter(([k]) => !cols.includes(k)));

async function withFallback(run, payload, optional) {
  const dropped = [];
  let current = payload;
  for (let attempt = 0; attempt <= optional.length; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { error, data } = await run(current);
    if (!error) return { error: null, data, missingColumns: dropped };
    const col = missingColumnFrom(error);
    if (!col || !optional.includes(col) || dropped.includes(col)) return { error, data: null, missingColumns: dropped };
    dropped.push(col);
    current = Array.isArray(current) ? current.map((r) => strip(r, dropped)) : strip(current, dropped);
  }
  return { error: new Error('Écriture impossible.'), data: null, missingColumns: dropped };
}

/** insert(rows) avec repli sur les colonnes facultatives manquantes. */
export function insertWithFallback(client, table, rows, optional = []) {
  return withFallback((r) => client.from(table).insert(r), rows, optional);
}

/** update(values).eq(col, val) avec repli sur les colonnes facultatives manquantes. */
export function updateWithFallback(client, table, values, [col, val], optional = []) {
  return withFallback((v) => (Object.keys(v).length ? client.from(table).update(v).eq(col, val) : Promise.resolve({ error: null })), values, optional);
}

export const EQUIPMENT_OPTIONAL_COLUMNS = ['cost_eur', 'details', 'updated_at'];
