// components/ui/BottomNav.js — barre de navigation flottante (pilule) avec bouton central
// d'actions rapides, icônes au trait et petit libellé. Inspirée des apps sport de référence :
// l'action la plus utile au centre, le reste calme.
import { House, CalendarDays, Target, MessageCircle, Plus } from 'lucide-react';

const ITEMS = {
  today: { Icon: House, key: 'today' },
  calendar: { Icon: CalendarDays, key: 'calendar' },
  objective: { Icon: Target, key: 'objective' },
  chat: { Icon: MessageCircle, key: 'chat' },
};

function NavItem({ id, label, active, onClick }) {
  const { Icon } = ITEMS[id];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex-1 min-h-[52px] flex flex-col items-center justify-center gap-0.5 rounded-full transition-colors ${active ? 'text-volt-500' : 'text-ink-400'}`}
    >
      <Icon size={21} strokeWidth={active ? 2.4 : 1.9} aria-hidden="true" />
      <span className={`text-[10px] leading-none ${active ? 'font-semibold' : 'font-medium'}`}>{label}</span>
    </button>
  );
}

export default function BottomNav({ activeTab, onChange, labels, actionsOpen, onToggleActions }) {
  return (
    <nav aria-label="Navigation principale" className="fixed bottom-0 inset-x-0 z-40 pointer-events-none pb-[calc(env(safe-area-inset-bottom)+8px)]">
      <div className="pointer-events-auto mx-auto max-w-md px-3">
        <div className="flex items-center rounded-full bg-ink-900/95 backdrop-blur-md border border-ink-800 shadow-[0_8px_24px_rgba(0,0,0,0.18)] px-1.5 h-[60px]">
          <NavItem id="today" label={labels.today} active={activeTab === 'today'} onClick={() => onChange('today')} />
          <NavItem id="calendar" label={labels.calendar} active={activeTab === 'calendar'} onClick={() => onChange('calendar')} />
          <div className="w-[64px] flex justify-center shrink-0">
            <button
              type="button"
              onClick={onToggleActions}
              aria-expanded={actionsOpen}
              aria-label={actionsOpen ? 'Fermer les actions rapides' : 'Actions rapides et outils'}
              className="-mt-7 w-[54px] h-[54px] rounded-full bg-ink-50 text-ink-950 flex items-center justify-center shadow-[0_4px_12px_rgba(0,0,0,0.18)] border-4 border-ink-950 active:scale-95 transition-transform"
            >
              <Plus size={24} strokeWidth={2.4} className={`transition-transform duration-200 ${actionsOpen ? 'rotate-45' : ''}`} aria-hidden="true" />
            </button>
          </div>
          <NavItem id="objective" label={labels.objective} active={activeTab === 'objective'} onClick={() => onChange('objective')} />
          <NavItem id="chat" label={labels.chat} active={activeTab === 'chat'} onClick={() => onChange('chat')} />
        </div>
      </div>
    </nav>
  );
}
