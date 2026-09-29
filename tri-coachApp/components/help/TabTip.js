// components/help/TabTip.js — astuce affichée à la PREMIÈRE visite d'un onglet, fermée d'un
// « Compris » (mémorisé ; toutes les astuces reviennent via ❓ → « Réafficher les astuces »).
export default function TabTip({ text, onDismiss }) {
  return (
    <div role="note" className="bg-volt-500/10 border border-volt-500/30 rounded-2xl p-3 flex gap-2.5 items-start">
      <span className="text-base leading-none mt-0.5" aria-hidden="true">💡</span>
      <div className="flex-1 space-y-2">
        <p className="text-[13px] text-ink-100 leading-snug">{text}</p>
        <button type="button" onClick={onDismiss} className="min-h-[36px] px-4 rounded-lg bg-volt-500 text-white text-xs font-bold">Compris</button>
      </div>
    </div>
  );
}
