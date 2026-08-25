// components/EquipmentTracker.js
//
// Onglet Outils > Matériel : suivi d'usure des pièces vélo + chaussures. Kilométrage
// dérivé du total Strava par matériel (voir lib/equipment.js côté serveur, tables
// equipment / equipment_components / equipment_component_history dans
// supabase-schema-equipment.sql), avec possibilité de corriger manuellement.
//
// Illustration : vectorielle (dessinée), pas une photo — voir échange avec l'athlète :
// les photos Canyon/SRAM/DT Swiss (site officiel ou "retouchées à l'IA") restent la
// propriété de leurs auteurs, jamais intégrées ici. Remplaçable plus tard par de vraies
// photos personnelles de son vélo (prévu : props photoUrls par zone, voir TODO en bas).
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const C = {
  card: '#FFFFFF',
  border: '#E4E6E8',
  page: '#F6F7F8',
  textPrimary: '#14161C',
  textSecondary: '#565D67',
  textMuted: '#A5AAB0',
  volt: '#FC4C02',
  voltLight: '#FFF4EE',
  good: '#0F6E56',
  goodBg: '#E1F5EE',
  warn: '#854F0B',
  warnBg: '#FAEEDA',
  bad: '#993C1D',
  badBg: '#FAECE7',
};

const ZONE_LABELS = { transmission: 'Transmission', roues: 'Roues & freins', cockpit: 'Cockpit' };
const ZONE_ORDER = ['transmission', 'roues', 'cockpit'];

// Positions des pastilles sur l'illustration vectorielle — vue d'ensemble (%), et par pièce
// dans chaque zone zoomée. Les `part_key` inconnus (pièce ajoutée manuellement par
// l'athlète) retombent sur une position par défaut au centre de la zone plutôt que de
// planter — voir getPartPos.
const GROUP_PILL_POS = { transmission: { x: 22, y: 82 }, roues: { x: 68, y: 88 }, cockpit: { x: 78, y: 16 } };
const PART_POS = {
  transmission: {
    cassette: { x: 15, y: 58 }, derailleur: { x: 22, y: 90 }, chaine: { x: 48, y: 46 },
    manivelles: { x: 75, y: 40 }, pedales: { x: 90, y: 55 },
  },
  roues: {
    'pneu-ar': { x: 24, y: 20 }, 'pneu-av': { x: 76, y: 20 },
    disques: { x: 50, y: 55 }, plaquettes: { x: 20, y: 40 }, roues: { x: 80, y: 40 },
  },
  cockpit: { cintre: { x: 50, y: 20 }, ruban: { x: 22, y: 55 }, durites: { x: 82, y: 45 }, selle: { x: 50, y: 82 } },
};
function getPartPos(zone, partKey) {
  return PART_POS[zone]?.[partKey] || { x: 50, y: 50 };
}

const wearRatio = (km, lifespanKm) => (lifespanKm > 0 ? Math.min(km / lifespanKm, 1) : 0);
const wearTone = (r) =>
  r >= 0.9 ? { fg: C.bad, bg: C.badBg, label: 'à surveiller' }
  : r >= 0.6 ? { fg: C.warn, bg: C.warnBg, label: 'usure modérée' }
  : { fg: C.good, bg: C.goodBg, label: 'bon état' };

function currentKm(equipment, component) {
  const totalKm = (equipment?.total_distance_m || 0) / 1000;
  return Math.max(totalKm - (component.baseline_km || 0), 0);
}

// --- Illustrations vectorielles (reprises de la maquette validée) ------------------------

function Defs() {
  return (
    <defs>
      <linearGradient id="eq-frame" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#8B7EE8" />
        <stop offset="50%" stopColor="#4A93D9" />
        <stop offset="100%" stopColor="#2AA47E" />
      </linearGradient>
      <linearGradient id="eq-frameHi" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
        <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
      </linearGradient>
      <radialGradient id="eq-tireSheen" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stopColor="#4A4E55" />
        <stop offset="100%" stopColor="#111316" />
      </radialGradient>
      <linearGradient id="eq-metal" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#E3E5E7" />
        <stop offset="100%" stopColor="#9AA0A6" />
      </linearGradient>
    </defs>
  );
}

function Wheel({ cx, cy, r }) {
  const spokes = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(a) * (r - 10)} y2={cy + Math.sin(a) * (r - 10)} stroke="#8A8E92" strokeWidth="1" opacity="0.55" />;
  });
  const treads = Array.from({ length: 40 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2;
    return <line key={i} x1={cx + Math.cos(a) * (r + 1)} y1={cy + Math.sin(a) * (r + 1)} x2={cx + Math.cos(a) * (r + 5)} y2={cy + Math.sin(a) * (r + 5)} stroke="#0B0C0E" strokeWidth="2" />;
  });
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 9} fill="url(#eq-tireSheen)" />
      {treads}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="url(#eq-metal)" strokeWidth="6" />
      {spokes}
      <circle cx={cx} cy={cy} r={22} fill="none" stroke="#9AA0A6" strokeWidth="2.5" />
      <circle cx={cx} cy={cy} r="7" fill="#5B6066" />
    </g>
  );
}

function Crankset({ cx, cy, r }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1B1E23" strokeWidth="6" strokeDasharray="4 3.2" />
      <circle cx={cx} cy={cy} r={r - 6} fill="none" stroke="#3A3F47" strokeWidth="2" />
      <circle cx={cx} cy={cy} r="9" fill="url(#eq-metal)" stroke="#7C8288" strokeWidth="1" />
      <line x1={cx} y1={cy} x2={cx + r * 1.05} y2={cy + r * 0.85} stroke="#1B1E23" strokeWidth="9" strokeLinecap="round" />
      <circle cx={cx + r * 1.05} cy={cy + r * 0.85} r="8" fill="#1B1E23" />
    </g>
  );
}

function Cassette({ cx, cy }) {
  const rs = [20, 17, 14.5, 12.5, 11, 9.5];
  return <g>{rs.map((rr, i) => <circle key={i} cx={cx} cy={cy} r={rr} fill="none" stroke="#6B7076" strokeWidth={2.6 - i * 0.2} />)}</g>;
}

function OverviewArt() {
  return (
    <svg viewBox="0 0 600 300" style={{ width: '100%', height: '100%' }}>
      <Defs />
      <Wheel cx={110} cy={220} r={64} />
      <Wheel cx={490} cy={220} r={64} />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M215,85 L260,220" stroke="url(#eq-frame)" strokeWidth="15" />
        <path d="M215,85 L110,220" stroke="url(#eq-frame)" strokeWidth="12" />
        <path d="M260,220 L430,95" stroke="url(#eq-frame)" strokeWidth="17" />
        <path d="M215,85 L430,95" stroke="url(#eq-frame)" strokeWidth="14" />
        <path d="M430,95 L448,150" stroke="url(#eq-frame)" strokeWidth="13" />
        <path d="M448,150 L490,220" stroke="#20242B" strokeWidth="9" />
        <path d="M215,85 L260,220" stroke="url(#eq-frameHi)" strokeWidth="6" />
        <path d="M260,220 L430,95" stroke="url(#eq-frameHi)" strokeWidth="6" />
      </g>
      <path d="M215,85 L198,70" fill="none" stroke="#20242B" strokeWidth="7" strokeLinecap="round" />
      <path d="M176,66 C176,62 224,58 224,66 C224,74 176,74 176,66 Z" fill="#14161C" />
      <path d="M430,95 L468,78" fill="none" stroke="#20242B" strokeWidth="7" strokeLinecap="round" />
      <path d="M468,78 C488,76 498,90 495,106 C492,120 480,124 468,120" fill="none" stroke="#20242B" strokeWidth="7" strokeLinecap="round" />
      <Crankset cx={260} cy={220} r={26} />
      <Cassette cx={110} cy={220} />
      <path d="M118,236 L130,260 L122,278" fill="none" stroke="#1B1E23" strokeWidth="5" strokeLinecap="round" />
      <path d="M132,213 L228,213 M129,227 L228,227" stroke="#7C8288" strokeWidth="2" strokeDasharray="1.5 3" />
    </svg>
  );
}

function TransmissionArt() {
  return (
    <svg viewBox="0 0 400 260" style={{ width: '100%', height: '100%' }}>
      <Defs />
      <path d="M40,120 L400,60" stroke="url(#eq-frame)" strokeWidth="26" strokeLinecap="round" />
      <path d="M40,120 L400,60" stroke="url(#eq-frameHi)" strokeWidth="9" strokeLinecap="round" />
      <Cassette cx={60} cy={150} />
      <path d="M76,168 L98,205 L86,236" fill="none" stroke="#1B1E23" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="78" y="222" width="18" height="26" rx="4" fill="#14161C" />
      <path d="M92,142 L300,95 M90,158 L300,111" stroke="#7C8288" strokeWidth="3.4" strokeDasharray="2 4" />
      <Crankset cx={300} cy={103} r={46} />
      <line x1="300" y1="103" x2="345" y2="140" stroke="#1B1E23" strokeWidth="9" strokeLinecap="round" />
      <rect x="337" y="136" width="26" height="12" rx="3" fill="#1B1E23" transform="rotate(18 350 142)" />
    </svg>
  );
}

function WheelsArt() {
  return (
    <svg viewBox="0 0 400 260" style={{ width: '100%', height: '100%' }}>
      <Defs />
      <Wheel cx={95} cy={140} r={92} />
      <Wheel cx={305} cy={140} r={92} />
      <circle cx={95} cy={140} r={40} fill="none" stroke="#B7BBBE" strokeWidth="2.5" />
      <circle cx={305} cy={140} r={40} fill="none" stroke="#B7BBBE" strokeWidth="2.5" />
      <rect x="70" y="99" width="14" height="20" rx="3" fill="#3A3F47" transform="rotate(-20 77 109)" />
      <rect x="280" y="99" width="14" height="20" rx="3" fill="#3A3F47" transform="rotate(-20 287 109)" />
    </svg>
  );
}

function CockpitArt() {
  return (
    <svg viewBox="0 0 400 260" style={{ width: '100%', height: '100%' }}>
      <Defs />
      <path d="M200,220 L200,90" stroke="url(#eq-frame)" strokeWidth="18" strokeLinecap="round" />
      <path d="M160,80 L240,80" stroke="#20242B" strokeWidth="9" strokeLinecap="round" />
      <path d="M160,80 C130,80 118,102 122,124 C125,142 140,150 156,146" fill="none" stroke="#20242B" strokeWidth="9" strokeLinecap="round" />
      <path d="M240,80 C270,80 282,102 278,124 C275,142 260,150 244,146" fill="none" stroke="#20242B" strokeWidth="9" strokeLinecap="round" />
      <path d="M200,90 L200,60 L215,55" fill="none" stroke="#3A3F47" strokeWidth="10" strokeLinecap="round" />
      <path d="M122,124 C125,142 140,150 156,146" fill="none" stroke="#14161C" strokeWidth="11" strokeLinecap="round" strokeDasharray="3 2.4" />
      <path d="M278,124 C275,142 260,150 244,146" fill="none" stroke="#14161C" strokeWidth="11" strokeLinecap="round" strokeDasharray="3 2.4" />
      <path d="M158,84 C150,110 150,150 165,190" fill="none" stroke="#8A8E92" strokeWidth="3" />
      <path d="M242,84 C250,110 250,150 235,190" fill="none" stroke="#8A8E92" strokeWidth="3" />
      <path d="M170,206 C170,196 230,196 230,206 C230,216 170,216 170,206 Z" fill="#14161C" />
      <path d="M195,196 L200,220" stroke="#3A3F47" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}

const ZONE_ART = { transmission: TransmissionArt, roues: WheelsArt, cockpit: CockpitArt };

// --- UI bits -------------------------------------------------------------------------------

function GroupPill({ x, y, label, tone, onClick }) {
  return (
    <button onClick={onClick} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)',
      display: 'flex', alignItems: 'center', gap: 6, background: C.card, border: `1px solid ${C.border}`, borderRadius: 999,
      padding: '6px 12px 6px 8px', cursor: 'pointer', boxShadow: '0 1px 3px rgba(20,22,28,0.15)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: tone.fg, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: C.textPrimary, fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  );
}

function Hotspot({ x, y, tone, label, onClick }) {
  return (
    <button onClick={onClick} title={label} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)',
      width: 18, height: 18, borderRadius: 999, border: `2px solid ${C.card}`, background: tone.fg,
      boxShadow: '0 1px 4px rgba(20,22,28,0.4)', cursor: 'pointer', padding: 0 }} />
  );
}

function ProgressBar({ ratio, tone }) {
  return (
    <div style={{ height: 6, borderRadius: 999, background: '#EEF0F1', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${ratio * 100}%`, background: tone.fg, borderRadius: 999 }} />
    </div>
  );
}

function KmField({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return (
      <button onClick={() => { setDraft(Math.round(value)); setEditing(true); }}
        style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: C.textMuted, textDecoration: 'underline dotted' }}>
        modifier
      </button>
    );
  }
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input type="number" value={draft} onChange={(e) => setDraft(e.target.value)}
        style={{ width: 70, fontSize: 12, padding: '3px 6px', border: `1px solid ${C.border}`, borderRadius: 6 }} autoFocus />
      <button onClick={() => { onSave(Number(draft) || 0); setEditing(false); }}
        style={{ fontSize: 12, color: C.volt, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>ok</button>
      <button onClick={() => setEditing(false)} style={{ fontSize: 12, color: C.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}>annuler</button>
    </span>
  );
}

export default function EquipmentTracker({ session }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [equipmentList, setEquipmentList] = useState([]); // [{ ...equipment, components: [...] }]
  const [view, setView] = useState({ level: 'list' }); // list | overview(equipmentId) | zone
  const [syncing, setSyncing] = useState(false);
  const [addingPart, setAddingPart] = useState(false);
  const [newPartName, setNewPartName] = useState('');
  const [newPartLifespan, setNewPartLifespan] = useState(5000);

  const load = useCallback(async () => {
    if (!supabase || !session?.user?.id) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data: equipRows, error: equipErr } = await supabase
      .from('equipment').select('*').eq('user_id', session.user.id).order('kind').order('name');
    if (equipErr) { setError("Impossible de charger le matériel."); setLoading(false); return; }
    const ids = (equipRows || []).map((e) => e.id);
    let componentsByEquipment = {};
    if (ids.length > 0) {
      const { data: compRows } = await supabase
        .from('equipment_components').select('*').in('equipment_id', ids).order('zone').order('name');
      componentsByEquipment = (compRows || []).reduce((acc, c) => {
        (acc[c.equipment_id] = acc[c.equipment_id] || []).push(c);
        return acc;
      }, {});
    }
    setEquipmentList((equipRows || []).map((e) => ({ ...e, components: componentsByEquipment[e.id] || [] })));
    setLoading(false);
  }, [session?.user?.id]);

  useEffect(() => { load(); }, [load]);

  const bikes = useMemo(() => equipmentList.filter((e) => e.kind === 'bike'), [equipmentList]);
  const shoes = useMemo(() => equipmentList.filter((e) => e.kind === 'shoe'), [equipmentList]);

  const activeEquipment = view.equipmentId ? equipmentList.find((e) => e.id === view.equipmentId) : null;
  const zoneComponents = activeEquipment && view.zoneKey
    ? activeEquipment.components.filter((c) => c.zone === view.zoneKey)
    : [];

  const zoneWorstTone = (equipment, zoneKey) => {
    const comps = equipment.components.filter((c) => c.zone === zoneKey);
    if (comps.length === 0) return wearTone(0);
    return wearTone(Math.max(...comps.map((c) => wearRatio(currentKm(equipment, c), c.lifespan_km))));
  };

  async function handleSync() {
    if (!session?.access_token) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/strava/equipment-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || "La synchronisation a échoué."); }
      await load();
    } catch {
      setError("La synchronisation a échoué. Vérifie ta connexion.");
    } finally {
      setSyncing(false);
    }
  }

  async function markChanged(component) {
    if (!activeEquipment) return;
    const totalKm = (activeEquipment.total_distance_m || 0) / 1000;
    await supabase.from('equipment_component_history').insert({
      component_id: component.id, km_at_change: totalKm, note: 'Changé depuis l\'app',
    });
    await supabase.from('equipment_components').update({ baseline_km: totalKm, updated_at: new Date().toISOString() }).eq('id', component.id);
    await load();
  }

  async function saveKm(component, newKm) {
    if (!activeEquipment) return;
    const totalKm = (activeEquipment.total_distance_m || 0) / 1000;
    // Borné à [0, totalKm] : au-delà, la pièce afficherait plus de km que le vélo entier.
    const clampedKm = Math.min(Math.max(Number(newKm) || 0, 0), totalKm);
    // Un km affiché "corrigé" à `clampedKm` revient à déplacer la base : baseline = total - km.
    await supabase.from('equipment_components').update({ baseline_km: totalKm - clampedKm, updated_at: new Date().toISOString() }).eq('id', component.id);
    await load();
  }

  async function removePart(component) {
    await supabase.from('equipment_components').delete().eq('id', component.id);
    await load();
  }

  async function addPart() {
    if (!activeEquipment || !view.zoneKey || !newPartName.trim()) return;
    const totalKm = (activeEquipment.total_distance_m || 0) / 1000;
    await supabase.from('equipment_components').insert({
      equipment_id: activeEquipment.id,
      zone: view.zoneKey,
      part_key: `custom-${Date.now()}`,
      name: newPartName.trim(),
      lifespan_km: Number(newPartLifespan) || 5000,
      baseline_km: totalKm,
    });
    setNewPartName('');
    setAddingPart(false);
    await load();
  }

  if (!supabase || !session?.user?.id) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: C.textSecondary }}>Connecte-toi (et lie ton compte Strava dans Réglages) pour suivre l'usure de ton matériel.</div>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: C.textMuted }}>Chargement…</div>;
  }

  // --- Vue liste (aucun matériel Strava détecté, ou choix entre plusieurs vélos) ---
  if (view.level === 'list') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <button onClick={handleSync} disabled={syncing} style={{ alignSelf: 'flex-start', fontSize: 12.5, fontWeight: 500, color: C.volt, background: C.voltLight, border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', opacity: syncing ? 0.6 : 1 }}>
          {syncing ? 'Synchronisation…' : '↻ Actualiser depuis Strava'}
        </button>
        {error && <div style={{ fontSize: 12.5, color: C.bad }}>{error}</div>}

        {equipmentList.length === 0 && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, textAlign: 'center', fontSize: 13, color: C.textSecondary }}>
            Aucun matériel détecté pour l'instant. Renseigne tes vélos/chaussures dans Strava (avec le kilométrage à jour), puis touche "Actualiser depuis Strava" ci-dessus.
          </div>
        )}

        {bikes.length > 0 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.textSecondary, marginBottom: 8 }}>Vélos</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {bikes.map((b) => (
                <button key={b.id} onClick={() => setView({ level: 'overview', equipmentId: b.id })}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: C.textPrimary }}>{b.name}</span>
                  <span style={{ fontSize: 12, color: C.textMuted }}>{Math.round((b.total_distance_m || 0) / 1000).toLocaleString('fr-FR')} km</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {shoes.length > 0 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.textSecondary, marginBottom: 8 }}>Chaussures</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {shoes.map((s) => {
                const comp = s.components[0];
                const km = comp ? currentKm(s, comp) : 0;
                const ratio = comp ? wearRatio(km, comp.lifespan_km) : 0;
                const tone = wearTone(ratio);
                return (
                  <div key={s.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: C.textPrimary }}>{s.name}</span>
                      {comp && <span style={{ fontSize: 12, color: tone.fg }}>{Math.round(km)} / {comp.lifespan_km} km</span>}
                    </div>
                    {comp && <ProgressBar ratio={ratio} tone={tone} />}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- Vue d'ensemble d'un vélo (3 zones) ---
  if (view.level === 'overview' && activeEquipment) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setView({ level: 'list' })} style={{ border: 'none', background: 'none', color: C.textSecondary, fontSize: 13, cursor: 'pointer', padding: '4px 6px' }}>← Matériel</button>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>{activeEquipment.name}</div>
        </div>

        <div style={{ position: 'relative', background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, height: 260 }}>
          <OverviewArt />
          {ZONE_ORDER.map((zoneKey) => {
            const tone = zoneWorstTone(activeEquipment, zoneKey);
            const pos = GROUP_PILL_POS[zoneKey];
            return <GroupPill key={zoneKey} x={pos.x} y={pos.y} label={ZONE_LABELS[zoneKey]} tone={tone} onClick={() => setView({ level: 'zone', equipmentId: activeEquipment.id, zoneKey, openPart: null })} />;
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ZONE_ORDER.map((zoneKey) => {
            const tone = zoneWorstTone(activeEquipment, zoneKey);
            const count = activeEquipment.components.filter((c) => c.zone === zoneKey).length;
            return (
              <button key={zoneKey} onClick={() => setView({ level: 'zone', equipmentId: activeEquipment.id, zoneKey, openPart: null })}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', cursor: 'pointer', textAlign: 'left' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: C.textPrimary }}>{ZONE_LABELS[zoneKey]}</div>
                  <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{count} pièce{count > 1 ? 's' : ''} suivie{count > 1 ? 's' : ''}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 500, color: tone.fg, background: tone.bg, padding: '3px 10px', borderRadius: 999 }}>{tone.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // --- Vue zone (liste de pièces + historique déroulant) ---
  if (view.level === 'zone' && activeEquipment) {
    const ZoneArt = ZONE_ART[view.zoneKey];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setView({ level: 'overview', equipmentId: activeEquipment.id })} style={{ border: 'none', background: 'none', color: C.textSecondary, fontSize: 13, cursor: 'pointer', padding: '4px 6px' }}>← {activeEquipment.name}</button>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>{ZONE_LABELS[view.zoneKey]}</div>
        </div>

        <div style={{ position: 'relative', background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, height: 260 }}>
          <ZoneArt />
          {zoneComponents.map((c) => {
            const tone = wearTone(wearRatio(currentKm(activeEquipment, c), c.lifespan_km));
            const pos = getPartPos(view.zoneKey, c.part_key);
            return <Hotspot key={c.id} x={pos.x} y={pos.y} tone={tone} label={c.name} onClick={() => setView((v) => ({ ...v, openPart: v.openPart === c.id ? null : c.id }))} />;
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {zoneComponents.map((c) => {
            const km = currentKm(activeEquipment, c);
            const ratio = wearRatio(km, c.lifespan_km);
            const tone = wearTone(ratio);
            const open = view.openPart === c.id;
            return (
              <div key={c.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <button onClick={() => setView((v) => ({ ...v, openPart: v.openPart === c.id ? null : c.id }))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 13.5, fontWeight: 500, color: C.textPrimary, textAlign: 'left' }}>{c.name}</button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: tone.fg, fontWeight: 500 }}>{Math.round(km).toLocaleString('fr-FR')} / {c.lifespan_km.toLocaleString('fr-FR')} km</span>
                      <KmField value={km} onSave={(v) => saveKm(c, v)} />
                    </div>
                  </div>
                  <ProgressBar ratio={ratio} tone={tone} />
                </div>
                {open && (
                  <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 14px', background: C.page, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <ComponentHistory componentId={c.id} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => markChanged(c)} style={{ fontSize: 12.5, fontWeight: 500, color: C.volt, background: C.voltLight, border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }}>
                        + Marquer comme changé aujourd'hui
                      </button>
                      <button onClick={() => removePart(c)} style={{ fontSize: 12.5, fontWeight: 500, color: C.textMuted, background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }}>
                        Retirer cette pièce
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {addingPart ? (
            <div style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input value={newPartName} onChange={(e) => setNewPartName(e.target.value)} placeholder="Nom de la pièce (ex: Roulements de direction)"
                style={{ fontSize: 13, padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 8 }} autoFocus />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: C.textSecondary }}>Durée de vie estimée (km)</span>
                <input type="number" value={newPartLifespan} onChange={(e) => setNewPartLifespan(e.target.value)}
                  style={{ width: 90, fontSize: 12, padding: '5px 8px', border: `1px solid ${C.border}`, borderRadius: 8 }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={addPart} style={{ fontSize: 12.5, fontWeight: 500, color: '#fff', background: C.volt, border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }}>Ajouter</button>
                <button onClick={() => setAddingPart(false)} style={{ fontSize: 12.5, color: C.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}>Annuler</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingPart(true)} style={{ fontSize: 12.5, fontWeight: 500, color: C.textSecondary, background: 'none', border: `1px dashed ${C.border}`, borderRadius: 12, padding: '10px 14px', cursor: 'pointer' }}>
              + Ajouter une pièce à suivre
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}

function ComponentHistory({ componentId }) {
  const [history, setHistory] = useState(null);
  useEffect(() => {
    let cancelled = false;
    supabase.from('equipment_component_history').select('*').eq('component_id', componentId).order('changed_at', { ascending: false }).limit(10)
      .then(({ data }) => { if (!cancelled) setHistory(data || []); });
    return () => { cancelled = true; };
  }, [componentId]);

  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: C.textMuted, marginBottom: 8 }}>Historique</div>
      {history === null && <div style={{ fontSize: 12, color: C.textMuted }}>Chargement…</div>}
      {history?.length === 0 && <div style={{ fontSize: 12.5, color: C.textMuted }}>Aucun changement enregistré pour l'instant.</div>}
      {history?.map((h) => (
        <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
          <span style={{ color: C.textPrimary }}>{h.note || 'Changement'}</span>
          <span style={{ color: C.textMuted, flexShrink: 0, marginLeft: 10 }}>{new Date(h.changed_at).toLocaleDateString('fr-FR')} · {Math.round(h.km_at_change).toLocaleString('fr-FR')} km</span>
        </div>
      ))}
    </div>
  );
}

// TODO (une fois les photos personnelles envoyées) : remplacer OverviewArt/ZONE_ART par un
// composant <ZonePhoto src={...} /> recevant l'URL de chaque photo réelle, en gardant les
// mêmes positions relatives (%) pour les Hotspot/GroupPill — aucun autre changement nécessaire.
