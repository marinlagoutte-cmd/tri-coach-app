// components/ui/Stat.js — valeur au-dessus du libellé (chiffres alignés).
export default function Stat({ value, label, size = 'md', align = 'left' }) {
  const v = size === 'lg' ? 'text-xl' : size === 'sm' ? 'text-sm' : 'text-base';
  return (
    <div className={align === 'center' ? 'text-center' : ''}>
      <p className={`${v} font-semibold text-ink-50 leading-tight tabular-nums`}>{value ?? '—'}</p>
      <p className="text-[11px] text-ink-500 mt-0.5">{label}</p>
    </div>
  );
}
