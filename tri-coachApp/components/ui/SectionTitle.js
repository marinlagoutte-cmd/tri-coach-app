// components/ui/SectionTitle.js — titre de section en casse normale, avec action facultative à droite.
export default function SectionTitle({ children, right = null, id }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-1">
      <h3 id={id} className="text-[13px] font-semibold text-ink-100">{children}</h3>
      {right}
    </div>
  );
}
