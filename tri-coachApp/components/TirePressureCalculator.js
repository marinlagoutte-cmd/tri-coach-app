import React, { useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '../lib/storage';
import {
  computeTirePressure,
  SURFACE_OPTIONS,
  TIRE_TYPE_OPTIONS,
  WEATHER_OPTIONS,
  CARCASS_OPTIONS,
  LOAD_DISTRIBUTION_OPTIONS,
  PRIORITY_OPTIONS,
  HOOKLESS_MAX_BAR,
} from '../lib/tirePressure';

const DEFAULT_INPUTS = {
  systemWeightKg: 75,
  tireWidthMm: 28,
  surface: 'smooth',
  tireType: 'tubeless',
  weather: 'dry',
  rimInternalWidthMm: 21,
  carcass: 'standard',
  priority: 'balanced',
  loadDistribution: 'neutral',
  knownMaxBar: '',
  hookless: false,
};

function Slider({ label, value, unit, min, max, step, onChange }) {
  return (
    <div>
      <label className="text-xs text-ink-400 block mb-1">
        {label} : <strong className="text-volt-400 font-mono">{value} {unit}</strong>
      </label>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-volt-500 cursor-pointer"
      />
    </div>
  );
}

function Select({ label, value, onChange, options, renderLabel }) {
  return (
    <div>
      <label className="text-xs text-ink-400 block mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-ink-950 border border-ink-800 rounded-xl p-2.5 text-xs text-ink-50"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{renderLabel(opt)}</option>
        ))}
      </select>
    </div>
  );
}

function ResultCard({ label, result, range }) {
  return (
    <div className="bg-ink-950 border border-ink-800 rounded-xl p-3 flex-1 min-w-0">
      <div className="text-[10px] font-mono text-ink-500 uppercase tracking-widest mb-1">{label}</div>
      <div className="text-2xl font-bold text-volt-400 font-mono leading-none">{result.bar.toFixed(2)}<span className="text-sm text-ink-400 font-normal"> bar</span></div>
      <div className="text-[11px] text-ink-400 mt-0.5">{result.psi} psi</div>
      <div className="text-[10px] text-ink-500 mt-2">
        {range.comfort.bar.toFixed(1)} – {range.performance.bar.toFixed(1)} bar
      </div>
    </div>
  );
}

export default function TirePressureCalculator() {
  const { t } = useI18n();
  const [inputs, setInputs] = useState(() => loadFromStorage(STORAGE_KEYS.tirePressureInputs, DEFAULT_INPUTS));
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const update = (patch) => {
    setInputs((prev) => {
      const next = { ...prev, ...patch };
      saveToStorage(STORAGE_KEYS.tirePressureInputs, next);
      return next;
    });
  };

  const knownMaxBar = inputs.knownMaxBar === '' || inputs.knownMaxBar === null ? null : Number(inputs.knownMaxBar);

  const result = useMemo(() => computeTirePressure({
    systemWeightKg: inputs.systemWeightKg,
    tireWidthMm: inputs.tireWidthMm,
    surface: inputs.surface,
    tireType: inputs.tireType,
    weather: inputs.weather,
    carcass: inputs.carcass,
    priority: inputs.priority,
    loadDistribution: inputs.loadDistribution,
    hookless: inputs.hookless,
    knownMaxBar,
  }), [inputs, knownMaxBar]);

  // Cohérence largeur pneu / largeur interne de jante — purement informatif, n'influence
  // jamais le calcul (la largeur MESURÉE saisie ci-dessus reflète déjà l'effet de la jante).
  const rimMismatch = inputs.rimInternalWidthMm && (inputs.tireWidthMm - inputs.rimInternalWidthMm < 6 || inputs.tireWidthMm - inputs.rimInternalWidthMm > 22);

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-4 text-ink-100">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-volt-400 uppercase tracking-widest block">{t('tirePressure.title')}</span>
        <span className="text-[9px] text-ink-500">{t('tirePressure.methodTag')}</span>
      </div>

      <Slider
        label={t('tirePressure.systemWeight')} unit="kg" min={40} max={160} step={0.5}
        value={inputs.systemWeightKg} onChange={(v) => update({ systemWeightKg: v })}
      />
      <p className="text-[10px] text-ink-500 -mt-2">{t('tirePressure.systemWeightHint')}</p>

      <Slider
        label={t('tirePressure.tireWidth')} unit="mm" min={18} max={60} step={1}
        value={inputs.tireWidthMm} onChange={(v) => update({ tireWidthMm: v })}
      />
      <p className="text-[10px] text-ink-500 -mt-2">{t('tirePressure.tireWidthHint')}</p>

      <div className="grid grid-cols-3 gap-2">
        <Select
          label={t('tirePressure.surface')} value={inputs.surface} onChange={(v) => update({ surface: v })}
          options={SURFACE_OPTIONS} renderLabel={(o) => t(`tirePressure.surface_${o}`)}
        />
        <Select
          label={t('tirePressure.tireType')} value={inputs.tireType} onChange={(v) => update({ tireType: v })}
          options={TIRE_TYPE_OPTIONS} renderLabel={(o) => t(`tirePressure.tireType_${o}`)}
        />
        <Select
          label={t('tirePressure.weather')} value={inputs.weather} onChange={(v) => update({ weather: v })}
          options={WEATHER_OPTIONS} renderLabel={(o) => t(`tirePressure.weather_${o}`)}
        />
      </div>

      <div className="border border-ink-800 rounded-xl p-3 space-y-3">
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className="w-full flex items-center justify-between text-left"
        >
          <span>
            <span className="text-sm font-bold text-ink-100">{t('tirePressure.advanced')}</span>
            <span className="text-[10px] text-ink-500 block">{t('tirePressure.advancedHint')}</span>
          </span>
          <span className="w-6 h-6 rounded-full bg-ink-800 text-ink-200 flex items-center justify-center text-sm shrink-0">
            {advancedOpen ? '−' : '+'}
          </span>
        </button>

        {advancedOpen && (
          <div className="space-y-3 pt-1">
            <Slider
              label={t('tirePressure.rimWidth')} unit="mm" min={13} max={35} step={1}
              value={inputs.rimInternalWidthMm} onChange={(v) => update({ rimInternalWidthMm: v })}
            />
            {rimMismatch && (
              <p className="text-[10px] text-amber-400">⚠️ {t('tirePressure.rimMismatch')}</p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Select
                label={t('tirePressure.carcass')} value={inputs.carcass} onChange={(v) => update({ carcass: v })}
                options={CARCASS_OPTIONS} renderLabel={(o) => t(`tirePressure.carcass_${o}`)}
              />
              <Select
                label={t('tirePressure.priority')} value={inputs.priority} onChange={(v) => update({ priority: v })}
                options={PRIORITY_OPTIONS} renderLabel={(o) => t(`tirePressure.priority_${o}`)}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Select
                label={t('tirePressure.loadDistribution')} value={inputs.loadDistribution} onChange={(v) => update({ loadDistribution: v })}
                options={LOAD_DISTRIBUTION_OPTIONS} renderLabel={(o) => t(`tirePressure.loadDistribution_${o}`)}
              />
              <div>
                <label className="text-xs text-ink-400 block mb-1">{t('tirePressure.knownMax')}</label>
                <div className="relative">
                  <input
                    type="number" step="0.1" min="0" placeholder={t('tirePressure.optional')}
                    value={inputs.knownMaxBar}
                    onChange={(e) => update({ knownMaxBar: e.target.value })}
                    className="w-full bg-ink-950 border border-ink-800 rounded-xl p-2.5 pr-9 text-xs text-ink-50"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-ink-500">bar</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <div>
            <span className="text-sm font-bold text-ink-100 block">{t('tirePressure.hookless')}</span>
            <span className="text-[10px] text-ink-500">{t('tirePressure.hooklessHint')}</span>
          </div>
          <button
            onClick={() => update({ hookless: !inputs.hookless })}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${inputs.hookless ? 'bg-volt-500' : 'bg-ink-700'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${inputs.hookless ? 'translate-x-5' : ''}`} />
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex gap-2">
          <ResultCard label={t('tirePressure.front')} result={result.front} range={result.range.front} />
          <ResultCard label={t('tirePressure.rear')} result={result.rear} range={result.range.rear} />
        </div>
        <p className="text-[10px] text-ink-500 text-center">{t('tirePressure.rangeHint')}</p>

        {result.warnings.includes('hookless') && (
          <p className="text-[11px] text-amber-400 bg-amber-950/30 border border-amber-800/60 rounded-xl p-2.5">
            ⚠️ {t('tirePressure.warnHookless', { max: HOOKLESS_MAX_BAR })}
          </p>
        )}
        {result.warnings.includes('knownMax') && (
          <p className="text-[11px] text-amber-400 bg-amber-950/30 border border-amber-800/60 rounded-xl p-2.5">
            ⚠️ {t('tirePressure.warnKnownMax')}
          </p>
        )}
        {result.warnings.includes('floor') && (
          <p className="text-[11px] text-amber-400 bg-amber-950/30 border border-amber-800/60 rounded-xl p-2.5">
            ⚠️ {t('tirePressure.warnFloor')}
          </p>
        )}
        {result.warnings.includes('ceiling') && (
          <p className="text-[11px] text-amber-400 bg-amber-950/30 border border-amber-800/60 rounded-xl p-2.5">
            ⚠️ {t('tirePressure.warnCeiling')}
          </p>
        )}
      </div>

      <p className="text-[10px] text-ink-500 leading-relaxed border-t border-ink-800 pt-3">{t('tirePressure.disclaimer')}</p>
    </div>
  );
}
