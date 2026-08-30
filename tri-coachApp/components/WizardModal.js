import React, { useMemo, useState } from 'react';
import { checkPlanCoherence } from '../lib/workouts';

const AVG_TIME_TABLE = {
  running: {
    '5km': { homme: '20 - 24 min', femme: '23 - 28 min' },
    '10km': { homme: '42 - 50 min', femme: '48 - 58 min' },
    'Semi-marathon': { homme: '1h35 - 1h50', femme: '1h50 - 2h05' },
    Marathon: { homme: '3h30 - 4h00', femme: '3h55 - 4h30' },
  },
  triathlon: {
    XS: '40 - 50 min',
    S: '1h10 - 1h25',
    M: '2h30 - 2h50',
    L: '4h45 - 5h30',
    XL: '10h00 - 12h00',
  },
};

const TRIATHLON_FORMAT_DISTANCES = {
  XS: { swim: 0.4, bike: 10, run: 2.5 },
  S: { swim: 0.75, bike: 20, run: 5 },
  M: { swim: 1.5, bike: 40, run: 10 },
  L: { swim: 1.9, bike: 90, run: 21.1 },
  XL: { swim: 3.8, bike: 180, run: 42.2 },
};

// UX mobile — proposition 3 ("un sujet à la fois") : l'ancienne grille à 6 colonnes
// (temps visé par discipline) tenait mal sur un écran de ~375px. Ces 5 champs sont
// maintenant affichés UN À LA FOIS (gros champ, onglets pour changer de discipline) via
// TRI_TIME_FIELDS + activeTriField ci-dessous, plutôt qu'en grille serrée.
const TRI_TIME_FIELDS = [
  { key: 'swim', short: 'Nat', label: 'Natation', icon: '🏊', placeholder: 'ex: 00:30', color: 'text-cyan-400', hasAllure: true },
  { key: 'transition_t1', short: 'T1', label: 'Transition 1 (T1)', icon: '🔄', placeholder: 'ex: 00:02', color: 'text-ink-400', hasAllure: false },
  { key: 'bike', short: 'Vélo', label: 'Vélo', icon: '🚴', placeholder: 'ex: 01:15', color: 'text-amber-400', hasAllure: true },
  { key: 'transition_t2', short: 'T2', label: 'Transition 2 (T2)', icon: '🔄', placeholder: 'ex: 00:01', color: 'text-ink-400', hasAllure: false },
  { key: 'run', short: 'Course', label: 'Course à pied', icon: '🏃', placeholder: 'ex: 00:45', color: 'text-emerald-400', hasAllure: true },
];

export default function WizardModal({ isOpen, onClose, onComplete, submitting = false, submitError = null }) {
  const [step, setStep] = useState(1);
  // Discipline actuellement affichée dans le sélecteur "temps visé" de l'étape 3
  // (voir TRI_TIME_FIELDS ci-dessus) — indépendant de `step`, propre à ce mini-flux.
  const [activeTriField, setActiveTriField] = useState('swim');
  const [formData, setFormData] = useState({
    firstName: '',
    eventName: '',
    gender: 'homme',
    weight: '',
    fitnessLevel: 3,
    trainingExperience: 'intermediaire', // 'debutant' | 'novice' | 'intermediaire' | 'confirme' | 'expert' — voir sélecteur ci-dessous
    sportType: 'running', // 'running' | 'triathlon'

    runningSubtype: 'road', // 'road' | 'trail'
    distance: '10km',
    trailKm: '',
    trailElevation: '',
    triathlonFormat: 'M',
    customDistances: { swim: 1.5, bike: 40, run: 10 },

    targetTime: '',
    triathlonTimes: { swim: '', transition_t1: '', bike: '', transition_t2: '', run: '', total: '' },

    targetDate: '',
    hoursPerWeek: 8,
    maxSessionsPerWeek: 4,
    offDays: 'Mercredi',

    runningPace: 6.0,

    // --- Données physio & performances (toutes facultatives, mais utilisées pour
    // adapter réellement le plan au lieu de valeurs génériques identiques pour tout
    // le monde — voir lib/physiology.js) ---
    age: '',
    recentResult: { distanceKm: '', time: '', context: '' }, // dernière perf CONNUE = niveau ACTUEL (pas l'objectif, voir étape 3)
    knownPhysio: { vma: '', ftp: '', css: '', fcMax: '', fcRepos: '' },
    // Équipement dispo pour le test vélo (FTP) — pilote quelle variante du test terrain
    // (home trainer vs route) est proposée si la FTP n'est pas encore connue. Voir
    // lib/workouts.js PHYSIO_TEST_TEMPLATES.CYCLISME_HOMETRAINER / CYCLISME_ROUTE.
    bikeTestEquipment: 'route',
  });

  const hoursSessionsWarning = useMemo(() => {
    const hours = Number(formData.hoursPerWeek) || 0;
    const sessions = Number(formData.maxSessionsPerWeek) || 1;
    const avgMinutes = (hours * 60) / sessions;
    if (avgMinutes < 35) {
      return `Avec ${hours}h pour ${sessions} séances, ça fait ${Math.round(avgMinutes)} min/séance en moyenne — ça semble difficilement réalisable.`;
    }
    if (avgMinutes > 300) return 'Trop long par séance en moyenne (> 5 h).';
    return null;
  }, [formData.hoursPerWeek, formData.maxSessionsPerWeek]);

  const coherenceWarnings = useMemo(() => {
    const base = checkPlanCoherence(formData) || [];
    if (hoursSessionsWarning) base.unshift(hoursSessionsWarning);
    return base;
  }, [formData, hoursSessionsWarning]);

  const runningDistanceKm = useMemo(() => {
    if (formData.runningSubtype === 'trail') return Number(formData.trailKm) || 0;
    const map = { '5km': 5, '10km': 10, 'Semi-marathon': 21.0975, Marathon: 42.195 };
    return map[formData.distance] || 0;
  }, [formData.runningSubtype, formData.distance, formData.trailKm]);

  const runningTotalMinutes = useMemo(() => {
    return formData.runningPace * runningDistanceKm;
  }, [formData.runningPace, runningDistanceKm]);

  if (!isOpen) return null;

  const getAverageTimeIndicator = () => {
    if (formData.sportType === 'running') {
      return AVG_TIME_TABLE.running[formData.distance]?.[formData.gender] || 'Variable selon niveau';
    }
    return AVG_TIME_TABLE.triathlon[formData.triathlonFormat] || 'Variable selon niveau';
  };

  const handleNext = () => setStep((s) => Math.min(5, s + 1));
  const handlePrev = () => setStep((s) => Math.max(1, s - 1));

  const hhmmToMinutes = (str) => {
    if (!str) return 0;
    if (typeof str === 'number') return str;
    const m = String(str).trim();
    if (m.includes(':')) {
      const [h, mm] = m.split(':').map(Number);
      return (h || 0) * 60 + (mm || 0);
    }
    if (m.endsWith('h')) return parseFloat(m) * 60;
    if (m.endsWith('min')) return parseFloat(m);
    return parseFloat(m) || 0;
  };

  const minutesToHHMM = (mins) => {
    if (!Number.isFinite(mins)) return '';
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h${m.toString().padStart(2, '0')}m` : `${m}m`;
  };

  const updateTriField = (key, value) => {
    const next = { ...formData, triathlonTimes: { ...formData.triathlonTimes, [key]: value } };
    const total = (() => {
      const swim = hhmmToMinutes(next.triathlonTimes.swim);
      const t1 = hhmmToMinutes(next.triathlonTimes.transition_t1);
      const bike = hhmmToMinutes(next.triathlonTimes.bike);
      const t2 = hhmmToMinutes(next.triathlonTimes.transition_t2);
      const run = hhmmToMinutes(next.triathlonTimes.run);
      return minutesToHHMM(swim + t1 + bike + t2 + run);
    })();
    next.triathlonTimes.total = total;
    setFormData(next);
  };

  const formatPace = (minutesPerUnit) => {
    if (!Number.isFinite(minutesPerUnit) || minutesPerUnit <= 0) return '—';
    const m = Math.floor(minutesPerUnit);
    const s = Math.round((minutesPerUnit - m) * 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const getDisciplineAllure = (key) => {
    const timeMin = hhmmToMinutes(formData.triathlonTimes[key]);
    const distanceKm = Number(formData.customDistances[key]) || 0;
    if (!timeMin || !distanceKm) return '—';
    if (key === 'swim') return `${formatPace(timeMin / (distanceKm * 1000 / 100))} /100m`;
    if (key === 'bike') return `${(distanceKm / (timeMin / 60)).toFixed(1)} km/h`;
    if (key === 'run') return `${formatPace(timeMin / distanceKm)} /km`;
    return '—';
  };

  const onRunningTotalChange = (valMinutes) => {
    const pace = runningDistanceKm > 0 ? valMinutes / runningDistanceKm : formData.runningPace;
    setFormData({ ...formData, runningPace: Number(pace), targetTime: minutesToHHMM(valMinutes) });
  };

  const selectTriathlonFormat = (fmt) => {
    setFormData({
      ...formData,
      triathlonFormat: fmt,
      customDistances: TRIATHLON_FORMAT_DISTANCES[fmt] || formData.customDistances,
    });
  };

  // Une incohérence "dure" (durée moyenne par séance totalement irréaliste)
  // doit bloquer la génération, pas juste afficher un avertissement ignorable.
  const hasBlockingWarning = useMemo(() => {
    const hours = Number(formData.hoursPerWeek) || 0;
    const sessions = Number(formData.maxSessionsPerWeek) || 1;
    const avgMinutes = (hours * 60) / sessions;
    return avgMinutes < 20 || avgMinutes > 240;
  }, [formData.hoursPerWeek, formData.maxSessionsPerWeek]);

  const stepIsValid = () => {
    if (step === 1) return Boolean(formData.firstName?.trim()) && Boolean(formData.weight) && Number(formData.weight) > 0;
    if (step === 5) return Boolean(formData.targetDate) && Number(formData.hoursPerWeek) > 0 && Number(formData.maxSessionsPerWeek) > 0 && !hasBlockingWarning;
    return true;
  };

  const formatDateFR = (iso) => {
    if (!iso) return '';
    try {
      return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(iso));
    } catch (e) {
      return iso;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm animate-sheetBackdrop">
      <div className="bg-ink-900 border border-ink-800 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl space-y-6 text-ink-100 max-h-[92vh] overflow-y-auto animate-slideUp sm:animate-none">

        <div className="sm:hidden -mt-2.5 -mb-2 flex justify-center">
          <span className="w-9 h-1 rounded-full bg-ink-700" />
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-wide text-ink-50 font-display">Nouveau plan</h2>
          <span className="text-[10px] font-mono text-ink-500">Étape {step} / 5</span>
        </div>

        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full ${s <= step ? 'bg-volt-500' : 'bg-ink-800'}`}
            />
          ))}
        </div>

        <div className="space-y-4">

          {/* STEP 1 : Profil & discipline */}
          {step === 1 && (
            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wide text-volt-400">1. Profil & discipline</h3>

              <div>
                <label className="text-sm text-ink-300 block mb-1.5">Prénom</label>
                <input
                  type="text"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  placeholder="Ex: Marin"
                  className="w-full bg-ink-950 border border-ink-800 rounded-xl p-3 text-base text-ink-50 placeholder-ink-600 min-h-tap"
                />
              </div>

              <div>
                <label className="text-sm text-ink-300 block mb-1.5">Nom de l'objectif (optionnel)</label>
                <input
                  type="text"
                  value={formData.eventName}
                  onChange={(e) => setFormData({ ...formData, eventName: e.target.value })}
                  placeholder="Ex: Triathlon de Deauville"
                  className="w-full bg-ink-950 border border-ink-800 rounded-xl p-3 text-base text-ink-50 placeholder-ink-600 min-h-tap"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-ink-300 block mb-1.5">Genre</label>
                  <div className="flex bg-ink-950 border border-ink-800 rounded-xl p-0.5">
                    {['homme', 'femme'].map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setFormData({ ...formData, gender: g })}
                        className={`flex-1 py-3 rounded-lg text-sm font-bold capitalize transition-all min-h-tap ${
                          formData.gender === g ? 'bg-volt-500 text-white' : 'text-ink-400'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm text-ink-300 block mb-1.5">Poids (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.weight}
                    onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                    placeholder="ex: 70"
                    className="w-full bg-ink-950 border border-ink-800 rounded-xl p-3 text-base text-ink-50 placeholder-ink-600 min-h-tap"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm text-ink-300 block mb-1.5">
                  Niveau de forme actuel : <strong className="text-volt-400 font-mono">{formData.fitnessLevel} / 5</strong>
                </label>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={formData.fitnessLevel}
                  onChange={(e) => setFormData({ ...formData, fitnessLevel: Number(e.target.value) })}
                  className="w-full accent-volt-500 cursor-pointer"
                />
              </div>

              <div>
                <label className="text-sm text-ink-300 block mb-1.5">
                  Expérience d'entraînement structuré (distinct de la forme du moment — ex: un athlète
                  confirmé qui reprend après une pause a une forme basse mais reste expérimenté)
                </label>
                <select
                  value={formData.trainingExperience}
                  onChange={(e) => setFormData({ ...formData, trainingExperience: e.target.value })}
                  className="w-full bg-ink-950 border border-ink-800 rounded-xl p-3 text-base text-ink-50 min-h-tap"
                >
                  <option value="debutant">Débutant complet — jamais suivi de plan structuré</option>
                  <option value="novice">Novice — moins de 6 mois de pratique régulière</option>
                  <option value="intermediaire">Intermédiaire — 6 mois à 2 ans, quelques courses/objectifs</option>
                  <option value="confirme">Confirmé — 2 à 5 ans, plusieurs objectifs déjà préparés</option>
                  <option value="expert">Expert/compétiteur — 5 ans+ d'entraînement structuré</option>
                </select>
              </div>

              <div>
                <label className="text-sm text-ink-300 block mb-1.5">Type de sport</label>
                <div className="flex bg-ink-950 border border-ink-800 rounded-xl p-0.5">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, sportType: 'running' })}
                    className={`flex-1 py-3 rounded-lg text-sm font-bold transition-all min-h-tap ${
                      formData.sportType === 'running' ? 'bg-volt-500 text-white' : 'text-ink-400'
                    }`}
                  >
                    Course à pied
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, sportType: 'triathlon' })}
                    className={`flex-1 py-3 rounded-lg text-sm font-bold transition-all min-h-tap ${
                      formData.sportType === 'triathlon' ? 'bg-volt-500 text-white' : 'text-ink-400'
                    }`}
                  >
                    Triathlon
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2 : Format & distance */}
          {step === 2 && (
            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wide text-volt-400">2. Format & distance</h3>

              {formData.sportType === 'running' ? (
                <>
                  <div>
                    <label className="text-sm text-ink-300 block mb-1.5">Type de course</label>
                    <div className="flex bg-ink-950 border border-ink-800 rounded-xl p-0.5">
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, runningSubtype: 'road' })}
                        className={`flex-1 py-3 rounded-lg text-sm font-bold transition-all min-h-tap ${
                          formData.runningSubtype === 'road' ? 'bg-volt-500 text-white' : 'text-ink-400'
                        }`}
                      >
                        Route
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, runningSubtype: 'trail' })}
                        className={`flex-1 py-3 rounded-lg text-sm font-bold transition-all min-h-tap ${
                          formData.runningSubtype === 'trail' ? 'bg-volt-500 text-white' : 'text-ink-400'
                        }`}
                      >
                        Trail
                      </button>
                    </div>
                  </div>

                  {formData.runningSubtype === 'road' ? (
                    <div>
                      <label className="text-sm text-ink-300 block mb-1.5">Distance</label>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.keys(AVG_TIME_TABLE.running).map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setFormData({ ...formData, distance: d })}
                            className={`py-3 rounded-xl border text-sm font-bold transition-all min-h-tap ${
                              formData.distance === d
                                ? 'border-volt-500 bg-volt-500/10 text-volt-400'
                                : 'border-ink-800 bg-ink-950 text-ink-400'
                            }`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-sm text-ink-300 block mb-1.5">Distance (km)</label>
                        <input
                          type="number"
                          step="0.5"
                          value={formData.trailKm}
                          onChange={(e) => setFormData({ ...formData, trailKm: e.target.value })}
                          placeholder="ex: 42"
                          className="w-full bg-ink-950 border border-ink-800 rounded-xl p-3 text-base text-ink-50 placeholder-ink-600 min-h-tap"
                        />
                      </div>
                      <div>
                        <label className="text-sm text-ink-300 block mb-1.5">D+ (m)</label>
                        <input
                          type="number"
                          step="50"
                          value={formData.trailElevation}
                          onChange={(e) => setFormData({ ...formData, trailElevation: e.target.value })}
                          placeholder="ex: 1800"
                          className="w-full bg-ink-950 border border-ink-800 rounded-xl p-3 text-base text-ink-50 placeholder-ink-600 min-h-tap"
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label className="text-sm text-ink-300 block mb-1.5">Format</label>
                    <div className="grid grid-cols-5 gap-1.5">
                      {Object.keys(AVG_TIME_TABLE.triathlon).map((fmt) => (
                        <button
                          key={fmt}
                          type="button"
                          onClick={() => selectTriathlonFormat(fmt)}
                          className={`py-3 rounded-xl border text-sm font-bold transition-all min-h-tap ${
                            formData.triathlonFormat === fmt
                              ? 'border-volt-500 bg-volt-500/10 text-volt-400'
                              : 'border-ink-800 bg-ink-950 text-ink-400'
                          }`}
                        >
                          {fmt}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-ink-300 block mb-1.5">Distances (km) — modifiables</label>
                    {/* 3 colonnes -> 1 seule sur mobile (chaque champ respire, lisible à 16px),
                        retrouve la densité d'origine à partir de sm: (tablette/desktop). */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono">
                      <div className="flex sm:block items-center gap-2 bg-ink-950 sm:bg-transparent border sm:border-0 border-ink-800 rounded-xl p-2 sm:p-0">
                        <span className="text-xs text-cyan-400 w-16 sm:w-auto shrink-0 sm:block sm:mb-0.5">🏊 Nat</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.05"
                          value={formData.customDistances.swim}
                          onChange={(e) => setFormData({ ...formData, customDistances: { ...formData.customDistances, swim: Number(e.target.value) } })}
                          className="w-full sm:bg-ink-950 border-0 sm:border sm:border-ink-800 rounded-xl p-2 text-base text-center sm:text-left text-ink-50 min-h-tap"
                        />
                      </div>
                      <div className="flex sm:block items-center gap-2 bg-ink-950 sm:bg-transparent border sm:border-0 border-ink-800 rounded-xl p-2 sm:p-0">
                        <span className="text-xs text-amber-400 w-16 sm:w-auto shrink-0 sm:block sm:mb-0.5">🚴 Vélo</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="1"
                          value={formData.customDistances.bike}
                          onChange={(e) => setFormData({ ...formData, customDistances: { ...formData.customDistances, bike: Number(e.target.value) } })}
                          className="w-full sm:bg-ink-950 border-0 sm:border sm:border-ink-800 rounded-xl p-2 text-base text-center sm:text-left text-ink-50 min-h-tap"
                        />
                      </div>
                      <div className="flex sm:block items-center gap-2 bg-ink-950 sm:bg-transparent border sm:border-0 border-ink-800 rounded-xl p-2 sm:p-0">
                        <span className="text-xs text-emerald-400 w-16 sm:w-auto shrink-0 sm:block sm:mb-0.5">🏃 Course</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.5"
                          value={formData.customDistances.run}
                          onChange={(e) => setFormData({ ...formData, customDistances: { ...formData.customDistances, run: Number(e.target.value) } })}
                          className="w-full sm:bg-ink-950 border-0 sm:border sm:border-ink-800 rounded-xl p-2 text-base text-center sm:text-left text-ink-50 min-h-tap"
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 3 : Objectif & prédiction */}
          {step === 3 && (
            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wide text-volt-400">3. Objectif & prédiction de temps</h3>

              <p className="text-[11px] text-ink-500 leading-relaxed">
                🎯 C'est ta <strong className="text-ink-300">CIBLE</strong> — le temps que tu VEUX atteindre, pas ton niveau actuel
                (celui-ci se renseigne à l'étape suivante). Le coach fait progresser tes allures/watts de séance vers cette
                cible au fil des semaines, à partir de ton niveau actuel mesuré par les tests terrain proposés dans le plan.
              </p>

              <div className="bg-ink-950 border border-ink-800 p-3 rounded-xl text-xs space-y-1">
                <span className="text-[10px] text-ink-500 uppercase block font-mono">💡 Indicateur de référence moyen ({formData.gender})</span>
                <p className="text-ink-300">Temps moyen estimé : <strong className="text-volt-400 font-mono">{getAverageTimeIndicator()}</strong></p>
              </div>

              {formData.sportType === 'triathlon' ? (
                <div className="space-y-3">
                  <label className="text-sm text-ink-300 block">Temps visé par discipline (hh:mm)</label>

                  {/* Onglets discipline — un seul gros champ affiché à la fois (voir
                      TRI_TIME_FIELDS/activeTriField) plutôt que 5 petites cases côte à
                      côte. Un point plein indique une discipline déjà renseignée. */}
                  <div className="grid grid-cols-5 gap-1">
                    {TRI_TIME_FIELDS.map((f) => {
                      const filled = Boolean(formData.triathlonTimes[f.key]);
                      const isActive = activeTriField === f.key;
                      return (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => setActiveTriField(f.key)}
                          className={`flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl border text-[10px] font-bold min-h-tap transition-all ${
                            isActive
                              ? 'border-volt-500 bg-volt-500/10 text-volt-400'
                              : 'border-ink-800 bg-ink-950 text-ink-400'
                          }`}
                        >
                          <span className="text-base leading-none">{f.icon}</span>
                          <span className="flex items-center gap-1">
                            {f.short}
                            {filled && <span className="w-1 h-1 rounded-full bg-emerald-400 inline-block" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Gros champ pour la discipline active uniquement. */}
                  {TRI_TIME_FIELDS.map((f) => {
                    if (f.key !== activeTriField) return null;
                    return (
                      <div key={f.key} className="bg-ink-950 border border-ink-800 rounded-xl p-4 text-center space-y-1.5">
                        <span className={`text-xs font-bold uppercase font-mono ${f.color}`}>{f.icon} {f.label}</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          autoFocus
                          placeholder={f.placeholder}
                          value={formData.triathlonTimes[f.key]}
                          onChange={(e) => updateTriField(f.key, e.target.value)}
                          className="w-full bg-transparent text-center text-2xl font-mono font-bold text-ink-50 placeholder-ink-700 focus:outline-none min-h-tap"
                        />
                        {f.hasAllure && (
                          <span className="text-xs text-ink-500 block">{getDisciplineAllure(f.key)}</span>
                        )}
                      </div>
                    );
                  })}

                  {/* Récap compact de toutes les disciplines — garde le contexte visible
                      sans avoir à re-parcourir chaque onglet, et sert de raccourci pour y
                      sauter directement. */}
                  <div className="grid grid-cols-5 gap-1 font-mono">
                    {TRI_TIME_FIELDS.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setActiveTriField(f.key)}
                        className="text-center py-1 rounded-lg text-[9px] text-ink-500 hover:text-ink-300"
                      >
                        {formData.triathlonTimes[f.key] || '—'}
                      </button>
                    ))}
                  </div>

                  <div className="text-sm text-ink-400 text-center">Temps global calculé : <strong className="text-volt-400 font-mono">{formData.triathlonTimes.total || '—'}</strong></div>
                </div>
              ) : (
                <div>
                  <label className="text-sm text-ink-300 block mb-1.5">Chrono cible visé</label>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm text-ink-300 block mb-1.5">
                        Allure : <strong className="text-volt-400 font-mono">{formData.runningPace.toFixed(2)} min/km</strong>
                      </label>
                      <input
                        type="range" min="2.5" max="9" step="0.05"
                        value={formData.runningPace}
                        onChange={(e) => {
                          const pace = Number(e.target.value);
                          setFormData({ ...formData, runningPace: pace, targetTime: minutesToHHMM(pace * runningDistanceKm) });
                        }}
                        className="w-full accent-volt-500"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-ink-300 block mb-1.5">
                        Temps estimé : <strong className="text-volt-400 font-mono">{minutesToHHMM(runningTotalMinutes)}</strong>
                      </label>
                      <input
                        type="range"
                        min={Math.max(1, Math.round(3 * runningDistanceKm))}
                        max={Math.max(2, Math.round(8 * runningDistanceKm))}
                        step="1"
                        value={Math.round(runningTotalMinutes)}
                        onChange={(e) => onRunningTotalChange(Number(e.target.value))}
                        className="w-full accent-volt-500"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 4 : Données physio & performances (facultatif) */}
          {step === 4 && (
            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wide text-volt-400">4. Niveau &amp; données physio (facultatif)</h3>
              <p className="text-[11px] text-ink-500 leading-relaxed">
                Ces informations sont facultatives, mais plus tu en donnes, plus le plan généré sera précis et
                adapté à ton niveau réel (au lieu de valeurs moyennes génériques). Tu peux tout laisser vide.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-ink-300 block mb-1.5">Âge (optionnel)</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={formData.age}
                    onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                    placeholder="ex: 28"
                    className="w-full bg-ink-950 border border-ink-800 rounded-xl p-3 text-base text-ink-50 placeholder-ink-600 min-h-tap"
                  />
                </div>
              </div>

              <div className="bg-ink-950 border border-ink-800 rounded-xl p-3 space-y-2">
                <span className="text-[10px] text-ink-500 uppercase block font-mono">
                  🏁 Dernière performance CONNUE — ton niveau ACTUEL (5km, 10km, semi, marathon, trail, triathlon...)
                </span>
                <p className="text-[10px] text-ink-500 leading-relaxed">
                  Pas ton objectif (déjà saisi à l'étape 3) : ton dernier chrono réel, pour que le coach sache d'où tu pars
                  et calcule une vraie progression vers ta cible plutôt que de deviner ton niveau.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={formData.recentResult.distanceKm}
                    onChange={(e) => setFormData({ ...formData, recentResult: { ...formData.recentResult, distanceKm: e.target.value } })}
                    placeholder="Distance (km)"
                    className="w-full bg-ink-900 border border-ink-800 rounded-xl p-3 text-base text-ink-50 placeholder-ink-600 min-h-tap"
                  />
                  <input
                    type="text"
                    value={formData.recentResult.time}
                    onChange={(e) => setFormData({ ...formData, recentResult: { ...formData.recentResult, time: e.target.value } })}
                    placeholder="Chrono (hh:mm:ss)"
                    className="w-full bg-ink-900 border border-ink-800 rounded-xl p-3 text-base text-ink-50 placeholder-ink-600 min-h-tap"
                  />
                  <input
                    type="text"
                    value={formData.recentResult.context}
                    onChange={(e) => setFormData({ ...formData, recentResult: { ...formData.recentResult, context: e.target.value } })}
                    placeholder="Contexte (ex: trail 1200m D+)"
                    className="w-full bg-ink-900 border border-ink-800 rounded-xl p-3 text-base text-ink-50 placeholder-ink-600 min-h-tap"
                  />
                </div>
              </div>

              <div className="bg-ink-950 border border-ink-800 rounded-xl p-3 space-y-2">
                <span className="text-[10px] text-ink-500 uppercase block font-mono">📊 Valeurs déjà mesurées (si tu les connais)</span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-ink-400 block mb-1">VMA (km/h)</label>
                    <input
                      type="number" step="0.1" inputMode="decimal"
                      value={formData.knownPhysio.vma}
                      onChange={(e) => setFormData({ ...formData, knownPhysio: { ...formData.knownPhysio, vma: e.target.value } })}
                      placeholder="ex: 15.5"
                      className="w-full bg-ink-900 border border-ink-800 rounded-xl p-3 text-base text-ink-50 placeholder-ink-600 min-h-tap"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-ink-400 block mb-1">FC max (bpm)</label>
                    <input
                      type="number" inputMode="numeric"
                      value={formData.knownPhysio.fcMax}
                      onChange={(e) => setFormData({ ...formData, knownPhysio: { ...formData.knownPhysio, fcMax: e.target.value } })}
                      placeholder="ex: 188"
                      className="w-full bg-ink-900 border border-ink-800 rounded-xl p-3 text-base text-ink-50 placeholder-ink-600 min-h-tap"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-ink-400 block mb-1">FC repos (bpm)</label>
                    <input
                      type="number" inputMode="numeric"
                      value={formData.knownPhysio.fcRepos}
                      onChange={(e) => setFormData({ ...formData, knownPhysio: { ...formData.knownPhysio, fcRepos: e.target.value } })}
                      placeholder="ex: 52"
                      className="w-full bg-ink-900 border border-ink-800 rounded-xl p-3 text-base text-ink-50 placeholder-ink-600 min-h-tap"
                    />
                  </div>
                  {formData.sportType === 'triathlon' && (
                    <>
                      <div>
                        <label className="text-xs text-ink-400 block mb-1">FTP vélo (W)</label>
                        <input
                          type="number" inputMode="decimal"
                          value={formData.knownPhysio.ftp}
                          onChange={(e) => setFormData({ ...formData, knownPhysio: { ...formData.knownPhysio, ftp: e.target.value } })}
                          placeholder="ex: 230"
                          className="w-full bg-ink-900 border border-ink-800 rounded-xl p-3 text-base text-ink-50 placeholder-ink-600 min-h-tap"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-ink-400 block mb-1">Allure CSS nat. (/100m)</label>
                        <input
                          type="text"
                          value={formData.knownPhysio.css}
                          onChange={(e) => setFormData({ ...formData, knownPhysio: { ...formData.knownPhysio, css: e.target.value } })}
                          placeholder="ex: 1:45"
                          className="w-full bg-ink-900 border border-ink-800 rounded-xl p-3 text-base text-ink-50 placeholder-ink-600 min-h-tap"
                        />
                      </div>
                    </>
                  )}
                </div>
                <p className="text-[9px] text-ink-600 leading-relaxed">
                  Rien de connu ? Pas de souci — on estimera la VMA à partir de ton chrono récent si tu l'as renseigné
                  ci-dessus. Sans chrono ni valeur mesurée, on n'invente aucun chiffre : le coach utilise des repères
                  ressenti (RPE) à la place, et affinera dès que tu auras une donnée réelle (voir l'onglet Profil).
                </p>
              </div>

              {formData.sportType === 'triathlon' && !formData.knownPhysio.ftp && (
                <div className="bg-ink-950 border border-ink-800 rounded-xl p-3 space-y-2">
                  <span className="text-[10px] text-ink-500 uppercase block font-mono">🚴 Test FTP à venir — quel équipement ?</span>
                  <p className="text-[9px] text-ink-600 leading-relaxed">
                    Ta FTP n'est pas renseignée : le coach va placer un test terrain de 20min dans ton premier plan pour
                    mesurer ton niveau vélo ACTUEL. Dis-nous sur quoi tu vas le faire pour qu'il te propose le bon protocole.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {[
                      { value: 'home_trainer', label: 'Home trainer\n(avec puissance)' },
                      { value: 'route', label: 'Route\n(avec capteur)' },
                      { value: 'route_no_power', label: 'Route\n(sans capteur)' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setFormData({ ...formData, bikeTestEquipment: opt.value === 'route_no_power' ? 'route' : opt.value })}
                        className={`p-3 rounded-xl text-xs font-bold whitespace-pre-line leading-tight border transition-colors min-h-tap ${
                          (formData.bikeTestEquipment === opt.value) || (opt.value === 'route_no_power' && formData.bikeTestEquipment === 'route')
                            ? 'bg-volt-500 border-volt-500 text-white'
                            : 'bg-ink-900 border-ink-800 text-ink-400'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[9px] text-ink-600 leading-relaxed">
                    Sans capteur de puissance : pas de watts inventés — le test donnera une vitesse et une FC seuil comme
                    repères de niveau vélo, réutilisables pour caler tes allures/zones cardio en attendant un capteur.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* STEP 5 : Date & disponibilités */}
          {step === 5 && (
            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase tracking-wide text-volt-400">5. Date & disponibilités</h3>

              <div>
                <label className="text-sm text-ink-300 block mb-1.5">Date de l'objectif</label>
                <div className="relative">
                  <input
                    type="date"
                    value={formData.targetDate}
                    onChange={(e) => setFormData({ ...formData, targetDate: e.target.value })}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="w-full bg-ink-950 border border-ink-800 rounded-xl p-3 text-base text-ink-50 font-mono pointer-events-none flex justify-between items-center min-h-tap">
                    <span>{formData.targetDate ? formatDateFR(formData.targetDate) : 'Choisir une date'}</span>
                    <span className="text-ink-500">📅</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-sm text-ink-300 block mb-1.5">Volume horaire hebdo disponible : <strong className="text-volt-400 font-mono">{formData.hoursPerWeek} h</strong></label>
                {/* Stepper +/- de part et d'autre du slider — plus rapide et plus précis au
                    pouce qu'un slider seul pour un petit ajustement de 0.5h. */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, hoursPerWeek: Math.max(2, Number(formData.hoursPerWeek) - 0.5) })}
                    className="shrink-0 w-11 h-11 rounded-xl border border-ink-800 bg-ink-950 text-volt-400 text-lg font-bold flex items-center justify-center active:bg-ink-800"
                    aria-label="Diminuer le volume horaire"
                  >
                    −
                  </button>
                  <input type="range" min="2" max="30" step="0.5" value={formData.hoursPerWeek} onChange={(e) => setFormData({ ...formData, hoursPerWeek: Number(e.target.value) })} className="w-full accent-volt-500 cursor-pointer" />
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, hoursPerWeek: Math.min(30, Number(formData.hoursPerWeek) + 0.5) })}
                    className="shrink-0 w-11 h-11 rounded-xl border border-ink-800 bg-ink-950 text-volt-400 text-lg font-bold flex items-center justify-center active:bg-ink-800"
                    aria-label="Augmenter le volume horaire"
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <label className="text-sm text-ink-300 block mb-1.5">Nombre de séances par semaine : <strong className="text-volt-400 font-mono">{formData.maxSessionsPerWeek} séances</strong></label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, maxSessionsPerWeek: Math.max(2, Number(formData.maxSessionsPerWeek) - 1) })}
                    className="shrink-0 w-11 h-11 rounded-xl border border-ink-800 bg-ink-950 text-volt-400 text-lg font-bold flex items-center justify-center active:bg-ink-800"
                    aria-label="Diminuer le nombre de séances"
                  >
                    −
                  </button>
                  <input type="range" min="2" max="14" step="1" value={formData.maxSessionsPerWeek} onChange={(e) => setFormData({ ...formData, maxSessionsPerWeek: Number(e.target.value) })} className="w-full accent-volt-500 cursor-pointer" />
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, maxSessionsPerWeek: Math.min(14, Number(formData.maxSessionsPerWeek) + 1) })}
                    className="shrink-0 w-11 h-11 rounded-xl border border-ink-800 bg-ink-950 text-volt-400 text-lg font-bold flex items-center justify-center active:bg-ink-800"
                    aria-label="Augmenter le nombre de séances"
                  >
                    +
                  </button>
                </div>
                {Number(formData.maxSessionsPerWeek) > 7 && (
                  <p className="text-xs text-volt-400 mt-1">⚡ Plus de 7 séances/semaine implique des jours "doubles" (2 séances le même jour, ex : brick).</p>
                )}
              </div>

              <div>
                <label className="text-sm text-ink-300 block mb-1.5">Jour(s) de repos obligatoire</label>
                <select value={formData.offDays} onChange={(e) => setFormData({ ...formData, offDays: e.target.value })} className="w-full bg-ink-950 border border-ink-800 rounded-xl p-3 text-base text-ink-50 min-h-tap">
                  {['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <p className="text-[10px] text-ink-500 mt-1.5">
                  Avec {formData.maxSessionsPerWeek} séance(s)/semaine, le plan comptera <strong className="text-volt-400">{Math.max(0, 7 - Number(formData.maxSessionsPerWeek))} jour(s) de repos</strong>
                  {Number(formData.maxSessionsPerWeek) > 7 && <> (avec {Number(formData.maxSessionsPerWeek) - 7} jour(s) double(s))</>} sur la semaine (dont le {formData.offDays}, obligatoire).
                </p>
              </div>

              {coherenceWarnings.length > 0 && (
                <div className={`p-3 rounded-xl text-xs space-y-1.5 border ${
                  hasBlockingWarning
                    ? 'bg-rose-950/50 border-rose-800/80 text-rose-300'
                    : 'bg-amber-950/40 border-amber-800/60 text-amber-300'
                }`}>
                  <span className="font-bold block font-mono">{hasBlockingWarning ? '⚠️ Alerte de cohérence :' : '💡 Conseil du coach :'}</span>
                  {coherenceWarnings.map((w, i) => (
                    <p key={i} className="leading-relaxed">{w}</p>
                  ))}
                  {hasBlockingWarning && (
                    <p className="leading-relaxed font-bold">Ajuste le volume horaire ou le nombre de séances pour continuer — cette combinaison n'est pas réalisable.</p>
                  )}
                  {!hasBlockingWarning && (
                    <p className="leading-relaxed text-amber-400/80">Ce sont des repères de préparation, pas des règles strictes — tu peux continuer tel quel si tu le souhaites.</p>
                  )}
                </div>
              )}

              {submitError && (
                <div className="bg-rose-950/50 border border-rose-800/80 p-3 rounded-xl text-xs text-rose-300">{submitError}</div>
              )}
            </div>
          )}

        </div>

        <div className="flex justify-between items-center border-t border-ink-800 pt-4">
          {step > 1 ? (
            <button type="button" onClick={handlePrev} disabled={submitting} className="px-4 py-2 rounded-xl border border-ink-800 text-xs text-ink-400 hover:text-ink-50">Retour</button>
          ) : (
            <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 rounded-xl border border-ink-800 text-xs text-ink-400 hover:text-ink-50">Annuler</button>
          )}

          {step < 5 ? (
            <button type="button" onClick={handleNext} disabled={!stepIsValid()} className="px-5 py-2 rounded-xl bg-volt-500 text-ink-50 font-bold text-xs hover:bg-volt-400">Suivant</button>
          ) : (
            <button type="button" onClick={() => onComplete && onComplete(formData)} disabled={submitting || !stepIsValid()} className="px-5 py-2 rounded-xl bg-volt-500 text-ink-50 font-bold text-xs hover:bg-volt-400">{submitting ? 'Génération en cours…' : 'Générer mon plan'}</button>
          )}
        </div>

      </div>
    </div>
  );
}
