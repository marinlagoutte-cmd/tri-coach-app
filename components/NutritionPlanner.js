import React, { useEffect, useMemo, useState } from 'react';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '../lib/storage';
import {
  PRODUCT_LIBRARY,
  HEAT_LABELS,
  TIER_LABELS,
  deriveRaceProfile,
  buildDefaultPlan,
  getSortedMarkers,
  getSegments,
  computeTotals,
  rangeStatus,
  getCarbRange,
  getFluidRange,
  getSodiumRange,
  getPotassiumRange,
  makeUid,
} from '../lib/nutritionData';

function groupByCategory(list) {
  return list.reduce((acc, item) => {
    (acc[item.category] = acc[item.category] || []).push(item);
    return acc;
  }, {});
}
const GROUPED_LIBRARY = groupByCategory(PRODUCT_LIBRARY);

const STATUS_STYLE = {
  low: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  ok: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  high: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
  neutral: 'text-ink-400 border-ink-800 bg-ink-950',
};
const STATUS_LABEL = { low: 'Un peu faible', ok: 'Dans la cible', high: 'Élevé', neutral: '—' };

function ItemAdder({ onAdd }) {
  const [itemId, setItemId] = useState(PRODUCT_LIBRARY[0].id);
  const [qty, setQty] = useState(1);
  const [custom, setCustom] = useState({ name: '', carbs: 0, sodium: 0, potassium: 0, caffeine: 0, fluid: 0 });

  const selected = PRODUCT_LIBRARY.find((p) => p.id === itemId);
  const isCustom = !!selected?.isCustom;

  const handleAdd = () => {
    const base = isCustom
      ? {
          name: custom.name.trim() || 'Aliment personnalisé',
          carbs: Number(custom.carbs) || 0,
          sodium: Number(custom.sodium) || 0,
          potassium: Number(custom.potassium) || 0,
          caffeine: Number(custom.caffeine) || 0,
          fluid: Number(custom.fluid) || 0,
        }
      : {
          name: selected.name,
          carbs: selected.carbs,
          sodium: selected.sodium,
          potassium: selected.potassium,
          caffeine: selected.caffeine,
          fluid: selected.fluid,
        };
    onAdd({ uid: makeUid(), itemId, qty: Number(qty) || 1, ...base });
    setQty(1);
    if (isCustom) setCustom({ name: '', carbs: 0, sodium: 0, potassium: 0, caffeine: 0, fluid: 0 });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <select
          value={itemId}
          onChange={(e) => setItemId(e.target.value)}
          className="flex-1 min-w-0 bg-ink-950 border border-ink-800 rounded-lg px-2 py-1.5 text-[11px] text-ink-50"
        >
          {Object.entries(GROUPED_LIBRARY).map(([cat, items]) => (
            <optgroup key={cat} label={cat}>
              {items.map((it) => (
                <option key={it.id} value={it.id}>{it.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <input
          type="number" min="0.5" step="0.5" value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-14 shrink-0 bg-ink-950 border border-ink-800 rounded-lg px-1.5 py-1.5 text-[11px] text-ink-50 text-center"
        />
        <button type="button" onClick={handleAdd} className="shrink-0 px-2.5 py-1.5 rounded-lg bg-volt-500/15 border border-volt-500/40 text-volt-300 text-[11px] font-bold">
          + Ajouter
        </button>
      </div>
      {isCustom && (
        <div className="grid grid-cols-3 gap-1 bg-ink-950/60 border border-ink-800 rounded-lg p-1.5">
          <input
            placeholder="Nom de l'aliment" value={custom.name}
            onChange={(e) => setCustom({ ...custom, name: e.target.value })}
            className="col-span-3 bg-ink-900 border border-ink-800 rounded-lg px-2 py-1 text-[10px] text-ink-50 placeholder-ink-600"
          />
          <input
            placeholder="Glucides (g)" type="number" value={custom.carbs}
            onChange={(e) => setCustom({ ...custom, carbs: e.target.value })}
            className="bg-ink-900 border border-ink-800 rounded-lg px-1.5 py-1 text-[10px] text-ink-50 placeholder-ink-600"
          />
          <input
            placeholder="Sodium (mg)" type="number" value={custom.sodium}
            onChange={(e) => setCustom({ ...custom, sodium: e.target.value })}
            className="bg-ink-900 border border-ink-800 rounded-lg px-1.5 py-1 text-[10px] text-ink-50 placeholder-ink-600"
          />
          <input
            placeholder="Potassium (mg)" type="number" value={custom.potassium}
            onChange={(e) => setCustom({ ...custom, potassium: e.target.value })}
            className="bg-ink-900 border border-ink-800 rounded-lg px-1.5 py-1 text-[10px] text-ink-50 placeholder-ink-600"
          />
        </div>
      )}
    </div>
  );
}

function ItemList({ items, onRemove }) {
  if (!items || items.length === 0) return <p className="text-[10px] text-ink-600 italic">Rien pour l'instant.</p>;
  return (
    <div className="space-y-1">
      {items.map((it) => (
        <div key={it.uid} className="flex items-center justify-between gap-2 bg-ink-950 border border-ink-800 rounded-lg px-2 py-1">
          <span className="text-[10px] text-ink-200 leading-snug">
            {it.qty}× {it.name}{' '}
            <span className="text-ink-500">
              ({Math.round(it.carbs * it.qty)}g glu{it.sodium ? `, ${Math.round(it.sodium * it.qty)}mg Na` : ''}{it.caffeine ? `, ${Math.round(it.caffeine * it.qty)}mg caf.` : ''})
            </span>
          </span>
          <button type="button" onClick={() => onRemove(it.uid)} className="shrink-0 text-ink-600 hover:text-rose-400 text-[11px] px-1">✕</button>
        </div>
      ))}
    </div>
  );
}

function MarkerCard({ marker, unit, onUpdate, onRemove, onAddRestock, onRemoveRestock }) {
  return (
    <div className={`rounded-xl p-3 border ${marker.fixed ? 'bg-ink-950/60 border-ink-800' : 'bg-volt-500/5 border-volt-500/30'}`}>
      <div className="flex items-center gap-2">
        <span className="shrink-0 w-6 h-6 rounded-full bg-ink-900 border border-ink-700 flex items-center justify-center text-[11px]">
          {marker.id === 'start' ? '🚩' : marker.id === 'finish' ? '🏁' : '🥤'}
        </span>
        {marker.fixed ? (
          <span className="text-xs font-bold text-ink-50 flex-1">{marker.name}</span>
        ) : (
          <input
            value={marker.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            className="flex-1 min-w-0 bg-ink-950 border border-ink-800 rounded-lg px-2 py-1 text-xs text-ink-50"
          />
        )}
        {!marker.fixed && (
          <>
            <input
              type="number" min="0" step={unit === 'km' ? '0.5' : '1'} value={marker.position}
              onChange={(e) => onUpdate({ position: Number(e.target.value) || 0 })}
              className="w-16 shrink-0 bg-ink-950 border border-ink-800 rounded-lg px-1.5 py-1 text-[11px] text-ink-50 text-center font-mono"
            />
            <span className="text-[10px] text-ink-500 shrink-0">{unit}</span>
            <button type="button" onClick={onRemove} className="shrink-0 text-ink-600 hover:text-rose-400 text-xs px-1">✕</button>
          </>
        )}
        {marker.fixed && (
          <span className="text-[11px] text-ink-500 font-mono shrink-0">{marker.position}{unit}</span>
        )}
      </div>
      {marker.id !== 'start' && (
        <div className="mt-2 pl-8 space-y-1.5">
          <span className="text-[9px] text-ink-500 uppercase tracking-wide">Pris / rechargé ici</span>
          <ItemList items={marker.restock} onRemove={onRemoveRestock} />
          <ItemAdder onAdd={onAddRestock} />
        </div>
      )}
    </div>
  );
}

function SegmentCard({ segment, unit }) {
  const label = unit === 'km'
    ? `${segment.from.position} → ${segment.to.position} km (${segment.span.toFixed(1)} km, ~${Math.round(segment.durationMin)} min)`
    : `${segment.from.position} → ${segment.to.position} min`;
  return (
    <div className="ml-3 pl-3 border-l-2 border-dashed border-ink-800 py-1">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-ink-500 font-mono">{label}</span>
        {segment.carbsPerHour > 0 && (
          <span className="text-[9px] text-volt-400 font-mono">{Math.round(segment.carbsPerHour)}g glu/h sur ce tronçon</span>
        )}
      </div>
    </div>
  );
}

function MetricTile({ label, value, unit, range, rangeUnit }) {
  const status = rangeStatus(value, range);
  return (
    <div className={`rounded-xl p-2.5 border ${STATUS_STYLE[status]}`}>
      <span className="text-[9px] uppercase tracking-wide block opacity-80">{label}</span>
      <span className="text-base font-black font-mono block">{Math.round(value)}{unit}</span>
      {range && (
        <span className="text-[9px] block opacity-80">
          Cible : {range.min}-{range.max}{rangeUnit} · {STATUS_LABEL[status]}
        </span>
      )}
    </div>
  );
}

export default function NutritionPlanner({ profile, sportType, constraints, trainingPlan, onSummaryChange }) {
  const raceProfile = useMemo(
    () => deriveRaceProfile({ constraints, trainingPlan, sportType }),
    [constraints, trainingPlan, sportType]
  );

  const [plan, setPlan] = useState(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = loadFromStorage(STORAGE_KEYS.nutritionPlan, null);
    setPlan(saved || buildDefaultPlan(raceProfile));
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hydrated && plan) saveToStorage(STORAGE_KEYS.nutritionPlan, plan);
  }, [plan, hydrated]);

  const totals = useMemo(() => (plan ? computeTotals(plan) : null), [plan]);
  const segments = useMemo(() => (plan ? getSegments(plan) : []), [plan]);
  const sortedMarkers = useMemo(() => (plan ? getSortedMarkers(plan) : []), [plan]);

  useEffect(() => {
    if (!totals || !plan || !onSummaryChange) return;
    const stationCount = Math.max(0, plan.markers.length - 2);
    onSummaryChange(
      `Stratégie nutrition course déjà construite par l'athlète : ~${Math.round(totals.carbsPerHour)}g de glucides/h, ~${Math.round(totals.fluidPerHour)}ml/h de liquide, ~${Math.round(totals.sodiumPerHour)}mg de sodium/h, répartis sur ${stationCount} ravito(s) positionné(s) sur la course.`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals]);

  if (!plan) return null;

  const unit = plan.mode === 'km' ? 'km' : 'min';
  const carbRange = getCarbRange(raceProfile.tier);
  const fluidRange = getFluidRange(plan.heat);
  const sodiumRange = getSodiumRange(raceProfile.tier, plan.heat);
  const potassiumRange = getPotassiumRange(raceProfile.tier);

  const updateMarker = (id, patch) => setPlan((p) => ({ ...p, markers: p.markers.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));

  const removeMarker = (id) => setPlan((p) => {
    const { [id]: _removed, ...restSegItems } = p.segmentItems || {};
    return { ...p, markers: p.markers.filter((m) => m.id !== id), segmentItems: restSegItems };
  });

  const addMarker = () => setPlan((p) => {
    const sorted = getSortedMarkers(p);
    let bestGap = -1;
    let bestPos = 0;
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const gap = sorted[i + 1].position - sorted[i].position;
      if (gap > bestGap) { bestGap = gap; bestPos = sorted[i].position + gap / 2; }
    }
    const count = sorted.length - 1;
    const newMarker = { id: makeUid(), position: Math.round(bestPos * 10) / 10, name: `Ravito ${count}`, fixed: false, restock: [] };
    return { ...p, markers: [...p.markers, newMarker] };
  });

  const addSegmentItem = (fromId, entry) => setPlan((p) => ({
    ...p,
    segmentItems: { ...p.segmentItems, [fromId]: [...(p.segmentItems?.[fromId] || []), entry] },
  }));
  const removeSegmentItem = (fromId, uidVal) => setPlan((p) => ({
    ...p,
    segmentItems: { ...p.segmentItems, [fromId]: (p.segmentItems?.[fromId] || []).filter((e) => e.uid !== uidVal) },
  }));
  const addRestock = (markerId, entry) => setPlan((p) => ({
    ...p,
    markers: p.markers.map((m) => (m.id === markerId ? { ...m, restock: [...(m.restock || []), entry] } : m)),
  }));
  const removeRestock = (markerId, uidVal) => setPlan((p) => ({
    ...p,
    markers: p.markers.map((m) => (m.id === markerId ? { ...m, restock: (m.restock || []).filter((e) => e.uid !== uidVal) } : m)),
  }));

  const toggleMode = () => setPlan((p) => {
    const oldTotal = p.mode === 'km' ? p.totalDistanceKm : p.totalDurationMin;
    const newMode = p.mode === 'km' ? 'time' : 'km';
    const newTotal = newMode === 'km' ? p.totalDistanceKm : p.totalDurationMin;
    if (!oldTotal || !newTotal) return { ...p, mode: newMode };
    const ratio = newTotal / oldTotal;
    const markers = p.markers.map((m) => ({ ...m, position: Math.round(m.position * ratio * 10) / 10 }));
    const sorted = [...markers].sort((a, b) => a.position - b.position);
    if (sorted.length) sorted[0].position = 0;
    if (sorted.length > 1) sorted[sorted.length - 1].position = newTotal;
    return { ...p, mode: newMode, markers };
  });

  const resync = () => setPlan((p) => {
    const newTotalDistance = raceProfile.distanceKm || p.totalDistanceKm;
    const newTotalDuration = raceProfile.durationMin || p.totalDurationMin;
    const newFinishPos = p.mode === 'km' ? newTotalDistance : newTotalDuration;
    return {
      ...p,
      totalDistanceKm: newTotalDistance,
      totalDurationMin: newTotalDuration,
      markers: p.markers.map((m) => (m.id === 'finish' ? { ...m, position: newFinishPos } : m)),
    };
  });

  const resetPlan = () => setPlan(buildDefaultPlan(raceProfile));

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-black uppercase text-ink-50">🧮 Stratégie nutrition course</h3>
          <p className="text-[10px] text-ink-500 mt-0.5">{TIER_LABELS[raceProfile.tier]} · {raceProfile.label}</p>
        </div>
        <button type="button" onClick={resetPlan} className="text-[9px] font-bold text-ink-500 hover:text-rose-400 border border-ink-800 px-2 py-1 rounded-lg shrink-0">
          Réinitialiser
        </button>
      </div>

      {/* Paramètres de la course */}
      <div className="bg-ink-950 border border-ink-800 rounded-xl p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-ink-500 uppercase font-mono">Ligne de course</span>
          <div className="flex bg-ink-900 border border-ink-800 rounded-lg p-0.5">
            <button type="button" onClick={() => plan.mode !== 'km' && toggleMode()} className={`px-2.5 py-1 rounded-md text-[10px] font-bold ${plan.mode === 'km' ? 'bg-volt-500 text-white' : 'text-ink-400'}`}>Kilomètres</button>
            <button type="button" onClick={() => plan.mode !== 'time' && toggleMode()} className={`px-2.5 py-1 rounded-md text-[10px] font-bold ${plan.mode === 'time' ? 'bg-volt-500 text-white' : 'text-ink-400'}`}>Temps</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[9px] text-ink-500 block mb-1">Distance totale (km)</label>
            <input
              type="number" min="0" step="0.5" value={plan.totalDistanceKm}
              onChange={(e) => setPlan((p) => ({ ...p, totalDistanceKm: Number(e.target.value) || 0, markers: p.mode === 'km' ? p.markers.map((m) => (m.id === 'finish' ? { ...m, position: Number(e.target.value) || 0 } : m)) : p.markers }))}
              className="w-full bg-ink-900 border border-ink-800 rounded-lg px-2 py-1.5 text-xs text-ink-50 font-mono"
            />
          </div>
          <div>
            <label className="text-[9px] text-ink-500 block mb-1">Durée totale estimée (min)</label>
            <input
              type="number" min="0" step="5" value={plan.totalDurationMin}
              onChange={(e) => setPlan((p) => ({ ...p, totalDurationMin: Number(e.target.value) || 0, markers: p.mode === 'time' ? p.markers.map((m) => (m.id === 'finish' ? { ...m, position: Number(e.target.value) || 0 } : m)) : p.markers }))}
              className="w-full bg-ink-900 border border-ink-800 rounded-lg px-2 py-1.5 text-xs text-ink-50 font-mono"
            />
          </div>
        </div>
        <div>
          <label className="text-[9px] text-ink-500 block mb-1">Conditions météo prévues</label>
          <div className="flex gap-1.5">
            {Object.entries(HEAT_LABELS).map(([key, label]) => (
              <button
                key={key} type="button" onClick={() => setPlan((p) => ({ ...p, heat: key }))}
                className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] font-bold border ${plan.heat === key ? 'bg-volt-500/15 border-volt-500 text-volt-300' : 'bg-ink-900 border-ink-800 text-ink-400'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={resync} className="w-full text-[10px] text-volt-400 border border-volt-500/30 bg-volt-500/5 rounded-lg py-1.5 font-bold">
          ↻ Resynchroniser avec mon objectif ({raceProfile.label})
        </button>
      </div>

      {/* Cibles recommandées */}
      <div>
        <span className="text-[10px] text-ink-500 uppercase font-mono block mb-1.5">Repères recommandés pour ce format</span>
        <div className="grid grid-cols-2 gap-2 text-[10px] text-ink-300">
          <div className="bg-ink-950 border border-ink-800 rounded-lg px-2.5 py-1.5">Glucides : <strong className="text-ink-50">{carbRange.min}-{carbRange.max}g/h</strong></div>
          <div className="bg-ink-950 border border-ink-800 rounded-lg px-2.5 py-1.5">Liquide : <strong className="text-ink-50">{fluidRange.min}-{fluidRange.max}ml/h</strong></div>
          <div className="bg-ink-950 border border-ink-800 rounded-lg px-2.5 py-1.5">Sodium : <strong className="text-ink-50">{sodiumRange.min}-{sodiumRange.max}mg/h</strong></div>
          <div className="bg-ink-950 border border-ink-800 rounded-lg px-2.5 py-1.5">Potassium : <strong className="text-ink-50">{potassiumRange.min}-{potassiumRange.max}mg/h</strong></div>
        </div>
        {carbRange.note && <p className="text-[9px] text-ink-600 mt-1 italic">{carbRange.note}</p>}
      </div>

      {/* Timeline ravitos / segments */}
      <div>
        <span className="text-[10px] text-ink-500 uppercase font-mono block mb-1.5">Ravitos & consommation</span>
        <div className="space-y-1.5">
          {sortedMarkers.map((m, idx) => (
            <React.Fragment key={m.id}>
              <MarkerCard
                marker={m}
                unit={unit}
                onUpdate={(patch) => updateMarker(m.id, patch)}
                onRemove={() => removeMarker(m.id)}
                onAddRestock={(entry) => addRestock(m.id, entry)}
                onRemoveRestock={(uidVal) => removeRestock(m.id, uidVal)}
              />
              {idx < segments.length && (
                <div className="pl-1 space-y-1.5">
                  <SegmentCard segment={segments[idx]} unit={unit} />
                  <div className="ml-3 pl-3 border-l-2 border-dashed border-ink-800 space-y-1.5">
                    <span className="text-[9px] text-ink-500 uppercase tracking-wide">Consommé pendant ce tronçon</span>
                    <ItemList items={segments[idx].items} onRemove={(uidVal) => removeSegmentItem(m.id, uidVal)} />
                    <ItemAdder onAdd={(entry) => addSegmentItem(m.id, entry)} />
                  </div>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
        <button type="button" onClick={addMarker} className="w-full mt-2 text-[10px] font-bold text-volt-300 border border-dashed border-volt-500/40 rounded-xl py-2">
          + Ajouter un ravito sur la ligne
        </button>
      </div>

      {/* Totaux */}
      {totals && (
        <div>
          <span className="text-[10px] text-ink-500 uppercase font-mono block mb-1.5">Bilan moyen sur toute la course</span>
          <div className="grid grid-cols-2 gap-2">
            <MetricTile label="Glucides" value={totals.carbsPerHour} unit="g/h" range={carbRange} rangeUnit="g/h" />
            <MetricTile label="Liquide" value={totals.fluidPerHour} unit="ml/h" range={fluidRange} rangeUnit="ml/h" />
            <MetricTile label="Sodium" value={totals.sodiumPerHour} unit="mg/h" range={sodiumRange} rangeUnit="mg/h" />
            <MetricTile label="Potassium" value={totals.potassiumPerHour} unit="mg/h" range={potassiumRange} rangeUnit="mg/h" />
          </div>
          {totals.totalCaffeine > 0 && (
            <p className="text-[10px] text-ink-500 mt-2">
              Caféine totale prévue : <strong className="text-ink-200">{Math.round(totals.totalCaffeine)}mg</strong>
              {totals.totalCaffeine > 400 && <span className="text-amber-400"> — dose élevée, à tester impérativement à l'entraînement.</span>}
            </p>
          )}
          <p className="text-[9px] text-ink-600 mt-2 leading-relaxed">
            Total course : {Math.round(totals.totalCarbs)}g glucides · {Math.round(totals.totalFluid)}ml · {Math.round(totals.totalSodium)}mg sodium.
            {plan.mode === 'km' && ' Le temps par tronçon est estimé à allure constante — ajuste si ton profil de course varie (côtes, ravitos plus longs...).'}
          </p>
        </div>
      )}
    </div>
  );
}
