// components/ui/UnderlineTabs.js — onglets soulignés (défilables si nombreux).
export default function UnderlineTabs({ tabs, value, onChange, ariaLabel, scrollable = false }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={`flex border-b border-ink-800 ${scrollable ? 'overflow-x-auto no-scrollbar -mx-1 px-1' : ''}`}>
      {tabs.map((t) => {
        const active = t.id === value;
        const I = t.Icon;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`relative min-h-[40px] px-3 flex items-center justify-center gap-1.5 text-[13px] whitespace-nowrap transition-colors ${scrollable ? '' : 'flex-1'} ${active ? 'text-ink-50 font-semibold' : 'text-ink-400 font-medium'}`}
          >
            {I && <I size={15} strokeWidth={active ? 2.4 : 2} aria-hidden="true" />}
            {t.label}
            {t.count != null && <span className="text-[11px] text-ink-500 tabular-nums">{t.count}</span>}
            <span className={`absolute left-2 right-2 -bottom-px h-0.5 rounded-full transition-colors ${active ? 'bg-volt-500' : 'bg-transparent'}`} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
