import { useState } from 'react';

const WEEKDAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

const TYPE_STYLE = {
  NATATION: { color: '#2F9BE0', icon: '🏊' },
  CYCLISME: { color: '#F2B134', icon: '🚴' },
  'C.A.P': { color: '#2ECC71', icon: '🏃' },
  ENCHAÎNEMENT: { color: '#9B6FE8', icon: '🔁' },
  REPOS: { color: '#9AA3B2', icon: '🌴' }
};

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toISO(d) {
  return d.toISOString().slice(0, 10);
}

export default function CalendarView({ workouts }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(toISO(new Date()));

  // Mappe les séances N / N+1 sur les vraies dates calendaires
  const monday = getMonday(new Date());
  const activitiesByDate = {};

  ['N', 'N+1'].forEach((weekKey, weekOffset) => {
    (workouts[weekKey] || []).forEach((w) => {
      const dayIndex = DAY_NAMES.indexOf(w.day);
      if (dayIndex === -1) return;
      const date = new Date(monday);
      date.setDate(monday.getDate() + weekOffset * 7 + dayIndex);
      const iso = toISO(date);
      if (!activitiesByDate[iso]) activitiesByDate[iso] = [];
      activitiesByDate[iso].push(w);
    });
  });

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = (firstOfMonth.getDay() === 0 ? 6 : firstOfMonth.getDay() - 1);

  const cells = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const changeMonth = (delta) => {
    setCurrentMonth(new Date(year, month + delta, 1));
  };

  const selectedActivities = activitiesByDate[selectedDate] || [];
  const selectedLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

  return (
    <div className="space-y-4">
      {/* CARTE CALENDRIER */}
      <section className="bg-white border border-ria-border rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => changeMonth(-1)} className="text-ria-sub hover:text-ria-neon text-lg px-2">‹</button>
          <span className="text-sm font-black uppercase tracking-wide">
            {MONTHS[month]} {year}
          </span>
          <button onClick={() => changeMonth(1)} className="text-ria-sub hover:text-ria-neon text-lg px-2">›</button>
        </div>

        <div className="grid grid-cols-7 text-center text-[10px] font-bold text-ria-sub uppercase mb-2">
          {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
        </div>

        <div className="grid grid-cols-7 gap-y-2 text-center">
          {cells.map((day, idx) => {
            if (day === null) return <div key={`b-${idx}`} />;
            const iso = toISO(new Date(year, month, day));
            const dayActivities = activitiesByDate[iso] || [];
            const isSelected = iso === selectedDate;
            const isToday = iso === toISO(new Date());

            return (
              <button
                key={iso}
                onClick={() => setSelectedDate(iso)}
                className="flex flex-col items-center space-y-1 py-1"
              >
                <span
                  className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-semibold transition-colors
                    ${isSelected ? 'bg-ria-neon text-white' : isToday ? 'text-ria-neon font-black' : 'text-ria-darkText'}`}
                >
                  {day}
                </span>
                <span className="flex items-center justify-center space-x-0.5 h-1.5">
                  {dayActivities.slice(0, 3).map((w, i) => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: (TYPE_STYLE[w.type] || TYPE_STYLE.REPOS).color }}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* SÉANCES DU JOUR SÉLECTIONNÉ */}
      <section className="space-y-2">
        <h3 className="text-xs font-black uppercase tracking-wide text-ria-sub px-1 capitalize">
          {selectedLabel}
        </h3>

        {selectedActivities.length === 0 && (
          <div className="bg-white border border-ria-border rounded-2xl p-5 text-center text-xs text-ria-sub">
            Aucune séance ce jour-là.
          </div>
        )}

        {selectedActivities.map((w) => {
          const style = TYPE_STYLE[w.type] || TYPE_STYLE.REPOS;
          return (
            <div
              key={w.id}
              className="rounded-2xl p-4 flex items-center justify-between shadow-sm"
              style={{ backgroundColor: style.color }}
            >
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-full bg-white/25 flex items-center justify-center text-lg">
                  {style.icon}
                </div>
                <div>
                  <div className="text-sm font-bold text-white">{w.title}</div>
                  <div className="text-[11px] text-white/80">{w.desc}</div>
                </div>
              </div>
              <span className="text-sm font-black text-white font-mono whitespace-nowrap ml-2">
                {w.duration}
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}
