import React, { useState, useEffect } from 'react';
import { shortLabel, getDetailFields, parseClubSessionDesc } from '../lib/workouts';
import { parseIntervalStructure } from '../lib/intervalParser';
import { fetchCurrentConditions, computeHeatPaceAdjustment, applyPaceAdjustment, applyPowerAdjustment } from '../lib/weather';
import { isoDateToDayName } from '../lib/stravaMatch';

// Point 3 — Ajustement des séances selon la météo réelle (façon EnviroNorm de TriDot).
// Uniquement pour la séance du JOUR (pas de sens d'ajuster une allure pour dans 3
// jours, la météo n'est pas fiable à cet horizon) et pour RUN/BIKE (SWIM = piscine
// par défaut dans cette app, jamais concernée par la météo extérieure).
function EnviroAdjustment({ workout }) {
  const label = shortLabel(workout.type);
  const isToday = workout.day === isoDateToDayName(new Date().toISOString());
  const eligible = isToday && (label === 'RUN' || label === 'BIKE');

  const [status, setStatus] = useState('idle'); // idle | loading | denied | error | done
  const [conditions, setConditions] = useState(null); // { tempC, humidityPct }
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!eligible) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setStatus('error'); return; }
    setStatus('loading');
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const c = await fetchCurrentConditions(pos.coords.latitude, pos.coords.longitude);
          if (!cancelled) { setConditions(c); setStatus('done'); }
        } catch {
          if (!cancelled) setStatus('error');
        }
      },
      () => { if (!cancelled) setStatus('denied'); },
      { timeout: 8000 }
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, workout.id]);

  if (!eligible || dismissed) return null;

  if (status === 'idle' || status === 'loading') {
    return <p className="text-[10px] text-ink-500 italic mb-2">🌦️ Vérification de la météo du jour…</p>;
  }

  if (status === 'denied' || status === 'error' || !conditions || !Number.isFinite(conditions.tempC)) {
    return (
      <p className="text-[10px] text-ink-500 italic mb-2">
        🌦️ Active la localisation pour ajuster automatiquement cette séance à la météo du jour.
      </p>
    );
  }

  const adjustment = computeHeatPaceAdjustment(conditions.tempC, conditions.humidityPct);
  const humidityLabel = conditions.humidityPct != null ? `${Math.round(conditions.humidityPct)}% hum.` : 'humidité inconnue';

  if (!adjustment.active) {
    return (
      <p className="text-[10px] text-ink-500 mb-2">
        🌡️ {Math.round(conditions.tempC)}°C · {humidityLabel} — conditions favorables, allure inchangée.
      </p>
    );
  }

  const adjustedValue = label === 'RUN'
    ? applyPaceAdjustment(workout.intensity, adjustment.pct)
    : applyPowerAdjustment(workout.intensity, adjustment.pct);

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 p-2.5 rounded-lg mb-2 space-y-1.5">
      <p className="text-[10px] text-amber-300 leading-relaxed">
        🌡️ {Math.round(conditions.tempC)}°C · {humidityLabel} — chaleur/humidité au-delà du seuil, allure ajustée
        {adjustment.level === 'high' ? ' fortement' : ''} (
        {label === 'RUN' ? '+' : '−'}
        {Math.round(adjustment.pct * 100)}%).
      </p>
      {adjustedValue && (
        <p className="text-xs font-mono">
          <span className="text-ink-500 line-through mr-2">{workout.intensity}</span>
          <span className="text-volt-400 font-bold">{adjustedValue}</span>
        </p>
      )}
      <button
        onClick={() => setDismissed(true)}
        className="text-[9px] text-ink-500 underline underline-offset-2 min-h-tap"
      >
        Séance en intérieur (home trainer/piscine) ? Ignorer cet ajustement
      </button>
    </div>
  );
}

// Barres de blocs effort/récup pour le corps de séance, en remplacement de la
// lecture "N*(effort-récup)" qui demande un calcul mental à chaque fois. On
// plafonne l'affichage à 16 blocs (au-delà, un fractionné long devient
// illisible en barres de toute façon) et on l'indique via un badge "×N total".
function IntervalBars({ desc }) {
  const parsed = parseIntervalStructure(desc);
  if (!parsed || !parsed.blocks.length) return null;

  const MAX_BLOCKS = 16;
  const shown = parsed.blocks.slice(0, MAX_BLOCKS);
  const truncated = parsed.blocks.length > MAX_BLOCKS;

  return (
    <div className="bg-volt-500/5 border border-volt-500/20 p-2.5 rounded-lg mb-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] text-volt-400 uppercase font-bold">Corps de séance · {parsed.reps} rép.</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {shown.map((b, i) => (
          <div
            key={i}
            title={b.label}
            className={`h-5 min-w-[18px] px-1 rounded flex items-center justify-center text-[8px] font-mono font-bold ${
              b.isRecovery
                ? 'border border-ink-600 text-ink-400'
                : 'bg-volt-500 text-white'
            }`}
          >
            {b.label.length <= 6 ? b.label : ''}
          </div>
        ))}
        {truncated && (
          <div className="h-5 px-1.5 rounded flex items-center justify-center text-[8px] font-mono font-bold text-ink-500 border border-dashed border-ink-700">
            +{parsed.blocks.length - MAX_BLOCKS}
          </div>
        )}
      </div>
      <p className="text-[8px] text-ink-500 mt-1.5">
        <span className="inline-block w-2 h-2 bg-volt-500 rounded-sm align-middle mr-1" />effort
        <span className="inline-block w-2 h-2 border border-ink-600 rounded-sm align-middle ml-2 mr-1" />récup
      </p>
    </div>
  );
}


function RatingSlider({ label, value, onChange, hint }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] font-bold uppercase text-ink-400">{label}</span>
        <span className="text-xs font-black text-volt-400 font-mono">{value}/10</span>
      </div>
      <input
        type="range"
        min="1"
        max="10"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-volt-500"
      />
      {hint && <p className="text-[9px] text-ink-500 mt-0.5">{hint}</p>}
    </div>
  );
}

function SessionValidation({ workout, existingFeedback, pendingAdjustment, onSubmit, onLighten, onKeep }) {
  const [showForm, setShowForm] = useState(false);
  const [difficulty, setDifficulty] = useState(5);
  const [capacity, setCapacity] = useState(5);
  const [justValidated, setJustValidated] = useState(false);

  const isPending = pendingAdjustment?.workout?.id === workout.id;

  // Micro-pulse au tap : on ne rejoue l'animation qu'une fois, juste après la
  // validation, puis on la coupe pour ne pas boucler indéfiniment sur le badge.
  useEffect(() => {
    if (!justValidated) return;
    const t = setTimeout(() => setJustValidated(false), 1400);
    return () => clearTimeout(t);
  }, [justValidated]);

  if (isPending) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-xl space-y-2">
        <p className="text-[11px] text-amber-300 leading-relaxed">⚠️ {pendingAdjustment.analysis.reason}</p>
        <p className="text-[11px] text-ink-300">Faut-il alléger la suite de la semaine ?</p>
        <div className="flex gap-2">
          <button onClick={onLighten} className="flex-1 bg-volt-500 hover:bg-volt-600 text-white font-bold px-3 py-2 rounded-xl text-[11px] min-h-tap">
            Alléger la semaine
          </button>
          <button onClick={onKeep} className="flex-1 bg-ink-800 hover:bg-ink-700 text-ink-50 font-bold px-3 py-2 rounded-xl text-[11px] min-h-tap">
            Garder comme ça
          </button>
        </div>
      </div>
    );
  }

  if (existingFeedback) {
    return (
      <div
        className={`bg-emerald-950/40 border border-emerald-800 p-3 rounded-xl text-[11px] text-emerald-300 flex justify-between ${justValidated ? 'animate-pulseGlow' : ''}`}
      >
        <span>✅ Séance validée</span>
        <span className="font-mono">Dureté {existingFeedback.difficulty}/10 · Forme {existingFeedback.capacity}/10</span>
      </div>
    );
  }

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="w-full bg-ink-800 hover:bg-ink-700 text-ink-50 font-bold px-3 py-2.5 rounded-xl text-xs uppercase min-h-tap"
      >
        ✔️ Valider la séance
      </button>
    );
  }

  return (
    <div className="bg-ink-950 border border-ink-800 p-3 rounded-xl space-y-3">
      <RatingSlider label="Dureté ressentie" value={difficulty} onChange={setDifficulty} hint="1 = très facile, 10 = extrêmement dur" />
      <RatingSlider label="Forme physique" value={capacity} onChange={setCapacity} hint="1 = mauvaise forme, 10 = en pleine forme" />
      <button
        onClick={() => { onSubmit(difficulty, capacity); setShowForm(false); setJustValidated(true); }}
        className="w-full bg-volt-500 hover:bg-volt-600 text-white font-bold px-3 py-2 rounded-xl text-xs uppercase min-h-tap"
      >
        Envoyer mon ressenti
      </button>
    </div>
  );
}

// "Feuille de club" (revoit la présentation de la séance demandée) : jusqu'ici, "desc"
// s'affichait comme un bloc de texte brut unique (whitespace-pre-line) — lisible, mais
// rien ne distinguait visuellement Échauffement / Corps de séance / Total, contrairement
// à une vraie feuille de séance de club (voir capture fournie : blocs bien séparés,
// en-têtes colorés, total mis en avant). On découpe maintenant "desc" via
// parseClubSessionDesc (lib/workouts.js) et on rend chaque bloc séparément, avec le
// total (natation) mis en avant comme un vrai badge plutôt que noyé dans le texte.
// Si le texte ne suit pas ce formalisme (ex: vieille séance générée avant la refonte,
// ou séance REPOS), on retombe sur l'ancien rendu texte brut — jamais de section vide.
function SeriesLines({ text }) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <div className="space-y-1">
      {lines.map((line, i) => (
        <p key={i} className="text-[11px] font-mono text-ink-100 leading-snug">{line}</p>
      ))}
    </div>
  );
}

function ClubSessionSheet({ desc }) {
  const parsed = parseClubSessionDesc(desc);
  if (!parsed) {
    return (
      <div className="bg-ink-950 p-3 rounded-xl border border-ink-800 text-xs text-ink-300 leading-relaxed whitespace-pre-line">
        {desc}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-ink-800 overflow-hidden">
      {parsed.warmup && (
        <div className="bg-ink-950 border-b border-ink-800 p-2.5">
          <span className="text-[9px] font-black uppercase tracking-wide text-ink-500 block mb-1">Échauffement</span>
          <SeriesLines text={parsed.warmup} />
        </div>
      )}
      <div className="bg-ink-950 p-2.5 relative">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] font-black uppercase tracking-wide text-volt-400">Corps de séance</span>
          {parsed.total && (
            <span className="text-[9px] font-black font-mono uppercase text-volt-400 bg-volt-500/10 border border-volt-500/30 px-1.5 py-0.5 rounded-md">
              Total {parsed.total}
            </span>
          )}
        </div>
        <SeriesLines text={parsed.main} />
      </div>
    </div>
  );
}

function FieldsGrid({ workout, title, dimmed }) {
  const fields = getDetailFields(workout);
  return (
    <div className={dimmed ? 'opacity-60' : ''}>
      {title && <p className="text-[10px] font-bold uppercase text-ink-500 mb-1.5">{title}</p>}
      <p className="text-xs font-bold text-ink-50 mb-1.5">{workout.title} · <span className="font-mono text-ink-400">{workout.duration}</span></p>
      {!dimmed && <EnviroAdjustment workout={workout} />}
      {!dimmed && <IntervalBars desc={workout.desc} />}
      {workout.structure && (
        <div className="bg-volt-500/5 border border-volt-500/20 p-2.5 rounded-lg mb-2">
          <span className="text-[9px] text-volt-400 uppercase font-bold block mb-0.5">Structure de la séance</span>
          <p className="text-[11px] text-ink-200 leading-relaxed">{workout.structure}</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
        {fields.map((f) => (
          <div key={f.label} className="bg-ink-950 border border-ink-800 p-2.5 rounded-xl">
            <span className="text-[9px] text-ink-500 uppercase block">{f.label}</span>
            <span className="font-bold text-volt-400">{f.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WorkoutDetail({ workout, onClose, existingFeedback, pendingAdjustment, onSubmitFeedback, onLightenWeek, onKeepAsIs }) {
  if (!workout) return null;
  return (
    // items-end (+ sm:items-center) : feuille qui monte du bas sur mobile, boîte de
    // dialogue centrée classique dès qu'on a la place (tablette/desktop).
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-end sm:items-center justify-center animate-sheetBackdrop"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-ink-900 border border-ink-800 sm:border w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-4 shadow-2xl text-ink-100 max-h-[92vh] overflow-y-auto animate-slideUp sm:animate-none"
      >
        {/* Poignée de glissement : signal visuel "feuille tactile" (comme les app iOS/Android
            natives), masquée dès qu'on repasse en boîte de dialogue desktop centrée. */}
        <div className="sm:hidden -mt-1.5 mb-1 flex justify-center">
          <span className="w-9 h-1 rounded-full bg-ink-700" />
        </div>

        <div className="flex justify-between items-start border-b border-ink-800 pb-3">
          <div>
            <span className="text-[10px] font-mono font-bold uppercase text-volt-400 bg-volt-500/10 border border-volt-500/20 px-2 py-0.5 rounded-md">
              {workout.day} · {shortLabel(workout.type)}
            </span>
            {workout.modified && (
              <span className="inline-block mt-1 ml-1 text-[9px] font-bold text-volt-400 bg-volt-500/10 border border-volt-500/30 px-1.5 py-0.5 rounded">
                {workout.added ? 'AJOUTÉE VIA CHAT' : 'MODIFIÉE VIA CHAT'}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-50 font-bold p-1 min-h-tap min-w-[44px]">✕</button>
        </div>

        {/* Comparaison : l'ancienne séance reste visible au-dessus de la nouvelle */}
        {workout.previous && (
          <div className="bg-ink-950/60 border border-dashed border-ink-700 p-3 rounded-xl">
            <FieldsGrid workout={workout.previous} title="AVANT" dimmed />
          </div>
        )}

        <div className={workout.previous ? 'bg-ink-950 border border-volt-500/30 p-3 rounded-xl' : ''}>
          {workout.previous && <p className="text-[10px] font-bold uppercase text-volt-400 mb-1.5">APRÈS</p>}
          <FieldsGrid workout={workout} />
        </div>

        {/* Rendu "feuille de club" (voir ClubSessionSheet ci-dessus) : blocs Échauffement /
            Corps de séance bien séparés, total natation mis en avant en badge — au lieu
            d'un unique bloc de texte brut. Retombe automatiquement sur l'ancien rendu texte
            si "desc" ne suit pas ce formalisme (ex: séance REPOS, contenu legacy). */}
        <ClubSessionSheet desc={workout.desc} />

        {workout.type !== 'REPOS' && (
          <SessionValidation
            workout={workout}
            existingFeedback={existingFeedback}
            pendingAdjustment={pendingAdjustment}
            onSubmit={(difficulty, capacity) => onSubmitFeedback?.(workout, difficulty, capacity)}
            onLighten={onLightenWeek}
            onKeep={onKeepAsIs}
          />
        )}

        <div className="flex justify-end pt-2 border-t border-ink-800 text-xs">
          <button
            onClick={onClose}
            className="bg-ink-800 hover:bg-ink-700 text-ink-50 font-bold px-4 py-2 rounded-xl text-xs uppercase min-h-tap"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
