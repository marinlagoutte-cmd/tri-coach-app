// components/EquipmentTracker.js
//
// Onglet Outils > Matériel : suivi d'usure des pièces vélo + chaussures. Kilométrage
// dérivé du total Strava par matériel (voir lib/equipment.js côté serveur, tables
// equipment / equipment_components / equipment_component_history dans
// supabase-schema-equipment.sql), avec possibilité de corriger manuellement.
//
// Refonte UX du 26/08 (retour athlète) : le modèle précédent (photo de gros plan par
// zone avec un point cliquable par pièce) ne tenait pas la route dès qu'une zone avait
// plus de 3-4 pièces — ex. "cockpit" en a 8 dont la moitié sont des pièces "de
// référence" (cadre, fourche, batterie AXS…) qui ne s'usent jamais et ne servaient qu'à
// porter une fiche technique. Résultat : des points sans position dédiée retombaient au
// centre de la photo (illisible), et la photo de vue d'ensemble avait ses 4 pastilles de
// zone qui se chevauchaient (une pastille peut en cacher une autre — et donc bloquer son
// clic — si elles tombent l'une sur l'autre).
//
// Nouveau modèle, plus simple :
//   - Vue d'ensemble : 4 pastilles de zone sur la photo du vélo (repositionnées pour ne
//     plus se chevaucher, cible tactile agrandie) + la même liste juste en dessous.
//   - Vue zone : la photo de la zone reste affichée à titre illustratif SEULEMENT (plus
//     aucun point cliquable dessus — plus besoin de positionner une pièce par pièce).
//     Juste en dessous : UNE zone de texte libre, éditable, qui regroupe toutes les
//     infos de la zone (marque/modèle/n° de série/specs) — remplace les fiches
//     individuelles par pièce. Puis la liste des pièces qui s'usent réellement
//     (lifespan_km > 0), avec kilométrage + barre d'usure ; les pièces "de référence"
//     (lifespan_km = 0, ex. cadre/fourche) ne sont plus affichées comme cartes à part —
//     leurs infos ont été reprises dans la zone de texte (voir
//     supabase-migration-zone-notes-2026-08.sql).
//
// Fichiers photo attendus dans /public/equipment/canyon-aeroad/ :
//   overview-1.jpg, transmission-avant.jpg, transmission-arriere.jpg, roues.jpg, cockpit.jpg
//
// Pour ajouter un 2e vélo avec ses propres photos plus tard : dupliquer l'objet PHOTOS
// ci-dessous dans un dictionnaire { [equipment.name]: {...} } et adapter getPhotoSet()
// pour matcher sur le nom exact du matériel (actuellement un seul jeu de photos,
// appliqué à tout matériel de kind === 'bike').
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const C = {
  card: '#FFFFFF',
  border: '#E4E6E8',
  page: '#F6F7F8',
  textPrimary: '#14161C',
  textSecondary: '#565D67',
  // Gris plus foncé que l'ancien (#A5AAB0, contraste ~2.4:1 sur blanc — illisible pour
  // du texte courant). #6B7280 tient ~4.6:1 sur blanc, conforme WCAG AA.
  textMuted: '#6B7280',
  volt: '#FC4C02',
  voltLight: '#FFF4EE',
  good: '#0F6E56',
  goodBg: '#E1F5EE',
  warn: '#854F0B',
  warnBg: '#FAEEDA',
  bad: '#993C1D',
  badBg: '#FAECE7',
};

const ZONE_LABELS = {
  'transmission-avant': 'Transmission avant',
  'transmission-arriere': 'Transmission arrière',
  roues: 'Roues & freins',
  cockpit: 'Cockpit',
};
const ZONE_ORDER = ['transmission-avant', 'transmission-arriere', 'roues', 'cockpit'];

// Positions (%) des pastilles de zone sur le SCHÉMA VECTORIEL — utilisé seulement en
// secours si aucune photo n'est disponible pour un matériel (ex. un futur vélo pas
// encore photographié). Écartées pour ne jamais se chevaucher (voir GROUP_PILL_POS_PHOTO
// ci-dessous pour le détail du bug que ça évite).
const GROUP_PILL_POS_VECTOR = {
  'transmission-avant': { x: 50, y: 94 },
  'transmission-arriere': { x: 14, y: 78 },
  roues: { x: 82, y: 62 },
  cockpit: { x: 78, y: 14 },
};

// --- Photos personnelles ---------------------------------------------------------------

// Positions (%) des pastilles de zone sur la photo de vue d'ensemble. Écartées à la main
// (26/08) pour ne plus se chevaucher : "transmission avant" tombait auparavant sous
// l'étiquette "transmission arrière" (même zone de l'écran) et sa pastille, peinte en
// dessous, ne recevait plus jamais le clic — d'où le "je ne peux pas cliquer sur les
// groupes". Si tu changes la photo overview-1.jpg, revérifie ces % à l'œil pour être sûr
// qu'aucune étiquette ne recouvre une autre (chaque étiquette fait ~30-38% de large).
const GROUP_PILL_POS_PHOTO = {
  'transmission-avant': { x: 50, y: 92 },
  'transmission-arriere': { x: 15, y: 76 },
  roues: { x: 76, y: 56 },
  cockpit: { x: 74, y: 24 },
};

const PHOTOS = {
  // Image retravaillée le 26/08 : bout de chaîne parasite en haut à gauche effacé, et
  // marge blanche ajoutée tout autour pour "dézoomer" (le vélo occupait tout le cadre
  // avant). Si tu remplaces cette photo, garde le même traitement ou recalcule `ratio`
  // et GROUP_PILL_POS_PHOTO ci-dessus en conséquence.
  overview: { src: '/equipment/canyon-aeroad/overview-1.jpg', ratio: 905 / 708 },
  pillPos: GROUP_PILL_POS_PHOTO,
  // Les photos de zone servent uniquement d'illustration désormais (plus de points
  // cliquables par pièce dessus — voir note de refonte en tête de fichier) : juste
  // src + ratio, plus de mapping `parts`.
  zones: {
    'transmission-avant': { src: '/equipment/canyon-aeroad/transmission-avant.jpg', ratio: 730 / 630 },
    'transmission-arriere': { src: '/equipment/canyon-aeroad/transmission-arriere.jpg', ratio: 1000 / 1233 },
    roues: { src: '/equipment/canyon-aeroad/roues.jpg', ratio: 900 / 1233 },
    cockpit: { src: '/equipment/canyon-aeroad/cockpit.jpg', ratio: 1000 / 1333 },
  },
};

// Un seul jeu de photos pour l'instant, appliqué à tout matériel de type "bike".
function getPhotoSet(equipment) {
  return equipment?.kind === 'bike' ? PHOTOS : null;
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

// Point 6 — budget d'entretien prévisionnel : combien de temps reste-t-il avant que cette
// pièce atteigne sa durée de vie, ET combien ça coûtera — à partir du rythme d'usage RÉEL
// récent de ce matériel (voir usageRateByGear, dérivé des vraies activités Strava), jamais
// d'un rythme théorique. Renvoie `null` si non estimable (pièce "de référence" sans usure,
// pas de coût renseigné, ou pas assez d'usage récent pour extrapoler un rythme fiable).
function estimateReplacementBudget(component, km, weeklyKmRate) {
  if (!component.lifespan_km || component.lifespan_km <= 0) return null;
  if (!weeklyKmRate || weeklyKmRate < 5) return null; // rythme trop faible/inconnu pour extrapoler
  const remainingKm = Math.max(component.lifespan_km - km, 0);
  const weeksLeft = remainingKm / weeklyKmRate;
  const timeLabel = weeksLeft < 1
    ? "cette semaine"
    : weeksLeft < 8
      ? `dans ~${Math.round(weeksLeft)} semaine${Math.round(weeksLeft) > 1 ? 's' : ''}`
      : `dans ~${Math.round(weeksLeft / 4.345)} mois`;
  const cost = Number(component.cost_eur) || 0;
  return { timeLabel, cost, weeksLeft };
}

// --- Schémas vectoriels (secours si pas de photo) ---------------------------------------

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

function TransmissionAvantArt() {
  return (
    <svg viewBox="0 0 400 260" style={{ width: '100%', height: '100%' }}>
      <Defs />
      <path d="M40,60 L360,150" stroke="url(#eq-frame)" strokeWidth="24" strokeLinecap="round" />
      <path d="M40,60 L360,150" stroke="url(#eq-frameHi)" strokeWidth="8" strokeLinecap="round" />
      <path d="M110,90 L340,140" stroke="#7C8288" strokeWidth="3.4" strokeDasharray="2 4" />
      <Crankset cx={220} cy={140} r={62} />
      <line x1="220" y1="140" x2="270" y2="182" stroke="#1B1E23" strokeWidth="10" strokeLinecap="round" />
      <rect x="260" y="176" width="28" height="13" rx="3" fill="#1B1E23" transform="rotate(18 274 182)" />
    </svg>
  );
}

function TransmissionArriereArt() {
  return (
    <svg viewBox="0 0 400 260" style={{ width: '100%', height: '100%' }}>
      <Defs />
      <path d="M340,20 L200,240" stroke="url(#eq-frame)" strokeWidth="22" strokeLinecap="round" />
      <Cassette cx={140} cy={130} />
      <path d="M156,148 L178,190 L166,224" fill="none" stroke="#1B1E23" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="158" y="210" width="18" height="26" rx="4" fill="#14161C" />
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

const ZONE_ART = {
  'transmission-avant': TransmissionAvantArt,
  'transmission-arriere': TransmissionArriereArt,
  roues: WheelsArt,
  cockpit: CockpitArt,
};

// --- UI bits -------------------------------------------------------------------------------

// Ancre la pastille au centre normalement, mais bascule sur un ancrage gauche/droite
// quand elle est trop près du bord — sinon le texte se fait couper par le
// `overflow:hidden` de MediaFrame (c'était le bug des libellés tronqués du style
// "ansmission arrière"). `x`/`y` sont aussi resserrés dans [6,94] par sécurité.
//
// Robustesse tactile (26/08) : largeur du conteneur explicitement bornée à
// "max-content" (au lieu de laisser le navigateur déduire une largeur "shrink-to-fit"
// qui peut varier), zIndex explicite, et le conteneur laisse passer les clics
// (pointerEvents: 'none') pour ne jamais voler le clic d'une pastille voisine même si
// deux zones de texte finissaient par se toucher légèrement — seul le bouton lui-même
// est cliquable. Cible tactile portée à ~36px de haut mini (recommandation Apple/Google).
function GroupPill({ x, y, label, tone, onClick }) {
  const cx = Math.min(94, Math.max(6, x));
  const cy = Math.min(92, Math.max(8, y));
  let justify = 'center';
  let translateX = '-50%';
  if (cx < 22) { justify = 'flex-start'; translateX = '0%'; }
  else if (cx > 78) { justify = 'flex-end'; translateX = '-100%'; }
  return (
    <div style={{ position: 'absolute', left: `${cx}%`, top: `${cy}%`, transform: `translate(${translateX},-50%)`, display: 'flex', justifyContent: justify, width: 'max-content', maxWidth: '92%', pointerEvents: 'none', zIndex: 2 }}>
      <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 36, background: C.card, border: `1px solid ${C.border}`, borderRadius: 999,
        padding: '7px 14px 7px 9px', cursor: 'pointer', boxShadow: '0 1px 6px rgba(20,22,28,0.3)', whiteSpace: 'nowrap', pointerEvents: 'auto' }}>
        <span style={{ width: 9, height: 9, borderRadius: 999, background: tone.fg, flexShrink: 0 }} />
        <span style={{ fontSize: 13.5, color: C.textPrimary, fontWeight: 600 }}>{label}</span>
      </button>
    </div>
  );
}

function ProgressBar({ ratio, tone }) {
  return (
    <div style={{ height: 6, borderRadius: 999, background: '#EEF0F1', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${ratio * 100}%`, background: tone.fg, borderRadius: 999 }} />
    </div>
  );
}

// Nom éditable (pièce ou matériel) — même logique d'édition inline que KmField.
function NameField({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return (
      <button onClick={() => { setDraft(value); setEditing(true); }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 13.5, fontWeight: 500, color: C.textPrimary, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6 }}>
        {value}
        <span style={{ fontSize: 11, color: C.textMuted, textDecoration: 'underline dotted', fontWeight: 400 }}>renommer</span>
      </button>
    );
  }
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input value={draft} onChange={(e) => setDraft(e.target.value)}
        style={{ fontSize: 13, padding: '4px 7px', border: `1px solid ${C.border}`, borderRadius: 6, minWidth: 120 }} autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { onSave(draft.trim()); setEditing(false); } if (e.key === 'Escape') setEditing(false); }} />
      <button onClick={() => { if (draft.trim()) { onSave(draft.trim()); setEditing(false); } }}
        style={{ fontSize: 12, color: C.volt, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>ok</button>
      <button onClick={() => setEditing(false)} style={{ fontSize: 12, color: C.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}>annuler</button>
    </span>
  );
}

// Champ "détails" (marque / modèle / année / numéro de série / specs libres) : lecture
// seule tant qu'on n'a pas cliqué "ajouter des détails" / "modifier", sinon textarea.
function DetailsField({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  if (!editing) {
    return (
      <div>
        {value ? (
          <div style={{ fontSize: 12.5, color: C.textSecondary, whiteSpace: 'pre-wrap', marginBottom: 6, lineHeight: 1.5 }}>{value}</div>
        ) : null}
        <button onClick={() => { setDraft(value || ''); setEditing(true); }}
          style={{ fontSize: 12, color: C.textMuted, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline dotted', padding: 0 }}>
          {value ? 'modifier les détails' : '+ ajouter marque / modèle / numéro de série…'}
        </button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4}
        placeholder="Marque, modèle, année, numéro de série, specs…"
        style={{ fontSize: 12.5, padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: 'inherit', resize: 'vertical' }} autoFocus />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => { onSave(draft); setEditing(false); }}
          style={{ fontSize: 12, fontWeight: 500, color: '#fff', background: C.volt, border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>Enregistrer</button>
        <button onClick={() => setEditing(false)} style={{ fontSize: 12, color: C.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}>annuler</button>
      </div>
    </div>
  );
}

// Zone de texte unique par zone du vélo (transmission avant/arrière, roues & freins,
// cockpit) : remplace les fiches "détails" pièce par pièce d'avant. Toujours visible et
// modifiable directement (pas besoin de cliquer "modifier" d'abord comme DetailsField) —
// c'est LE champ qu'on veut voir en premier en arrivant sur une zone.
function ZoneNotesField({ value, onSave }) {
  const [draft, setDraft] = useState(value || '');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDraft(value || ''); setDirty(false); }, [value]);
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: C.textMuted, marginBottom: 8, fontWeight: 600 }}>
        Infos de la zone
      </div>
      <textarea
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
        rows={5}
        placeholder="Marque, modèle, année, numéro de série, dernière intervention, tout ce que tu veux noter sur cette zone…"
        style={{ width: '100%', fontSize: 13, color: C.textPrimary, padding: '9px 10px', border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
      />
      {dirty && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={() => { onSave(draft); setDirty(false); }}
            style={{ fontSize: 12.5, fontWeight: 500, color: '#fff', background: C.volt, border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }}>
            Enregistrer
          </button>
          <button onClick={() => { setDraft(value || ''); setDirty(false); }}
            style={{ fontSize: 12.5, color: C.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}>
            annuler
          </button>
        </div>
      )}
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

// Conteneur photo/schéma : garde le ratio (aspectRatio) pour que les % de position des
// pastilles/points restent alignés pixel pour pixel, que ce soit une vraie photo ou le SVG
// de secours (qui, lui, s'adapte à n'importe quel ratio).
function MediaFrame({ photo, vectorRatio, children, style }) {
  const ratio = photo?.ratio || vectorRatio || 600 / 300;
  return (
    <div style={{ position: 'relative', background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', aspectRatio: `${ratio}`, ...style }}>
      {photo ? (
        <img src={photo.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : null}
      {children}
    </div>
  );
}

export default function EquipmentTracker({ session }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [equipmentList, setEquipmentList] = useState([]); // [{ ...equipment, components: [...] }]
  const [view, setView] = useState({ level: 'list' }); // list | overview(equipmentId) | zone | shoe
  const [syncing, setSyncing] = useState(false);
  const [addingPart, setAddingPart] = useState(false);
  const [newPartName, setNewPartName] = useState('');
  const [newPartLifespan, setNewPartLifespan] = useState(5000);
  // Point 6 — coût du matériel : rythme d'usage récent par matériel (km/semaine, 60
  // derniers jours), pour estimer un budget d'entretien prévisionnel ("chaîne à changer
  // dans ~2 mois, ~35€") — dérivé des VRAIES activités Strava filtrées par gear_id,
  // jamais un rythme théorique inventé. Vide (pas d'estimation affichée) tant qu'aucune
  // activité récente n'est rattachée à ce matériel.
  const [usageRateByGear, setUsageRateByGear] = useState({}); // strava_gear_id -> km/semaine

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

    // Rythme d'usage récent par matériel (voir commentaire du state plus haut) — 60
    // derniers jours, requête best-effort (une erreur ici ne doit jamais empêcher
    // d'afficher le matériel lui-même, seulement l'estimation de budget disparaît).
    const gearIds = (equipRows || []).map((e) => e.strava_gear_id).filter(Boolean);
    if (gearIds.length > 0) {
      const sinceIso = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
      const { data: actRows } = await supabase
        .from('strava_activities')
        .select('gear_id, distance_m, start_date')
        .eq('user_id', session.user.id)
        .in('gear_id', gearIds)
        .gte('start_date', sinceIso);
      const sums = {};
      (actRows || []).forEach((a) => {
        if (!a.gear_id || !a.distance_m) return;
        sums[a.gear_id] = (sums[a.gear_id] || 0) + a.distance_m;
      });
      const rates = {};
      Object.keys(sums).forEach((gid) => { rates[gid] = (sums[gid] / 1000) / (60 / 7); });
      setUsageRateByGear(rates);
    } else {
      setUsageRateByGear({});
    }

    setLoading(false);
  }, [session?.user?.id]);

  useEffect(() => { load(); }, [load]);

  const bikes = useMemo(() => equipmentList.filter((e) => e.kind === 'bike'), [equipmentList]);
  const shoes = useMemo(() => equipmentList.filter((e) => e.kind === 'shoe'), [equipmentList]);

  const activeEquipment = view.equipmentId ? equipmentList.find((e) => e.id === view.equipmentId) : null;
  const photoSet = getPhotoSet(activeEquipment);
  // Seules les pièces qui s'usent réellement (lifespan_km > 0) sont affichées comme
  // cartes de suivi — les pièces "de référence" (cadre, fourche, batterie AXS…) n'ont
  // pas de barre d'usure pertinente et sont désormais couvertes par la zone de texte
  // libre (ZoneNotesField) plutôt que par une carte à part (voir note de refonte en
  // tête de fichier).
  const zoneComponents = activeEquipment && view.zoneKey
    ? activeEquipment.components.filter((c) => c.zone === view.zoneKey && c.lifespan_km > 0)
    : [];

  const zoneWorstTone = (equipment, zoneKey) => {
    const comps = equipment.components.filter((c) => c.zone === zoneKey && c.lifespan_km > 0);
    if (comps.length === 0) return wearTone(0);
    return wearTone(Math.max(...comps.map((c) => wearRatio(currentKm(equipment, c), c.lifespan_km))));
  };

  function goToZone(zoneKey) {
    if (!activeEquipment) return;
    setView({ level: 'zone', equipmentId: activeEquipment.id, zoneKey, openPart: null });
  }

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

  // Point 6 — coût du matériel : même principe que saveKm ci-dessus, pour le prix de
  // remplacement de la pièce (voir cost_eur, supabase-migration-cost-2026-08.sql).
  async function saveCost(component, newCost) {
    const clamped = Math.max(Number(newCost) || 0, 0);
    await supabase.from('equipment_components').update({ cost_eur: clamped, updated_at: new Date().toISOString() }).eq('id', component.id);
    await load();
  }

  async function renamePart(component, newName) {
    await supabase.from('equipment_components').update({ name: newName, updated_at: new Date().toISOString() }).eq('id', component.id);
    await load();
  }

  async function saveDetails(component, newDetails) {
    await supabase.from('equipment_components').update({ details: newDetails, updated_at: new Date().toISOString() }).eq('id', component.id);
    await load();
  }

  // Une seule zone JSON `zone_notes` sur `equipment` (voir
  // supabase-migration-zone-notes-2026-08.sql) : { [zoneKey]: "texte libre" }.
  async function saveZoneNotes(equipment, zoneKey, text) {
    const merged = { ...(equipment.zone_notes || {}), [zoneKey]: text };
    await supabase.from('equipment').update({ zone_notes: merged, updated_at: new Date().toISOString() }).eq('id', equipment.id);
    await load();
  }

  async function renameEquipment(equipment, newName) {
    await supabase.from('equipment').update({ name: newName, updated_at: new Date().toISOString() }).eq('id', equipment.id);
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
                  <button key={s.id} onClick={() => setView({ level: 'shoe', equipmentId: s.id })}
                    style={{ display: 'block', width: '100%', textAlign: 'left', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 14px', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: C.textPrimary }}>{s.name}</span>
                      <span style={{ fontSize: 12, color: comp ? tone.fg : C.textMuted }}>
                        {comp ? `${Math.round(km).toLocaleString('fr-FR')} / ${comp.lifespan_km.toLocaleString('fr-FR')} km` : `${Math.round((s.total_distance_m || 0) / 1000).toLocaleString('fr-FR')} km`}
                      </span>
                    </div>
                    {comp && <ProgressBar ratio={ratio} tone={tone} />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- Vue d'ensemble d'un vélo (4 zones) ---
  if (view.level === 'overview' && activeEquipment) {
    const pillPos = photoSet?.pillPos || GROUP_PILL_POS_VECTOR;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setView({ level: 'list' })} style={{ border: 'none', background: 'none', color: C.textSecondary, fontSize: 13, cursor: 'pointer', padding: '4px 6px' }}>← Matériel</button>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>{activeEquipment.name}</div>
        </div>

        <MediaFrame photo={photoSet?.overview} vectorRatio={600 / 300}>
          {!photoSet && <OverviewArt />}
          {ZONE_ORDER.map((zoneKey) => {
            const tone = zoneWorstTone(activeEquipment, zoneKey);
            const pos = pillPos[zoneKey];
            return (
              <GroupPill key={zoneKey} x={pos.x} y={pos.y} label={ZONE_LABELS[zoneKey]} tone={tone}
                onClick={() => goToZone(zoneKey)} />
            );
          })}
        </MediaFrame>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ZONE_ORDER.map((zoneKey) => {
            const tone = zoneWorstTone(activeEquipment, zoneKey);
            const count = activeEquipment.components.filter((c) => c.zone === zoneKey && c.lifespan_km > 0).length;
            return (
              <button key={zoneKey} onClick={() => goToZone(zoneKey)}
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

  // --- Vue chaussure (pas de photo/zones, une seule pièce d'usure "Amorti") ---
  if (view.level === 'shoe' && activeEquipment) {
    const comp = activeEquipment.components[0];
    const km = comp ? currentKm(activeEquipment, comp) : 0;
    const ratio = comp ? wearRatio(km, comp.lifespan_km) : 0;
    const tone = wearTone(ratio);
    const open = comp && view.openPart === comp.id;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setView({ level: 'list' })} style={{ border: 'none', background: 'none', color: C.textSecondary, fontSize: 13, cursor: 'pointer', padding: '4px 6px' }}>← Matériel</button>
          <NameField value={activeEquipment.name} onSave={(v) => renameEquipment(activeEquipment, v)} />
        </div>

        {!comp && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, textAlign: 'center', fontSize: 13, color: C.textSecondary }}>
            Le suivi d'usure de cette paire n'a pas encore été créé — touche "Actualiser depuis Strava" dans la liste du matériel pour le générer, ou reviens dans quelques minutes (ça se répare automatiquement au prochain import).
          </div>
        )}

        {comp && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
                <NameField value={comp.name} onSave={(v) => renamePart(comp, v)} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: tone.fg, fontWeight: 500 }}>{Math.round(km).toLocaleString('fr-FR')} / {comp.lifespan_km.toLocaleString('fr-FR')} km</span>
                  <KmField value={km} onSave={(v) => saveKm(comp, v)} />
                </div>
              </div>
              <ProgressBar ratio={ratio} tone={tone} />
              {/* Point 6 — budget d'entretien prévisionnel, voir estimateReplacementBudget. */}
              {(() => {
                const budget = estimateReplacementBudget(comp, km, usageRateByGear[activeEquipment.strava_gear_id]);
                return budget ? (
                  <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 6 }}>
                    💶 À remplacer {budget.timeLabel}{budget.cost > 0 ? ` — ~${budget.cost}€` : ''} (au rythme d'usage récent)
                  </div>
                ) : null;
              })()}
              <button onClick={() => setView((v) => ({ ...v, openPart: v.openPart === comp.id ? null : comp.id }))}
                style={{ marginTop: 8, fontSize: 11.5, color: C.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                {open ? '▴ masquer détails & historique' : '▾ détails & historique'}
              </button>
            </div>
            {open && (
              <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 14px', background: C.page, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <DetailsField value={comp.details} onSave={(v) => saveDetails(comp, v)} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textSecondary }}>
                  Coût de remplacement estimé : <strong>{comp.cost_eur || 0}€</strong>
                  <KmField value={comp.cost_eur || 0} onSave={(v) => saveCost(comp, v)} />
                </div>
                <ComponentHistory componentId={comp.id} />
                <button onClick={() => markChanged(comp)} style={{ alignSelf: 'flex-start', fontSize: 12.5, fontWeight: 500, color: C.volt, background: C.voltLight, border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }}>
                  + Marquer comme changées aujourd'hui
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // --- Vue zone (liste de pièces + historique déroulant) ---
  if (view.level === 'zone' && activeEquipment) {
    const ZoneArt = ZONE_ART[view.zoneKey];
    const photoZone = photoSet?.zones?.[view.zoneKey];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setView({ level: 'overview', equipmentId: activeEquipment.id })} style={{ border: 'none', background: 'none', color: C.textSecondary, fontSize: 13, cursor: 'pointer', padding: '4px 6px' }}>← {activeEquipment.name}</button>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>{ZONE_LABELS[view.zoneKey]}</div>
        </div>

        {/* Photo à titre illustratif seulement — plus de points cliquables par pièce
            dessus (voir note de refonte en tête de fichier) : les infos détaillées
            vivent maintenant dans la zone de texte juste en dessous. */}
        <MediaFrame photo={photoZone} vectorRatio={400 / 260}>
          {!photoZone && ZoneArt && <ZoneArt />}
        </MediaFrame>

        <ZoneNotesField
          value={activeEquipment.zone_notes?.[view.zoneKey]}
          onSave={(text) => saveZoneNotes(activeEquipment, view.zoneKey, text)}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {zoneComponents.map((c) => {
            const km = currentKm(activeEquipment, c);
            const ratio = wearRatio(km, c.lifespan_km);
            const tone = wearTone(ratio);
            const open = view.openPart === c.id;
            return (
              <div key={c.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
                    <NameField value={c.name} onSave={(v) => renamePart(c, v)} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: tone.fg, fontWeight: 500 }}>{Math.round(km).toLocaleString('fr-FR')} / {c.lifespan_km.toLocaleString('fr-FR')} km</span>
                      <KmField value={km} onSave={(v) => saveKm(c, v)} />
                    </div>
                  </div>
                  <ProgressBar ratio={ratio} tone={tone} />
                  {(() => {
                    const budget = estimateReplacementBudget(c, km, usageRateByGear[activeEquipment.strava_gear_id]);
                    return budget ? (
                      <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 6 }}>
                        💶 À remplacer {budget.timeLabel}{budget.cost > 0 ? ` — ~${budget.cost}€` : ''} (au rythme d'usage récent)
                      </div>
                    ) : null;
                  })()}
                  <button onClick={() => setView((v) => ({ ...v, openPart: v.openPart === c.id ? null : c.id }))}
                    style={{ marginTop: 8, fontSize: 11.5, color: C.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    {open ? '▴ masquer historique' : '▾ historique'}
                  </button>
                </div>
                {open && (
                  <div style={{ borderTop: `1px solid ${C.border}`, padding: '10px 14px', background: C.page, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textSecondary }}>
                      Coût de remplacement estimé : <strong>{c.cost_eur || 0}€</strong>
                      <KmField value={c.cost_eur || 0} onSave={(v) => saveCost(c, v)} />
                    </div>
                    <ComponentHistory componentId={c.id} />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
