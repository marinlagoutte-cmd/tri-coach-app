// components/TodayView.js
//
// ÉCRAN « AUJOURD'HUI » — onglet ouvert par défaut. Refonte visuelle (inspirée des apps sport
// de référence : cartes « ma journée », statistiques valeur/libellé, listes groupées, icônes
// au trait) ; la logique est inchangée :
//   - la ou les séances du jour, en grand (ou le repos) ;
//   - demain ;
//   - les séances passées de la semaine à confirmer / manquées, avec réorganisation par le coach ;
//   - la semaine (barres par jour : prévu / réalisé) ;
//   - la forme d'après la charge Strava réelle (lib/recentTraining.js).

import { ChevronRight, Flame, Leaf, Check, X, MessageCircle, Flag } from 'lucide-react';
import { shortLabel, parseClubSessionDesc, parseDurationMinutes } from '../lib/workouts';
import { DAYS_OF_WEEK } from '../lib/defaults';
import InfoTip from './help/InfoTip';
import TodayWeather from './TodayWeather';
import { sportMeta, SportDot } from './ui/sport';
import SectionTitle from './ui/SectionTitle';
import Stat from './ui/Stat';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function formatHm(min) {
  const m = Math.round(min);
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

/** Carte forte : séance du jour, teintée selon le sport, chiffres clés en grand. */
function SessionHero({ w, done, onOpen }) {
  const m = sportMeta(w.type);
  const swimTotal = shortLabel(w.type) === 'SWIM' ? parseClubSessionDesc(w.desc)?.total : null;
  const third = swimTotal ? { value: swimTotal, label: 'Distance' } : { value: w.effortZone || '—', label: 'Zone' };
  return (
    <button type="button" onClick={() => onOpen(w)} className={`w-full text-left rounded-2xl border p-3.5 active:scale-[0.99] transition-transform ${m.tint}`}>
      <div className="flex items-center gap-2">
        <SportDot type={w.type} size={26} />
        <span className="text-[13px] font-medium text-ink-200">{m.name}</span>
        {done && (
          <span className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-500">
            <Check size={14} strokeWidth={2.6} aria-hidden="true" /> Faite
          </span>
        )}
      </div>
      <p className="mt-2 text-[16px] font-bold text-ink-50 leading-snug">{w.title}</p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat value={w.duration} label="Durée" />
        <Stat value={w.intensity || '—'} label="Intensité" />
        <Stat value={third.value} label={third.label} />
      </div>
      {w.structure && <p className="mt-3 text-[13px] text-ink-300 leading-snug">{w.structure}</p>}
      <div className="mt-3 flex items-center justify-between text-[13px] font-semibold text-volt-500">
        <span>Voir la séance complète</span>
        <ChevronRight size={18} aria-hidden="true" />
      </div>
    </button>
  );
}

/** Ligne de liste groupée (sport, titre, info à droite). */
function Row({ w, right, onClick, children }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <div className="px-3 py-2.5">
      <Tag {...(onClick ? { type: 'button', onClick } : {})} className="w-full flex items-center gap-2.5 text-left min-h-[32px]">
        <SportDot type={w.type} size={24} />
        <span className="flex-1 min-w-0 text-[13px] font-medium text-ink-100 truncate">{children}</span>
        {right}
      </Tag>
    </div>
  );
}

/** Barres de la semaine : prévu (gris) et réalisé (accent), jour par jour. */
function WeekBars({ workoutsN, doneIds, todayIdx }) {
  const planned = DAYS_OF_WEEK.map((d) => workoutsN.filter((w) => w.day === d && w.type !== 'REPOS').reduce((s, w) => s + (parseDurationMinutes(w.duration) || 0), 0));
  const done = DAYS_OF_WEEK.map((d) => workoutsN.filter((w) => w.day === d && w.type !== 'REPOS' && doneIds?.has(w.id)).reduce((s, w) => s + (parseDurationMinutes(w.duration) || 0), 0));
  const max = Math.max(60, ...planned);
  return (
    <div className="grid grid-cols-7 gap-1.5 items-end" aria-hidden="true">
      {planned.map((p, i) => (
        <div key={DAYS_OF_WEEK[i]} className="flex flex-col items-center gap-1">
          <div className="relative w-full h-14 flex items-end justify-center">
            <div className="w-3.5 rounded-full bg-ink-800" style={{ height: `${Math.max(p ? 8 : 3, (p / max) * 100)}%` }} />
            {done[i] > 0 && <div className="absolute bottom-0 w-3.5 rounded-full bg-volt-500" style={{ height: `${Math.max(8, (Math.min(done[i], p) / max) * 100)}%` }} />}
          </div>
          <span className={`text-[11px] ${i === todayIdx ? 'font-bold text-volt-500' : 'text-ink-500'}`}>{DAY_LETTERS[i]}</span>
        </div>
      ))}
    </div>
  );
}

export default function TodayView({
  firstName, todayIso, workoutsN = [], feedbackHistory = [], activities = [], pastSessions = [], recentLoad = null,
  weekLoad = null, hasPlan = false, onOpenWorkout, onMarkStatus, onAskCoach, onGoto,
  objectiveDate = null, onNewObjective, doneIds = null,
}) {
  const [y, mo, d] = todayIso.split('-').map(Number);
  const date = new Date(y, mo - 1, d);
  const dayIdx = (date.getDay() + 6) % 7;
  const dayName = DAYS_OF_WEEK[dayIdx];
  const tomorrowName = dayIdx < 6 ? DAYS_OF_WEEK[dayIdx + 1] : null;
  const validated = new Set(feedbackHistory.map((f) => f.workoutId));
  const isDone = (w) => (doneIds ? doneIds.has(w.id) : validated.has(w.id) || activities.some((a) => a.matched_workout_id === w.id));
  const doneSet = doneIds || new Set(workoutsN.filter(isDone).map((w) => w.id));

  const todaySessions = workoutsN.filter((w) => w.day === dayName && w.type !== 'REPOS');
  const tomorrowSessions = tomorrowName ? workoutsN.filter((w) => w.day === tomorrowName && w.type !== 'REPOS') : [];
  const weekSessions = workoutsN.filter((w) => w.type !== 'REPOS');
  const plannedMin = weekSessions.reduce((s, w) => s + (parseDurationMinutes(w.duration) || 0), 0);
  const doneList = weekSessions.filter((w) => (doneIds ? doneIds.has(w.id) : validated.has(w.id) || pastSessions.some((p) => p.workout.id === w.id && p.status === 'done')));
  const doneMin = doneList.reduce((s, w) => s + (parseDurationMinutes(w.duration) || 0), 0);
  const toCheck = pastSessions.filter((p) => p.status !== 'done');
  const currentWeekReal = recentLoad?.weeks?.find((w) => w.current);

  return (
    <div className="space-y-4">
      {/* En-tête du jour */}
      <div className="px-1 flex items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-ink-400">{firstName ? `Salut ${firstName}` : 'Salut'}</p>
          <h2 className="text-base font-bold text-ink-50 leading-tight">{dayName} {d} {MONTHS[mo - 1]}</h2>
        </div>
        {weekLoad && (
          <span className={`inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-full ${
            weekLoad.kind === 'decharge' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-volt-500/10 text-volt-500'
          }`}>
            {weekLoad.kind === 'decharge' ? <Leaf size={13} aria-hidden="true" /> : <Flame size={13} aria-hidden="true" />}
            {weekLoad.kind === 'decharge' ? 'Décharge' : `Charge ${weekLoad.index}`}
          </span>
        )}
      </div>

      <TodayWeather onOpen={() => onGoto('weather')} />

      {/* Objectif passé : récupération puis transition (lib/seasonPlan.js). */}
      {objectiveDate && objectiveDate < todayIso && (
        <section className="bg-ink-900 border border-ink-800 rounded-2xl p-3.5 space-y-2" aria-label="Objectif passé">
          <p className="text-[15px] font-bold text-ink-50 flex items-center gap-2"><Flag size={16} className="text-volt-500" aria-hidden="true" /> Ton objectif du {objectiveDate.slice(8, 10)}/{objectiveDate.slice(5, 7)} est passé</p>
          <p className="text-[13px] text-ink-300 leading-snug">Le plan est passé en récupération, puis en transition. Fixe ton prochain objectif pour relancer une préparation.</p>
          {onNewObjective && (
            <button type="button" onClick={onNewObjective} className="w-full min-h-[46px] rounded-full bg-volt-500 text-white text-[14px] font-semibold">Définir mon prochain objectif</button>
          )}
        </section>
      )}

      {/* Aujourd'hui */}
      <section className="space-y-2.5" aria-label="Séances du jour">
        {!hasPlan ? (
          <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 text-center space-y-3">
            <p className="text-[14px] text-ink-300">Aucun plan pour le moment.</p>
            <button type="button" onClick={() => onGoto('calendar')} className="w-full min-h-[46px] rounded-full bg-volt-500 text-white text-[14px] font-semibold">Créer mon plan</button>
          </div>
        ) : !workoutsN.some((w) => w.type !== 'REPOS') ? (
          <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 text-center space-y-3">
            <p className="text-[14px] text-ink-300">La semaine en cours n'est pas encore générée.</p>
            <button type="button" onClick={() => onGoto('calendar')} className="w-full min-h-[46px] rounded-full bg-volt-500 text-white text-[14px] font-semibold">Générer ma semaine</button>
          </div>
        ) : todaySessions.length ? (
          todaySessions.map((w) => <SessionHero key={w.id} w={w} done={isDone(w)} onOpen={onOpenWorkout} />)
        ) : (
          <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4">
            <p className="text-[15px] font-bold text-ink-50">Repos aujourd'hui</p>
            <p className="text-[13px] text-ink-400 mt-0.5">Sommeil, hydratation, mobilité légère si l'envie est là.</p>
          </div>
        )}
      </section>

      {/* Demain */}
      {hasPlan && tomorrowName && (
        <section className="space-y-1.5" aria-label="Demain">
          <SectionTitle>Demain · {tomorrowName}</SectionTitle>
          <div className="bg-ink-900 border border-ink-800 rounded-2xl divide-y divide-ink-800">
            {tomorrowSessions.length ? tomorrowSessions.map((w) => (
              <Row key={w.id} w={w} onClick={() => onOpenWorkout(w)} right={<span className="text-[12px] text-ink-400 tabular-nums shrink-0">{w.duration}</span>}>{w.title}</Row>
            )) : <p className="px-3 py-3 text-[13px] text-ink-400">Repos</p>}
          </div>
        </section>
      )}

      {/* À confirmer / manquées */}
      {toCheck.length > 0 && (
        <section className="space-y-1.5" aria-label="Séances passées à vérifier">
          <SectionTitle>Plus tôt cette semaine</SectionTitle>
          <div className="bg-ink-900 border border-ink-800 rounded-2xl divide-y divide-ink-800">
            {toCheck.map(({ workout: w, status }) => (
              <div key={w.id} className="px-3 py-2.5 space-y-2">
                <div className="flex items-center gap-2.5">
                  <SportDot type={w.type} size={24} />
                  <span className="flex-1 min-w-0 text-[13px] font-medium text-ink-100 truncate">{w.day} · {w.title}</span>
                  <span className={`text-[12px] font-semibold shrink-0 ${status === 'missed' ? 'text-rose-500' : 'text-amber-500'}`}>
                    {status === 'missed' ? 'Manquée' : 'À confirmer'}
                  </span>
                </div>
                {status === 'unknown' ? (
                  <div className="grid grid-cols-2 gap-2 pl-[34px]">
                    <button type="button" onClick={() => onMarkStatus(w.id, 'done')} className="min-h-[34px] rounded-full bg-emerald-500/10 text-emerald-500 text-[12px] font-semibold inline-flex items-center justify-center gap-1">
                      <Check size={14} strokeWidth={2.6} aria-hidden="true" /> Faite
                    </button>
                    <button type="button" onClick={() => onMarkStatus(w.id, 'missed')} className="min-h-[34px] rounded-full bg-ink-800 text-ink-300 text-[12px] font-semibold inline-flex items-center justify-center gap-1">
                      <X size={14} strokeWidth={2.6} aria-hidden="true" /> Pas faite
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-[1fr_auto] gap-2 pl-[34px]">
                    <button
                      type="button"
                      onClick={() => onAskCoach(`J'ai manqué ma séance du ${w.day.toLowerCase()} : ${w.type} « ${w.title} » (${w.duration}). Propose-moi comment réorganiser la fin de ma semaine sans me surcharger — ou dis-moi s'il vaut mieux simplement passer à la suite.`)}
                      className="min-h-[34px] rounded-full bg-volt-500 text-white text-[12px] font-semibold inline-flex items-center justify-center gap-1.5"
                    >
                      <MessageCircle size={14} aria-hidden="true" /> Réorganiser avec le coach
                    </button>
                    <button type="button" onClick={() => onMarkStatus(w.id, 'skipped')} className="min-h-[34px] px-3 rounded-full bg-ink-800 text-ink-300 text-[12px] font-semibold">Ignorer</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Cette semaine */}
      {hasPlan && weekSessions.length > 0 && (
        <section className="space-y-1.5" aria-label="Ma semaine">
          <SectionTitle right={<span className="text-[12px] text-ink-400 tabular-nums">{doneList.length}/{weekSessions.length} faites</span>}>Cette semaine</SectionTitle>
          <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3.5 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Stat value={formatHm(doneMin)} label="Fait" />
              <Stat value={formatHm(plannedMin)} label="Prévu" />
              <Stat value={currentWeekReal ? formatHm(currentWeekReal.totalHours * 60) : '—'} label="Strava" />
            </div>
            <WeekBars workoutsN={workoutsN} doneIds={doneSet} todayIdx={dayIdx} />
          </div>
        </section>
      )}

      {/* Forme */}
      <section className="space-y-1.5" aria-label="Ma forme">
        <SectionTitle right={<InfoTip id="forme" />}>Ma forme</SectionTitle>
        <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3.5 space-y-2.5">
          {recentLoad?.load ? (
            <>
              <p className="text-[14px] font-semibold text-ink-50">{recentLoad.load.label || 'Charge calculée'}</p>
              <div className="grid grid-cols-3 gap-3">
                <Stat value={recentLoad.load.ctl} label="Forme" />
                <Stat value={recentLoad.load.atl} label="Fatigue" />
                <Stat value={recentLoad.load.tsb} label="Fraîcheur" />
              </div>
              {recentLoad.avgCompletedWeekHours != null && (
                <p className="text-[12px] text-ink-400">Moyenne des dernières semaines complètes : <span className="text-ink-200 tabular-nums">{recentLoad.avgCompletedWeekHours} h</span></p>
              )}
            </>
          ) : (
            <p className="text-[13px] text-ink-400 leading-snug">
              Connecte Strava (ta photo en haut à droite → réglages) pour que le coach tienne compte de ce que tu fais vraiment, pas seulement du plan.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
