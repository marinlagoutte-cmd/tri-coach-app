// components/TodayView.js
//
// ÉCRAN « AUJOURD'HUI » — onglet ouvert par défaut. L'usage le plus fréquent de l'app est
// « qu'est-ce que je fais aujourd'hui ? » : il demandait jusqu'ici d'ouvrir le calendrier et
// de faire défiler la semaine. Ici, en un coup d'œil :
//   - la ou les séances du jour, en grand (ou le repos) ;
//   - demain ;
//   - les séances passées de la semaine à confirmer / manquées, avec réorganisation par le coach ;
//   - la semaine (validées, volume prévu vs réalisé) ;
//   - la forme d'après la charge Strava réelle (lib/recentTraining.js).

import { shortLabel, parseClubSessionDesc, parseDurationMinutes } from '../lib/workouts';
import { badgeClass } from './CalendarView';
import { DAYS_OF_WEEK } from '../lib/defaults';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function formatHm(min) {
  const m = Math.round(min);
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

function BigSession({ w, done, onOpen }) {
  const swimTotal = shortLabel(w.type) === 'SWIM' ? parseClubSessionDesc(w.desc)?.total : null;
  return (
    <button
      type="button"
      onClick={() => onOpen(w)}
      className={`w-full text-left rounded-2xl border p-4 space-y-2 active:scale-[0.99] transition-transform ${
        done ? 'border-emerald-600/60 bg-emerald-950/20' : 'border-ink-800 bg-ink-950'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`text-xs font-bold px-2 py-0.5 rounded border uppercase font-mono ${badgeClass(w.type)}`}>{shortLabel(w.type)}</span>
        <span className="text-sm font-mono text-ink-400">{w.duration}{swimTotal ? ` · ${swimTotal}` : ''}</span>
        {done && <span className="ml-auto text-emerald-400 text-sm font-bold">✓ Faite</span>}
      </div>
      <p className="text-lg font-black text-ink-50 leading-tight">{w.title}</p>
      {w.intensity && <p className="text-base font-mono font-bold text-volt-400">{w.intensity}</p>}
      {w.structure && <p className="text-sm text-ink-300 leading-snug">{w.structure}</p>}
      <p className="text-xs font-bold text-ink-500">Voir la séance complète →</p>
    </button>
  );
}

export default function TodayView({
  firstName, todayIso, workoutsN = [], feedbackHistory = [], activities = [], pastSessions = [], recentLoad = null,
  weekLoad = null, hasPlan = false, onOpenWorkout, onMarkStatus, onAskCoach, onGoto,
  objectiveDate = null, onNewObjective,
}) {
  const [y, mo, d] = todayIso.split('-').map(Number);
  const date = new Date(y, mo - 1, d);
  const dayIdx = (date.getDay() + 6) % 7;
  const dayName = DAYS_OF_WEEK[dayIdx];
  const tomorrowName = dayIdx < 6 ? DAYS_OF_WEEK[dayIdx + 1] : null;
  const validated = new Set(feedbackHistory.map((f) => f.workoutId));
  const doneToday = (w) => validated.has(w.id) || activities.some((a) => a.matched_workout_id === w.id);

  const todaySessions = workoutsN.filter((w) => w.day === dayName && w.type !== 'REPOS');
  const tomorrowSessions = tomorrowName ? workoutsN.filter((w) => w.day === tomorrowName && w.type !== 'REPOS') : [];
  const weekSessions = workoutsN.filter((w) => w.type !== 'REPOS');
  const plannedMin = weekSessions.reduce((s, w) => s + (parseDurationMinutes(w.duration) || 0), 0);
  const doneCount = weekSessions.filter((w) => validated.has(w.id) || pastSessions.some((p) => p.workout.id === w.id && p.status === 'done')).length;
  const toCheck = pastSessions.filter((p) => p.status !== 'done');
  const currentWeekReal = recentLoad?.weeks?.find((w) => w.current);

  return (
    <div className="space-y-4">
      <div className="px-1">
        <p className="text-sm text-ink-400">{firstName ? `Salut ${firstName} 👋` : 'Salut 👋'}</p>
        <h2 className="text-2xl font-black text-ink-50 font-display capitalize">{dayName} {d} {MONTHS[mo - 1]}</h2>
        {weekLoad && (
          <span className={`inline-block mt-1.5 text-xs font-bold px-2.5 py-1 rounded-lg border ${
            weekLoad.kind === 'decharge' ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400' : 'bg-volt-500/10 border-volt-500/30 text-volt-400'
          }`}>
            {weekLoad.kind === 'decharge' ? '🌿 Semaine de décharge' : `🔥 Semaine de charge ${weekLoad.index}`}
          </span>
        )}
      </div>

      {/* OBJECTIF PASSÉ : le plan passe en récupération puis en transition (lib/seasonPlan.js) ;
          on invite l'athlète à fixer le prochain objectif. */}
      {objectiveDate && objectiveDate < todayIso && (
        <section className="bg-ink-900 border border-volt-500/40 rounded-2xl p-4 space-y-2" aria-label="Objectif passé">
          <p className="text-base font-black text-ink-50">🏁 Ton objectif du {objectiveDate.slice(8, 10)}/{objectiveDate.slice(5, 7)} est passé</p>
          <p className="text-sm text-ink-300 leading-snug">Le plan est passé en récupération, puis en transition. Fixe ton prochain objectif pour relancer une préparation.</p>
          {onNewObjective && (
            <button type="button" onClick={onNewObjective} className="w-full min-h-[48px] rounded-xl bg-volt-500 text-white font-bold">Définir mon prochain objectif</button>
          )}
        </section>
      )}

      {/* AUJOURD'HUI */}
      <section className="space-y-2.5" aria-label="Séances du jour">
        {!hasPlan ? (
          <div className="bg-ink-900 border border-ink-800 rounded-2xl p-5 text-center space-y-3">
            <p className="text-sm text-ink-300">Aucun plan pour le moment.</p>
            <button type="button" onClick={() => onGoto('calendar')} className="w-full min-h-[48px] rounded-xl bg-volt-500 text-white font-bold">Créer mon plan</button>
          </div>
        ) : !workoutsN.some((w) => w.type !== 'REPOS') ? (
          <div className="bg-ink-900 border border-ink-800 rounded-2xl p-5 text-center space-y-3">
            <p className="text-sm text-ink-300">La semaine en cours n'est pas encore générée.</p>
            <button type="button" onClick={() => onGoto('calendar')} className="w-full min-h-[48px] rounded-xl bg-volt-500 text-white font-bold">✨ Générer ma semaine</button>
          </div>
        ) : todaySessions.length ? (
          todaySessions.map((w) => <BigSession key={w.id} w={w} done={doneToday(w)} onOpen={onOpenWorkout} />)
        ) : (
          <div className="bg-ink-900 border border-ink-800 rounded-2xl p-5 text-center">
            <p className="text-3xl" aria-hidden="true">🌿</p>
            <p className="text-lg font-black text-ink-50 mt-1">Repos aujourd'hui</p>
            <p className="text-sm text-ink-400 mt-1">Sommeil, hydratation, mobilité légère si l'envie est là.</p>
          </div>
        )}
      </section>

      {/* DEMAIN */}
      {hasPlan && tomorrowName && (
        <section className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-2" aria-label="Demain">
          <span className="text-[11px] font-mono text-ink-400 uppercase tracking-widest">Demain · {tomorrowName}</span>
          {tomorrowSessions.length ? tomorrowSessions.map((w) => (
            <button key={w.id} type="button" onClick={() => onOpenWorkout(w)} className="w-full flex items-center gap-2 min-h-[44px] text-left">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase font-mono shrink-0 ${badgeClass(w.type)}`}>{shortLabel(w.type)}</span>
              <span className="text-sm font-bold text-ink-100 truncate">{w.title}</span>
              <span className="ml-auto text-xs font-mono text-ink-400 shrink-0">{w.duration}</span>
            </button>
          )) : <p className="text-sm text-ink-400">Repos 🌿</p>}
        </section>
      )}

      {/* À CONFIRMER / MANQUÉES */}
      {toCheck.length > 0 && (
        <section className="bg-ink-900 border border-amber-800/50 rounded-2xl p-4 space-y-3" aria-label="Séances passées à vérifier">
          <span className="text-[11px] font-mono text-amber-400 uppercase tracking-widest">Plus tôt cette semaine</span>
          {toCheck.map(({ workout: w, status }) => (
            <div key={w.id} className="space-y-2 pb-3 border-b border-ink-800 last:border-0 last:pb-0">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase font-mono shrink-0 ${badgeClass(w.type)}`}>{shortLabel(w.type)}</span>
                <span className="text-sm font-bold text-ink-100 truncate">{w.day} · {w.title}</span>
                <span className={`ml-auto text-[11px] font-bold shrink-0 ${status === 'missed' ? 'text-rose-400' : 'text-amber-400'}`}>
                  {status === 'missed' ? 'Manquée' : 'À confirmer'}
                </span>
              </div>
              {status === 'unknown' ? (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => onMarkStatus(w.id, 'done')} className="min-h-[44px] rounded-xl border border-emerald-700 text-emerald-400 text-sm font-bold">✓ Faite</button>
                  <button type="button" onClick={() => onMarkStatus(w.id, 'missed')} className="min-h-[44px] rounded-xl border border-ink-700 text-ink-300 text-sm font-bold">✗ Pas faite</button>
                </div>
              ) : (
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <button
                    type="button"
                    onClick={() => onAskCoach(`J'ai manqué ma séance du ${w.day.toLowerCase()} : ${w.type} « ${w.title} » (${w.duration}). Propose-moi comment réorganiser la fin de ma semaine sans me surcharger — ou dis-moi s'il vaut mieux simplement passer à la suite.`)}
                    className="min-h-[44px] rounded-xl bg-volt-500 text-white text-sm font-bold"
                  >
                    💬 Réorganiser avec le coach
                  </button>
                  <button type="button" onClick={() => onMarkStatus(w.id, 'skipped')} className="min-h-[44px] px-3 rounded-xl border border-ink-700 text-ink-400 text-sm font-bold">Ignorer</button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {/* SEMAINE */}
      {hasPlan && weekSessions.length > 0 && (
        <section className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-2.5" aria-label="Ma semaine">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-ink-400 uppercase tracking-widest">Ma semaine</span>
            <span className="text-xs font-mono text-ink-300">{doneCount}/{weekSessions.length} faites</span>
          </div>
          <div className="h-2 rounded-full bg-ink-950 border border-ink-800 overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${Math.round((doneCount / weekSessions.length) * 100)}%` }} />
          </div>
          <p className="text-sm text-ink-300">
            Prévu <span className="font-mono font-bold text-ink-50">{formatHm(plannedMin)}</span>
            {currentWeekReal && <> · réalisé (Strava) <span className="font-mono font-bold text-ink-50">{formatHm(currentWeekReal.totalHours * 60)}</span></>}
          </p>
        </section>
      )}

      {/* FORME */}
      <section className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-2" aria-label="Ma forme">
        <span className="text-[11px] font-mono text-ink-400 uppercase tracking-widest">Ma forme (charge réelle)</span>
        {recentLoad?.load ? (
          <>
            <p className="text-base font-bold text-ink-50">{recentLoad.load.label || 'Charge calculée'}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[['Forme (CTL)', recentLoad.load.ctl], ['Fatigue (ATL)', recentLoad.load.atl], ['Fraîcheur (TSB)', recentLoad.load.tsb]].map(([label, v]) => (
                <div key={label} className="bg-ink-950 border border-ink-800 rounded-xl py-2">
                  <span className="block text-[10px] text-ink-500 font-bold">{label}</span>
                  <span className="block text-base font-mono font-black text-ink-50">{v}</span>
                </div>
              ))}
            </div>
            {recentLoad.avgCompletedWeekHours != null && (
              <p className="text-xs text-ink-400">Moyenne des dernières semaines complètes : <span className="font-mono text-ink-200">{recentLoad.avgCompletedWeekHours} h</span></p>
            )}
            <p className="text-[11px] text-ink-500 leading-snug">Transmise au coach à chaque génération et dans le chat.</p>
          </>
        ) : (
          <p className="text-sm text-ink-400 leading-snug">
            Connecte Strava (⚙️ Réglages) pour que le coach tienne compte de ce que tu fais vraiment, pas seulement du plan.
          </p>
        )}
      </section>

      {/* RACCOURCIS */}
      <div className="grid grid-cols-3 gap-2">
        {[['💬', 'Coach', 'chat'], ['📅', 'Semaine', 'calendar'], ['⏱️', 'Transitions', 'transitions']].map(([icon, label, target]) => (
          <button key={target} type="button" onClick={() => onGoto(target)} className="min-h-[56px] rounded-2xl bg-ink-900 border border-ink-800 flex flex-col items-center justify-center gap-0.5">
            <span className="text-lg" aria-hidden="true">{icon}</span>
            <span className="text-xs font-bold text-ink-300">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
