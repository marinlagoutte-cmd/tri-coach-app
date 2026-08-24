import React, { useEffect, useState } from 'react';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '../lib/storage';
import {
  defaultHrZones,
  defaultPowerZones,
  defaultPaceZones,
  computeZoneDistributionFromActivities,
  BIKE_SPORTS,
  RUN_SPORTS,
} from '../lib/zones';

/** "4:30" (m:ss) → vitesse en km/h. Retourne null si le format n'est pas valide. */
function paceStrToSpeedKmh(str) {
  const m = String(str ?? '').trim().match(/^(\d+):([0-5]\d)$/);
  if (!m) return null;
  const paceMin = Number(m[1]) + Number(m[2]) / 60;
  return paceMin > 0 ? 60 / paceMin : null;
}

/** Vitesse en km/h → "4:30" (m:ss/km), pour l'affichage/édition. */
function speedKmhToPaceStr(speedKmh) {
  if (!Number.isFinite(speedKmh) || speedKmh <= 0) return '-:--';
  const paceMin = 60 / speedKmh;
  const min = Math.floor(paceMin);
  const sec = Math.round((paceMin - min) * 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

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

/** Ligne de zone d'allure CAP : même présentation que ZoneRow, mais borne éditée en
 * m:ss/km (converti en vitesse km/h en interne, voir defaultPaceZones dans lib/zones.js)
 * plutôt qu'en valeur brute — un champ number ne permettrait pas de saisir une allure. */
function PaceZoneRow({ zone, onMinChange }) {
  const [draft, setDraft] = useState(speedKmhToPaceStr(zone.min));

  // Resynchronise le brouillon si la zone change depuis l'extérieur (ex: reset, ou
  // édition d'une autre zone qui ne nous concerne pas ici — pas de risque d'écraser une
  // saisie en cours puisque ce composant est ré-instancié par zone via sa key `zone.zone`).
  useEffect(() => {
    setDraft(speedKmhToPaceStr(zone.min));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone.min]);

  const commit = () => {
    const speed = paceStrToSpeedKmh(draft);
    if (speed) {
      onMinChange(Math.round(speed * 100) / 100);
    } else {
      setDraft(speedKmhToPaceStr(zone.min)); // saisie invalide → on revient à la valeur connue
    }
  };

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
          type="text"
          inputMode="numeric"
          placeholder="m:ss"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          className="w-12 bg-ink-950 border border-ink-800 rounded px-1 py-0.5 text-[10px] text-ink-100 font-mono text-center"
        />
        <span className="text-[9px] text-ink-600">/km</span>
      </span>
    </div>
  );
}

/** Bloc "Zones Allures CAP" — course à pied uniquement (pas d'onglet vélo/course, l'allure
 * n'a de sens qu'en course à pied ; la natation a sa propre allure CSS gérée ailleurs). */
function PaceZoneBlock({ zones, onZonesChange, activities, onReset }) {
  const distribution = computeZoneDistributionFromActivities(activities, zones, { metric: 'pace', sports: RUN_SPORTS });

  const updateMin = (idx, value) => {
    const nextZones = zones.map((z, i) => (i === idx ? { ...z, min: value } : z));
    onZonesChange(nextZones);
  };

  return (
    <div className="bg-ink-950 border border-ink-800 rounded-xl p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-bold text-ink-50">Zones Allures CAP</p>
      </div>

      {distribution.countedActivities > 0 ? (
        <p className="text-[10px] text-ink-500">
          {distribution.countedActivities} séance(s) course · {Math.round(distribution.totalMinutes)} min au total
        </p>
      ) : (
        <p className="text-[10px] text-ink-500">
          Aucune séance course avec vitesse moyenne dans les activités Strava synchronisées.
        </p>
      )}

      <div className="space-y-2">
        {distribution.zones.map((z, idx) => (
          <PaceZoneRow key={z.zone} zone={z} onMinChange={(v) => updateMin(idx, v)} />
        ))}
      </div>

      <div className="flex items-center justify-between pt-0.5 gap-2">
        <p className="text-[9px] text-ink-600">
          Édite librement chaque allure — une fois modifiée, elle prime sur le calcul théorique
          depuis la VMA pour la génération des séances par le coach IA.
        </p>
        <button onClick={onReset} className="text-[9px] font-bold text-ink-500 hover:text-ink-300 shrink-0 ml-2">
          ↻ Réinitialiser
        </button>
      </div>
    </div>
  );
}

export default function ZoneCharts({ profile, activities = [], onPaceZonesChange }) {
  const [hrZones, setHrZones] = useState(null);
  const [powerZones, setPowerZones] = useState(null);
  const [paceZones, setPaceZones] = useState(null);
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
    const storedPace = loadFromStorage(STORAGE_KEYS.paceZones, null);
    setPaceZones(storedPace || defaultPaceZones(profile?.vma));
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
  const updatePaceZones = (next) => {
    setPaceZones(next);
    saveToStorage(STORAGE_KEYS.paceZones, next);
    onPaceZonesChange?.(next);
  };

  const resetHrSport = () => {
    updateHrZones({ ...hrZones, [hrSport]: defaultHrZones(profile?.fcMax) });
  };
  const resetPowerSport = () => {
    const base = powerSport === 'run' && profile?.ftp ? profile.ftp * 0.85 : profile?.ftp;
    updatePowerZones({ ...powerZones, [powerSport]: defaultPowerZones(base) });
  };
  const resetPaceZones = () => updatePaceZones(defaultPaceZones(profile?.vma));

  if (!hrZones || !powerZones || !paceZones) return null;

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
      <div className="sm:col-span-2">
        <PaceZoneBlock
          zones={paceZones}
          onZonesChange={updatePaceZones}
          activities={activities}
          onReset={resetPaceZones}
        />
      </div>
    </div>
  );
}
