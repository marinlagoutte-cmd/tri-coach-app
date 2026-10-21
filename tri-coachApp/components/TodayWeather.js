// components/TodayWeather.js — widget « météo et vent du jour » de l'écran Aujourd'hui.
// Position demandée une seule fois (bouton), puis mémorisée : le widget se charge ensuite
// tout seul. Un appui ouvre l'outil Météo complet (radar, vent heure par heure).
import { useEffect, useState } from 'react';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '../lib/storage';
import { CloudSun, ChevronRight } from 'lucide-react';
import { fetchTodayWeather, compassFr } from '../lib/todayWeather';

function WindArrow({ deg }) {
  if (!Number.isFinite(deg)) return null;
  // La direction météo indique d'où VIENT le vent : la flèche pointe là où il va.
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${deg + 180}deg)` }} className="inline-block text-sky-400">
      <path d="M12 3 L18 14 L13 12 L13 21 L11 21 L11 12 L6 14 Z" fill="currentColor" />
    </svg>
  );
}

const r = (v) => (Number.isFinite(v) ? Math.round(v) : '—');

export default function TodayWeather({ onOpen }) {
  const [coords, setCoords] = useState(null);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    const saved = loadFromStorage(STORAGE_KEYS.lastLocation, null);
    if (saved?.lat && saved?.lon) setCoords(saved);
  }, []);

  useEffect(() => {
    if (!coords) return;
    let cancelled = false;
    setStatus('loading');
    fetchTodayWeather(coords.lat, coords.lon)
      .then((d) => { if (!cancelled) { setData(d); setStatus('ok'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [coords]);

  const locate = () => {
    if (!navigator?.geolocation) { setStatus('error'); return; }
    setStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100 };
        saveToStorage(STORAGE_KEYS.lastLocation, c);
        setCoords(c);
      },
      () => setStatus('denied'),
      { timeout: 10000, maximumAge: 3600000 }
    );
  };

  if (!coords) {
    return (
      <button type="button" onClick={locate} className="w-full min-h-[44px] bg-ink-900 border border-ink-800 rounded-2xl px-3.5 py-2.5 flex items-center gap-2.5 text-left">
        <CloudSun size={18} className="text-sky-500 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-[13px] text-ink-300">{status === 'denied' ? 'Position refusée — météo du jour indisponible' : status === 'loading' ? 'Localisation…' : 'Afficher la météo et le vent du jour'}</span>
        <span className="text-[13px] text-volt-500 font-semibold shrink-0">Activer</span>
      </button>
    );
  }

  return (
    <button type="button" onClick={onOpen} aria-label="Météo du jour, ouvrir le détail" className="w-full bg-ink-900 border border-ink-800 rounded-2xl px-3.5 py-2.5 flex items-center gap-3 text-left">
      <CloudSun size={22} className="text-sky-500 shrink-0" aria-hidden="true" />
      {status === 'ok' && data ? (
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-ink-100">
            <span className="font-semibold tabular-nums">{r(data.tMax)}° / {r(data.tMin)}°</span>
            <span className="text-ink-400"> · {data.label}</span>
            {Number.isFinite(data.rainProb) && <span className="text-ink-400"> · pluie {r(data.rainProb)} %</span>}
          </p>
          <p className="text-[12px] text-ink-400 flex items-center gap-1 mt-0.5">
            <WindArrow deg={data.windDir} />
            <span>Vent <span className="font-semibold text-ink-200 tabular-nums">{r(data.windMax)} km/h</span> {compassFr(data.windDir)}</span>
            {Number.isFinite(data.gustMax) && <span>· rafales {r(data.gustMax)} km/h</span>}
          </p>
        </div>
      ) : (
        <p className="flex-1 text-[13px] text-ink-400">{status === 'error' ? 'Météo indisponible pour le moment.' : 'Chargement de la météo…'}</p>
      )}
      <ChevronRight size={18} className="text-ink-500 shrink-0" aria-hidden="true" />
    </button>
  );
}
