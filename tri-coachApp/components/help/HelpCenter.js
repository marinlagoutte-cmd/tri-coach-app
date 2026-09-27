// components/help/HelpCenter.js
//
// CENTRE D'AIDE (bouton ❓ de l'en-tête) : trois onglets.
//   - Démarrer : revoir la visite guidée, réafficher les astuces, et les gestes essentiels ;
//   - Lexique : recherche instantanée, définitions dépliables ;
//   - Questions : questions fréquentes en accordéon.
import { useMemo, useState } from 'react';
import Sheet from './Sheet';
import { GLOSSARY, FAQ } from '../../lib/helpContent';

const normalize = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const ESSENTIALS = [
  ['🏠', "Chaque jour, ouvre Aujourd'hui : ta séance, demain, et ce qui est à confirmer."],
  ['👆', 'Touche une séance pour sa feuille complète, puis « Valider la séance » après l\'avoir faite.'],
  ['💬', 'Un imprévu, une fatigue, une douleur ? Dis-le au coach dans le chat, il adapte le plan.'],
  ['📅', 'Chaque lundi, génère la nouvelle semaine depuis le Calendrier si l\'app te le propose.'],
];

export default function HelpCenter({ onClose, onStartTour, onResetTips, initialTab = 'start' }) {
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState('');
  const [openTerm, setOpenTerm] = useState(null);
  const [openFaq, setOpenFaq] = useState(null);
  const [tipsReset, setTipsReset] = useState(false);

  const terms = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return GLOSSARY;
    return GLOSSARY.filter((g) => normalize(`${g.term} ${g.text}`).includes(q));
  }, [query]);

  return (
    <Sheet title="❓ Aide" onClose={onClose} labelId="help-center-title">
      <div className="grid grid-cols-3 bg-ink-950 border border-ink-800 rounded-xl p-0.5" role="tablist">
        {[['start', 'Démarrer'], ['glossary', 'Lexique'], ['faq', 'Questions']].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`min-h-[40px] rounded-lg text-sm font-bold ${tab === id ? 'bg-volt-500 text-white' : 'text-ink-400'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'start' && (
        <div className="space-y-3">
          <button type="button" onClick={onStartTour} className="w-full min-h-[52px] rounded-2xl bg-volt-500 text-white font-black flex items-center justify-center gap-2">
            <span aria-hidden="true">▶</span> Revoir la visite guidée
          </button>
          <ul className="space-y-2">
            {ESSENTIALS.map(([icon, text]) => (
              <li key={icon} className="flex gap-3 items-start bg-ink-950 border border-ink-800 rounded-xl p-3">
                <span className="text-lg leading-none" aria-hidden="true">{icon}</span>
                <span className="text-sm text-ink-200 leading-snug">{text}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => { onResetTips(); setTipsReset(true); }}
            className="w-full min-h-[44px] rounded-xl border border-ink-800 text-sm font-bold text-ink-300"
          >
            {tipsReset ? '✓ Les astuces réapparaîtront dans chaque onglet' : '💡 Réafficher les astuces des onglets'}
          </button>
        </div>
      )}

      {tab === 'glossary' && (
        <div className="space-y-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Chercher : VMA, zones, seuil…"
            aria-label="Chercher dans le lexique"
            className="w-full bg-ink-950 border border-ink-800 rounded-xl px-3 min-h-[44px] text-base text-ink-50"
          />
          {terms.length === 0 && <p className="text-sm text-ink-400 text-center py-4">Aucun terme trouvé. Pose la question au coach dans le chat !</p>}
          <ul className="space-y-1.5">
            {terms.map((g) => {
              const open = openTerm === g.id || Boolean(query.trim());
              return (
                <li key={g.id} className="bg-ink-950 border border-ink-800 rounded-xl">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenTerm(openTerm === g.id ? null : g.id)}
                    className="w-full min-h-[44px] px-3 flex items-center justify-between gap-2 text-left"
                  >
                    <span className="text-sm font-bold text-ink-100">{g.term}</span>
                    <span className="text-ink-500 shrink-0" aria-hidden="true">{open ? '−' : '+'}</span>
                  </button>
                  {open && <p className="px-3 pb-3 text-sm text-ink-300 leading-relaxed">{g.text}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {tab === 'faq' && (
        <ul className="space-y-1.5">
          {FAQ.map((f, i) => (
            <li key={f.q} className="bg-ink-950 border border-ink-800 rounded-xl">
              <button
                type="button"
                aria-expanded={openFaq === i}
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full min-h-[48px] px-3 flex items-center justify-between gap-2 text-left"
              >
                <span className="text-sm font-bold text-ink-100">{f.q}</span>
                <span className="text-ink-500 shrink-0" aria-hidden="true">{openFaq === i ? '−' : '+'}</span>
              </button>
              {openFaq === i && <p className="px-3 pb-3 text-sm text-ink-300 leading-relaxed">{f.a}</p>}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
