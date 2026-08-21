import React, { useEffect, useState } from 'react';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '../lib/storage';
import {
  defaultHrZones,
  defaultPowerZones,
  computeZoneDistributionFromActivities,
  BIKE_SPORTS,
  RUN_SPORTS,
} from '../lib/zones';

const SPORT_TABS = [
  { key: 'bike', label: '🚴 Vélo' },
  { key: 'run', label: '🏃 Course' },
];

/** Une ligne de zone : barre de répartition (temps réel Strava) + borne basse éditable. */
function ZoneRow({ zone, unit, onMinChange }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-6 font-bold shrink-0" style={{ color: zone.color }}>{zone.zone}</span>
      <span className="w-[4.5rem] text-ink-400 truncate shrink-0">{zone.label}</span>
      <div className="flex-1 h-2 rounded-full bg-ink-800 overflow-hidden min-w-[1.5rem]">
        <div className="h-full rounded-full transition-all" style={{ width: `${zone.pct}%`, backgroundColor: zone.color }} />
      </div>
      <span className="w-11 text-right text-ink-300 font-mono shrink-0">{zone.minutes}m</span>
      <span className="w-8 text-right font-mono shrink-0" style={{ color: zone.color }}>{zone.pct}%</span>
      <span className="flex items-center gap-0.5 shrink-0">
        <span className="text-[9px] text-ink-600">≥</span>
        <input
          type="number"
          value={zone.min}
          onChange={(e) => onMinChange(Number(e.target.value) || 0)}
          className="w-12 bg-ink-950 border border-ink-800 rounded px-1 py-0.5 text-[10px] text-ink-100 font-mono"
        />
        <span className="text-[9px] text-ink-600">{unit}</span>
      </span>
    </div>
  );
}

/** Bloc complet (FC ou Puissance) : switch vélo/course + barres + édition des bornes. */
function ZoneBlock({ title, unit, metric, zonesBySport, onZonesBySportChange, activeSport, onSportChange, activities, onResetSport }) {
  const zones = zonesBySport[activeSport];
  const sports = activeSport === 'bike' ? BIKE_SPORTS : RUN_SPORTS;
  const distribution = computeZoneDistributionFromActivities(activities, zones, { metric, sports });

  const updateMin = (idx, value) => {
    const nextZones = zones.map((z, i) => (i === idx ? { ...z, min: value } : z));
    onZonesBySportChange({ ...zonesBySport, [activeSport]: nextZones });
  };

  return (
    <div className="bg-ink-950 border border-ink-800 rounded-xl p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-bold text-ink-50">{title}</p>
        <div className="flex gap-1.5">
          {SPORT_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => onSportChange(t.key)}
              className={`text-[10px] font-bold px-2 py-1 rounded-lg border ${
                activeSport === t.key ? 'text-volt-400 border-volt-500/30 bg-volt-500/10' : 'text-ink-500 border-ink-700 bg-ink-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {distribution.countedActivities > 0 ? (
        <p className="text-[10px] text-ink-500">
          {distribution.countedActivities} séance(s) Strava · {Math.round(distribution.totalMinutes)} min au total
        </p>
      ) : (
        <p className="text-[10px] text-ink-500">
          Aucune séance {activeSport === 'bike' ? 'vélo' : 'course'} avec {metric === 'hr' ? 'FC' : 'puissance'} moyenne dans les activités Strava synchronisées.
        </p>
      )}

      <div className="space-y-2">
        {distribution.zones.map((z, idx) => (
          <ZoneRow key={z.zone} zone={z} unit={unit} onMinChange={(v) => updateMin(idx, v)} />
        ))}
      </div>

      <div className="flex items-center justify-between pt-0.5">
        <p className="text-[9px] text-ink-600">
          Approximation : 1 séance = 1 zone (moyenne de la séance), pas de courbe seconde par seconde.
        </p>
        <button onClick={onResetSport} className="text-[9px] font-bold text-ink-500 hover:text-ink-300 shrink-0 ml-2">
          ↻ Réinitialiser
        </button>
      </div>
    </div>
  );
}

export default function ZoneCharts({ profile, activities = [] }) {
  const [hrZones, setHrZones] = useState(null);
  const [powerZones, setPowerZones] = useState(null);
  const [hrSport, setHrSport] = useState('bike');
  const [powerSport, setPowerSport] = useState('bike');

  useEffect(() => {
    const storedHr = loadFromStorage(STORAGE_KEYS.hrZones, null);
    setHrZones(
      storedHr || {
        bike: defaultHrZones(profile?.fcMax),
        run: defaultHrZones(profile?.fcMax),
      }
    );
    const storedPower = loadFromStorage(STORAGE_KEYS.powerZones, null);
    setPowerZones(
      storedPower || {
        bike: defaultPowerZones(profile?.ftp),
        // Pas de FTP course dans le profil : on part d'une estimation ~85% de la FTP
        // vélo (repère courant capteurs de puissance course type Stryd), 100% éditable.
        run: defaultPowerZones(profile?.ftp ? profile.ftp * 0.85 : null),
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateHrZones = (next) => {
    setHrZones(next);
    saveToStorage(STORAGE_KEYS.hrZones, next);
  };
  const updatePowerZones = (next) => {
    setPowerZones(next);
    saveToStorage(STORAGE_KEYS.powerZones, next);
  };

  const resetHrSport = () => {
    updateHrZones({ ...hrZones, [hrSport]: defaultHrZones(profile?.fcMax) });
  };
  const resetPowerSport = () => {
    const base = powerSport === 'run' && profile?.ftp ? profile.ftp * 0.85 : profile?.ftp;
    updatePowerZones({ ...powerZones, [powerSport]: defaultPowerZones(base) });
  };

  if (!hrZones || !powerZones) return null;

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <ZoneBlock
        title="Zones FC"
        unit="bpm"
        metric="hr"
        zonesBySport={hrZones}
        onZonesBySportChange={updateHrZones}
        activeSport={hrSport}
        onSportChange={setHrSport}
        activities={activities}
        onResetSport={resetHrSport}
      />
      <ZoneBlock
        title="Zones Puissance"
        unit="W"
        metric="power"
        zonesBySport={powerZones}
        onZonesBySportChange={updatePowerZones}
        activeSport={powerSport}
        onSportChange={setPowerSport}
        activities={activities}
        onResetSport={resetPowerSport}
      />
    </div>
  );
}
