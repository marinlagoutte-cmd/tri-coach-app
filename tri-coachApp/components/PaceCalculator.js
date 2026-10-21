// components/PaceCalculator.js
//
// OUTIL « ALLURES & CHRONOS » (demande de l'athlète) : prédictions de chronos du 1500 m au
// marathon, allures et FC par zone, temps de passage tous les 100 m jusqu'au 1500 m pour un
// % de VMA donné. Calculs : lib/runCalculator.js. Ce sont des estimations, affichées comme
// telles ; les valeurs de départ viennent du profil de l'athlète (jamais inventées).

import { useMemo, useState } from 'react';
import TimeInput from './TimeInput';
import SectionTitle from './ui/SectionTitle';
import Stat from './ui/Stat';
import { STORAGE_KEYS, loadFromStorage } from '../lib/storage';
import { defaultPaceZones, defaultHrZones, isPlausiblePaceZones, isPlausibleHrZones } from '../lib/zones';
import { RACE_DISTANCES, predictions, splitsTable, formatDuration, paceFromSpeed, vmaFromPerformance } from '../lib/runCalculator';

const REF_DISTANCES = RACE_DISTANCES;

function toSeconds(hms) {
  const parts = String(hms || '').split(':').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const s = parts[0] * 3600 + parts[1] * 60 + parts[2];
  return s > 0 ? s : null;
}

const bare = (kmh) => paceFromSpeed(kmh).replace(' /km', '');
/** Allure d'une zone : Z1 « plus lent que », Z5 « plus rapide que », sinon une plage. */
function zonePace(z, next) {
  if (!z.min) return next ? `plus lent que ${bare(next.min)} /km` : '—';
  if (!next) return `plus rapide que ${bare(z.min)} /km`;
  return `${bare(next.min)}–${bare(z.min)} /km`;
}
function zoneHr(z, next) {
  if (!z.min) return next ? `< ${next.min} bpm` : '—';
  if (!next) return `≥ ${z.min} bpm`;
  return `${z.min}–${next.min - 1} bpm`;
}

export default function PaceCalculator({ profile = {} }) {
  const [vma, setVma] = useState(profile?.vma ? String(profile.vma) : '');
  const [fcMax, setFcMax] = useState(profile?.fcMax ? String(profile.fcMax) : '');
  const [refId, setRefId] = useState('10k');
  const [refTime, setRefTime] = useState('');
  const [pct, setPct] = useState(100);

  const vmaNum = Number(String(vma).replace(',', '.')) || null;
  const refDist = REF_DISTANCES.find((d) => d.id === refId);
  const refSeconds = toSeconds(refTime);
  const vmaFromRef = refSeconds ? vmaFromPerformance(refDist.m, refSeconds) : null;

  const rows = useMemo(
    () => predictions({ vma: vmaNum, refMeters: refSeconds ? refDist.m : null, refSeconds }),
    [vmaNum, refSeconds, refDist]
  );

  // Zones : réglages personnels de l'athlète s'ils existent et sont plausibles, sinon calcul
  // par défaut depuis la VMA / la FC max (mêmes fonctions que le reste de l'app).
  const paceZones = useMemo(() => {
    const custom = loadFromStorage(STORAGE_KEYS.paceZones, null);
    if (isPlausiblePaceZones(custom)) return { zones: custom, custom: true };
    return vmaNum ? { zones: defaultPaceZones(vmaNum), custom: false } : null;
  }, [vmaNum]);
  const hrZones = useMemo(() => {
    const custom = loadFromStorage(STORAGE_KEYS.hrZones, null);
    if (isPlausibleHrZones(custom)) return { zones: custom, custom: true };
    return Number(fcMax) > 0 ? { zones: defaultHrZones(Number(fcMax)), custom: false } : null;
  }, [fcMax]);

  const speed = vmaNum ? (vmaNum * pct) / 100 : null;
  const splits = speed ? splitsTable(speed) : [];

  return (
    <div className="space-y-4">
      {/* Repères */}
      <section className="bg-ink-900 border border-ink-800 rounded-2xl p-3.5 space-y-3" aria-label="Tes repères">
        <SectionTitle>Tes repères</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[12px] text-ink-400">VMA (km/h)</span>
            <input type="number" inputMode="decimal" step="0.1" min="8" max="26" value={vma} onChange={(e) => setVma(e.target.value)} className="mt-1 w-full bg-ink-950 border border-ink-800 rounded-xl p-2.5 text-base text-ink-50 tabular-nums" aria-label="VMA en km/h" />
          </label>
          <label className="block">
            <span className="text-[12px] text-ink-400">FC max (bpm)</span>
            <input type="number" inputMode="numeric" min="120" max="230" value={fcMax} onChange={(e) => setFcMax(e.target.value)} className="mt-1 w-full bg-ink-950 border border-ink-800 rounded-xl p-2.5 text-base text-ink-50 tabular-nums" aria-label="FC max en bpm" />
          </label>
        </div>
        <div>
          <span className="text-[12px] text-ink-400">Perf de référence (facultatif)</span>
          <div className="mt-1 grid grid-cols-[1fr_1fr] gap-3">
            <select value={refId} onChange={(e) => setRefId(e.target.value)} className="bg-ink-950 border border-ink-800 rounded-xl p-2.5 text-base text-ink-50" aria-label="Distance de référence">
              {REF_DISTANCES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            <TimeInput format="hh:mm:ss" value={refTime} onChange={setRefTime} ariaLabel="Chrono de référence (heures:minutes:secondes)" placeholder="00:00:00" className="w-full bg-ink-950 border border-ink-800 rounded-xl p-2.5 text-base text-ink-50 tabular-nums" />
          </div>
          {vmaFromRef && (
            <p className="text-[12px] text-ink-400 mt-1.5">
              Cette perf correspond à une VMA d'environ <span className="font-semibold text-ink-100 tabular-nums">{vmaFromRef} km/h</span>
              {vmaNum && Math.abs(vmaFromRef - vmaNum) >= 0.5 ? ' — différente de la VMA saisie.' : '.'}
              {' '}<button type="button" onClick={() => setVma(String(vmaFromRef))} className="text-volt-500 font-semibold">Utiliser</button>
            </p>
          )}
        </div>
      </section>

      {/* Prédictions */}
      <section className="space-y-1.5" aria-label="Chronos prédits">
        <SectionTitle right={<span className="text-[11px] text-ink-500">estimations</span>}>Chronos prédits</SectionTitle>
        <div className="bg-ink-900 border border-ink-800 rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-2 px-3 py-2 text-[11px] text-ink-500 border-b border-ink-800">
            <span>Distance</span><span>VMA</span><span>{refSeconds ? 'Ta perf' : '—'}</span><span>Allure</span>
          </div>
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-2 px-3 py-2 text-[13px] border-b border-ink-800 last:border-0 tabular-nums">
              <span className="text-ink-200">{r.label}</span>
              <span className="font-semibold text-ink-50">{r.fromVma ? formatDuration(r.fromVma) : '—'}</span>
              <span className="font-semibold text-ink-50">{r.fromRef ? formatDuration(r.fromRef) : '—'}</span>
              <span className="text-ink-400">{r.paceSecPerKm ? `${formatDuration(r.paceSecPerKm)}/km` : '—'}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-ink-500 px-1 leading-snug">
          VMA : % de VMA tenable selon la distance (1500 m ≈ 103 %, 10 km ≈ 89 %, marathon ≈ 75 %). Ta perf : formule de Riegel (exposant 1,06), fiable entre distances voisines, moins entre le 5 km et le marathon.
        </p>
      </section>

      {/* Zones */}
      <section className="space-y-1.5" aria-label="Allures et FC par zone">
        <SectionTitle right={<span className="text-[11px] text-ink-500">{paceZones?.custom || hrZones?.custom ? 'tes zones réglées' : 'zones calculées'}</span>}>Allures et FC par zone</SectionTitle>
        <div className="bg-ink-900 border border-ink-800 rounded-2xl divide-y divide-ink-800">
          {(paceZones?.zones || hrZones?.zones || []).map((z, i) => {
            const p = paceZones?.zones?.[i];
            const pNext = paceZones?.zones?.[i + 1];
            const h = hrZones?.zones?.[i];
            const hNext = hrZones?.zones?.[i + 1];
            return (
              <div key={z.zone} className="px-3 py-2 grid grid-cols-[3.2rem_1fr_1fr] gap-2 items-center text-[13px] tabular-nums">
                <span className="font-semibold text-ink-100">{z.zone}</span>
                <span className="text-ink-200">{p ? zonePace(p, pNext) : '—'}</span>
                <span className="text-ink-400">{h ? zoneHr(h, hNext) : '—'}</span>
              </div>
            );
          })}
          {!paceZones && !hrZones && <p className="px-3 py-3 text-[13px] text-ink-400">Renseigne ta VMA ou ta FC max.</p>}
        </div>
      </section>

      {/* Temps de passage */}
      <section className="space-y-1.5" aria-label="Temps de passage">
        <SectionTitle>Temps de passage</SectionTitle>
        <div className="bg-ink-900 border border-ink-800 rounded-2xl p-3.5 space-y-3">
          <label className="block">
            <span className="flex justify-between text-[12px] text-ink-400"><span>Intensité</span><span className="font-semibold text-ink-100 tabular-nums">{pct} % de la VMA</span></span>
            <input type="range" min="70" max="120" step="1" value={pct} onChange={(e) => setPct(Number(e.target.value))} className="w-full mt-2 accent-volt-500" aria-label="Pourcentage de VMA" />
          </label>
          {speed ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Stat size="sm" value={`${speed.toFixed(1)} km/h`} label="Vitesse" />
                <Stat size="sm" value={paceFromSpeed(speed).replace(' /km', '')} label="Allure /km" />
                <Stat size="sm" value={formatDuration(400 * 3.6 / speed, { tenths: true })} label="Tour de piste" />
              </div>
              <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-[13px] tabular-nums">
                {splits.map((sp) => (
                  <div key={sp.m} className="flex justify-between border-b border-ink-800 py-1">
                    <span className="text-ink-400">{sp.m} m</span>
                    <span className="font-semibold text-ink-50">{formatDuration(sp.seconds, { tenths: true })}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[13px] text-ink-400">Renseigne ta VMA pour voir les temps de passage.</p>
          )}
        </div>
      </section>
    </div>
  );
}
