// components/SeasonGuide.js
//
// GUIDE DE SAISON (plan importé, voir lib/seasonImport.js:parseGuide) : tout le contenu du
// document de saison remis à l'athlète — logique, calendrier, repères (zones, allures, tapis,
// tests), organisation de la semaine, volume semaine par semaine, bibliothèque de séances
// types, fiches courses, nutrition, matériel, règlement, pilotage, sources — consultable dans
// l'app, hors ligne, avec une recherche plein texte (« tapis », « barrière », « sodium »…).
//
// Le guide est une liste de sections composées de blocs typés :
//   h / h3 (titres), p, note, callout, list, links, table (avec ou sans en-tête ; fiche
//   « clé / valeur » quand la 1re colonne est en gras), card (séance type de la
//   bibliothèque), bars (volume hebdomadaire), weeks (semaines du plan : dates, nature,
//   volume, D+, objectif ; la semaine en cours est mise en avant).
// Mise en forme dans le texte : **gras** et liens http(s) cliquables.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronDown, Search, X, Footprints, Lightbulb } from 'lucide-react';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function blockText(b) {
  switch (b.t) {
    case 'list':
    case 'links':
      return (b.items || []).join(' ');
    case 'table':
      return [...(b.head || []), ...(b.rows || []).flat()].join(' ');
    case 'card':
      return [b.code, b.title, b.meta, b.objective, ...(b.lines || []), b.treadmill, b.notes].filter(Boolean).join(' ');
    case 'bars':
      return (b.items || []).map((i) => i.title || i.label).join(' ');
    case 'weeks':
      return (b.items || []).map((i) => [i.code, i.dates, i.type, i.phase, i.focus].join(' ')).join(' ');
    default:
      return b.text || '';
  }
}

/** **gras**, liens http(s) et retours à la ligne. */
function Rich({ text }) {
  const parts = String(text || '').split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} className="font-semibold text-ink-50">{p.slice(2, -2)}</strong>;
        if (/^https?:\/\//.test(p)) {
          return <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="text-volt-500 underline underline-offset-2 break-all">{p.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}{p.length > 56 ? '…' : ''}</a>;
        }
        return p.split('\n').map((line, j, arr) => (
          <React.Fragment key={`${i}-${j}`}>{line}{j < arr.length - 1 && <br />}</React.Fragment>
        ));
      })}
    </>
  );
}

function GuideTable({ head, rows }) {
  const isKeyValue = !head && rows.length > 0 && rows.every((r) => r.length === 2 && /^\*\*.+\*\*$/.test(r[0] || ''));
  if (isKeyValue) {
    return (
      <dl className="rounded-xl border border-ink-800 divide-y divide-ink-800 overflow-hidden">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[88px_1fr] gap-2 px-2.5 py-2 bg-ink-950">
            <dt className="text-[11px] font-semibold text-ink-400 leading-snug">{r[0].slice(2, -2)}</dt>
            <dd className="text-[12px] text-ink-100 leading-snug"><Rich text={r[1]} /></dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-ink-800 -mx-0.5">
      <table className="w-full text-left text-[11.5px] leading-snug border-collapse">
        {head && (
          <thead className="bg-ink-950">
            <tr>
              {head.map((h, i) => <th key={i} scope="col" className="px-2 py-1.5 font-semibold text-ink-300 whitespace-nowrap border-b border-ink-800">{h}</th>)}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={i % 2 ? 'bg-ink-950/60' : ''}>
              {r.map((c, j) => (
                <td key={j} className={`px-2 py-1.5 align-top text-ink-100 border-b border-ink-800/70 ${j === 0 ? 'min-w-[72px]' : 'min-w-[96px]'}`}><Rich text={c} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SessionCard({ b, forceOpen }) {
  return (
    <details className="rounded-xl border border-ink-800 bg-ink-950 group" open={forceOpen || undefined}>
      <summary className="list-none cursor-pointer select-none p-2.5 flex items-start gap-2 min-h-tap">
        <span className="text-[11px] font-bold text-volt-500 border border-volt-500/40 rounded-md px-1.5 py-px tabular-nums shrink-0 mt-px">{b.code}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-semibold text-ink-50 leading-snug">{String(b.title || '').replace(/^\S+\s·\s/, '')}</span>
          {b.meta && <span className="block text-[11px] text-ink-400 tabular-nums">{b.meta}</span>}
        </span>
        <ChevronDown size={16} className="text-ink-500 shrink-0 mt-0.5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="px-2.5 pb-2.5 space-y-2">
        {b.objective && <p className="text-[12px] text-ink-300 leading-snug"><span className="font-semibold text-ink-100">Objectif : </span>{b.objective}</p>}
        <ul className="space-y-1">
          {(b.lines || []).map((l, i) => (
            <li key={i} className="text-[12px] text-ink-100 leading-snug pl-3 relative before:content-[''] before:absolute before:left-0 before:top-[7px] before:w-1.5 before:h-1.5 before:rounded-full before:bg-ink-600">{l}</li>
          ))}
        </ul>
        {b.treadmill && (
          <p className="text-[12px] text-ink-200 leading-snug rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-2">
            <span className="font-semibold text-emerald-500 inline-flex items-center gap-1 mr-1"><Footprints size={13} aria-hidden="true" />Tapis :</span>{b.treadmill}
          </p>
        )}
        {b.notes && (
          <p className="text-[12px] text-ink-300 leading-snug flex gap-1.5"><Lightbulb size={13} className="shrink-0 mt-0.5 text-ink-400" aria-hidden="true" /><span>{b.notes}</span></p>
        )}
      </div>
    </details>
  );
}

const BAR_TONE = { charge: 'bg-volt-500', easy: 'bg-emerald-500/70', race: 'bg-violet-500' };

function VolumeBars({ b, todayIso }) {
  const items = b.items || [];
  const max = Math.max(1, ...items.map((i) => Number(i.value) || 0));
  const currentIdx = todayIso ? items.findIndex((it, i) => it.start && it.start <= todayIso && (!items[i + 1]?.start || items[i + 1].start > todayIso)) : -1;
  return (
    <figure className="space-y-2">
      <div className="overflow-x-auto">
        <div className="flex items-end gap-[2px] h-32 px-0.5" role="img" aria-label={`Volume hebdomadaire prévu, de ${items[0]?.label} à ${items[items.length - 1]?.label}, maximum ${max} ${b.unit || 'h'}`}>
          {items.map((it, i) => (
            <div key={it.label} className="flex-1 flex flex-col items-center justify-end h-full" title={it.title || `${it.label} · ${it.value} ${b.unit || 'h'}`}>
              <div
                className={`w-full rounded-t-[3px] ${BAR_TONE[it.kind] || 'bg-ink-500'} ${i === currentIdx ? 'ring-2 ring-ink-50 ring-offset-1 ring-offset-ink-900' : ''}`}
                style={{ height: `${Math.max(2, (Number(it.value) / max) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-[2px] px-0.5 mt-1">
          {items.map((it, i) => (
            <span key={it.label} className={`flex-1 min-w-0 flex ${i === 0 ? 'justify-start' : i === items.length - 1 ? 'justify-end' : 'justify-center'} whitespace-nowrap text-[9px] tabular-nums ${i === currentIdx ? 'text-ink-50 font-bold' : 'text-ink-500'}`}>
              {i % 4 === 0 || i === currentIdx ? it.label : ''}
            </span>
          ))}
        </div>
      </div>
      {b.legend && (
        <figcaption className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-400">
          {b.legend.map(([k, label]) => (
            <span key={k} className="inline-flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${BAR_TONE[k] || 'bg-ink-500'}`} />{label}</span>
          ))}
          {currentIdx >= 0 && <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm ring-2 ring-ink-50" />Semaine en cours</span>}
        </figcaption>
      )}
    </figure>
  );
}

/** Semaines du plan, une ligne chacune ; la semaine en cours est mise en avant. */
function WeekRows({ b, todayIso }) {
  return (
    <ol className="rounded-xl border border-ink-800 divide-y divide-ink-800 overflow-hidden">
      {(b.items || []).map((w) => {
        const current = todayIso && w.start <= todayIso && todayIso <= w.end;
        return (
          <li key={w.code} className={`px-2.5 py-2 ${current ? 'bg-volt-500/10' : 'bg-ink-950'}`} aria-current={current ? 'date' : undefined}>
            <div className="flex items-baseline gap-2">
              <span className={`text-[12px] font-bold tabular-nums w-9 shrink-0 ${current ? 'text-volt-500' : 'text-ink-50'}`}>{w.code}</span>
              <span className="flex-1 min-w-0 text-[12px] text-ink-200 leading-snug">{w.type}<span className="text-ink-500"> · {w.dates}</span></span>
              <span className="text-[12px] font-semibold text-ink-100 tabular-nums shrink-0">{w.volume}{w.dplus ? <span className="font-normal text-emerald-500"> · {w.dplus} m</span> : null}</span>
            </div>
            {w.focus && <p className="text-[11.5px] text-ink-400 leading-snug mt-0.5 pl-11">{w.focus}</p>}
          </li>
        );
      })}
    </ol>
  );
}

function Block({ b, searching, todayIso }) {
  switch (b.t) {
    case 'h':
      return <h4 className="text-[14px] font-bold text-ink-50 pt-2">{b.text}</h4>;
    case 'h3':
      return <h5 className="text-[13px] font-semibold text-ink-100 pt-1">{b.text}</h5>;
    case 'note':
      return <p className="text-[12px] text-ink-400 leading-relaxed"><Rich text={b.text} /></p>;
    case 'callout':
      return <p className="text-[13px] text-ink-100 leading-relaxed border-l-2 border-volt-500 bg-volt-500/5 rounded-r-lg px-3 py-2"><Rich text={b.text} /></p>;
    case 'list':
      return (
        <ul className="space-y-1.5">
          {(b.items || []).map((it, i) => (
            <li key={i} className="text-[13px] text-ink-200 leading-relaxed pl-3.5 relative before:content-[''] before:absolute before:left-0 before:top-[8px] before:w-1.5 before:h-1.5 before:rounded-full before:bg-volt-500"><Rich text={it} /></li>
          ))}
        </ul>
      );
    case 'links':
      return (
        <ul className="space-y-1">
          {(b.items || []).map((it, i) => {
            const m = String(it).match(/^(.*?)\s+—\s+(https?:\/\/\S+)$/);
            return (
              <li key={i} className="text-[12px] leading-snug">
                {m ? <a href={m[2]} target="_blank" rel="noopener noreferrer" className="text-ink-200 underline decoration-ink-600 underline-offset-2 hover:text-volt-500">{m[1]}</a> : <Rich text={it} />}
              </li>
            );
          })}
        </ul>
      );
    case 'table':
      return <GuideTable head={b.head} rows={b.rows || []} />;
    case 'card':
      return <SessionCard b={b} forceOpen={searching} />;
    case 'bars':
      return <VolumeBars b={b} todayIso={todayIso} />;
    case 'weeks':
      return <WeekRows b={b} todayIso={todayIso} />;
    default:
      return <p className="text-[13px] text-ink-200 leading-relaxed"><Rich text={b.text} /></p>;
  }
}

export default function SeasonGuide({ guide, focusSectionId = null, todayIso = null }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const rootRef = useRef(null);

  // Ouverture ciblée (ex. bouton « Guide saison » des actions rapides, fiche d'une course).
  useEffect(() => {
    if (!focusSectionId) return;
    setOpen((prev) => new Set(prev).add(focusSectionId));
    const t = setTimeout(() => {
      const el = typeof document !== 'undefined' ? document.getElementById(`guide-${focusSectionId}`) : null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
    return () => clearTimeout(t);
  }, [focusSectionId]);

  const q = norm(query.trim());
  const filtered = useMemo(() => {
    if (!guide?.sections) return [];
    if (q.length < 2) return guide.sections.map((s) => ({ ...s, hits: null }));
    return guide.sections
      .map((s) => {
        const titleHit = norm(s.title).includes(q);
        const blocks = titleHit ? s.blocks : s.blocks.filter((b) => norm(blockText(b)).includes(q));
        return { ...s, blocks, hits: blocks.length };
      })
      .filter((s) => s.hits > 0);
  }, [guide, q]);

  if (!guide?.sections?.length) return null;
  const searching = q.length >= 2;
  const totalHits = searching ? filtered.reduce((n, s) => n + s.hits, 0) : 0;

  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <section ref={rootRef} id="season-guide" className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-3 scroll-mt-4" aria-label="Guide de la saison">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-full bg-volt-500/10 text-volt-500 flex items-center justify-center shrink-0" aria-hidden="true">
          <BookOpen size={19} strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <p className="text-[12px] text-ink-400">Guide de la saison{guide.version ? ` · ${guide.version}` : ''}</p>
          <h2 className="text-[16px] font-bold text-ink-50 leading-snug">{guide.title}</h2>
          {guide.intro && <p className="text-[12px] text-ink-400 leading-snug mt-0.5">{guide.intro}</p>}
        </div>
      </div>

      <label className="flex items-center gap-2 rounded-xl border border-ink-800 bg-ink-950 px-3 min-h-[44px] focus-within:border-volt-500/60">
        <Search size={16} className="text-ink-500 shrink-0" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Chercher : tapis, sodium, barrière, R2…"
          className="flex-1 bg-transparent text-[14px] text-ink-50 placeholder:text-ink-500 outline-none min-w-0"
          aria-label="Chercher dans le guide"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label="Effacer la recherche" className="text-ink-500 hover:text-ink-200 min-h-tap min-w-[32px] flex items-center justify-center">
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </label>
      {searching && (
        <p role="status" className="text-[12px] text-ink-400">
          {totalHits ? `${totalHits} passage${totalHits > 1 ? 's' : ''} dans ${filtered.length} section${filtered.length > 1 ? 's' : ''}` : 'Aucun résultat.'}
        </p>
      )}

      <div className="divide-y divide-ink-800 border-t border-ink-800">
        {filtered.map((s) => {
          const isOpen = searching || open.has(s.id);
          return (
            <div key={s.id} id={`guide-${s.id}`} className="scroll-mt-4">
              <button
                type="button"
                onClick={() => toggle(s.id)}
                aria-expanded={isOpen}
                className="w-full flex items-center gap-2 py-3 text-left min-h-tap"
              >
                <span className="flex-1 text-[14px] font-semibold text-ink-100 leading-snug">{s.title}</span>
                {searching && <span className="text-[11px] text-volt-500 tabular-nums">{s.hits}</span>}
                <ChevronDown size={18} className={`text-ink-500 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {isOpen && (
                <div className="pb-4 space-y-2.5">
                  {s.blocks.map((b, i) => <Block key={i} b={b} searching={searching} todayIso={todayIso} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
