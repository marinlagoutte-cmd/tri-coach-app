// components/PerformanceRecords.js
//
// Onglet Outils > Records : courbe de puissance vélo (meilleurs efforts 5s/1min/5min/20min)
// + records personnels course à pied / natation, calculés à partir des activités Strava
// RÉELLEMENT synchronisées (voir pages/api/strava/power-curve.js + lib/powerCurve.js —
// jamais de valeur inventée, même philosophie que components/ProfileHealth.js).
//
// Complète (ne remplace pas) la détection automatique déjà en place dans ProfileHealth.js
// (lib/zones.js:estimatePhysiologyFromActivities, protocole "test 20min") : ici l'athlète
// voit la courbe complète et peut, quand un 5min ET un 20min réels sont disponibles, choisir
// d'appliquer une estimation FTP plus fine (modèle Puissance Critique) que le simple
// 0.95 × 20min.
import React, { useEffect, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '../lib/storage';
import { POWER_CURVE_DURATIONS, POWER_CURVE_LABELS, formatDuration } from '../lib/powerCurve';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const C = {
  card: '#FFFFFF',
  border: '#E4E6E8',
  page: '#F6F7F8',
  textPrimary: '#14161C',
  textSecondary: '#565D67',
  textMuted: '#6B7280',
  volt: '#FC4C02',
  voltLight: '#FFF4EE',
  good: '#0F6E56',
  goodBg: '#E1F5EE',
};

function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('fr-FR'); } catch { return ''; }
}

function RecordRow({ label, pr }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: C.textPrimary }}>{label}</div>
        {pr && <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>{fmtDate(pr.date)} · {pr.activityName || 'Activité Strava'}</div>}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: pr ? C.textPrimary : C.textMuted }}>
        {pr ? formatDuration(pr.timeS) : '—'}
      </div>
    </div>
  );
}

export default function PerformanceRecords({ session, profile, onProfileChange, sportType = 'triathlon', stravaActivities = [] }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);

  const showBike = sportType !== 'running';
  const showSwim = sportType !== 'running';

  async function refresh() {
    if (!session?.access_token) return;
    setLoading(true);
    setError('');
    setApplied(false);
    try {
      const res = await fetch('/api/strava/power-curve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json?.error || 'Le calcul a échoué.'); return; }
      setData(json);
    } catch {
      setError('Le calcul a échoué. Vérifie ta connexion.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session?.access_token) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  function applyFtp() {
    if (!data?.ftpEstimate?.value) return;
    onProfileChange({ ...profile, ftp: data.ftpEstimate.value });
    const history = loadFromStorage(STORAGE_KEYS.healthHistory, []);
    const today = new Date().toISOString().slice(0, 10);
    const next = [...history.filter((h) => !(h.metric === 'ftp' && h.date === today)), { date: today, metric: 'ftp', value: data.ftpEstimate.value }]
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    saveToStorage(STORAGE_KEYS.healthHistory, next);
    setApplied(true);
  }

  if (!session?.user?.id) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: C.textSecondary }}>Connecte-toi (et lie ton compte Strava dans Réglages) pour voir ta courbe de puissance et tes records.</div>
      </div>
    );
  }

  const chartBests = data?.powerBests || {};
  const hasAnyPower = POWER_CURVE_DURATIONS.some((d) => chartBests[d]?.watts);

  const chartData = {
    labels: POWER_CURVE_DURATIONS.map((d) => POWER_CURVE_LABELS[d]),
    datasets: [{
      label: 'Meilleure puissance (W)',
      data: POWER_CURVE_DURATIONS.map((d) => chartBests[d]?.watts || 0),
      backgroundColor: C.volt,
      borderRadius: 6,
      maxBarThickness: 46,
    }],
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button onClick={refresh} disabled={loading} style={{ alignSelf: 'flex-start', fontSize: 12.5, fontWeight: 500, color: C.volt, background: C.voltLight, border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
        {loading ? 'Calcul…' : '↻ Actualiser depuis Strava'}
      </button>
      {error && <div style={{ fontSize: 12.5, color: '#993C1D' }}>{error}</div>}

      {showBike && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, marginBottom: 10 }}>Courbe de puissance vélo</div>
          {hasAnyPower ? (
            <div style={{ height: 180 }}>
              <Bar data={chartData} options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { color: C.textMuted }, grid: { color: 'rgba(16,19,26,0.08)' } }, x: { ticks: { color: C.textMuted }, grid: { display: false } } },
              }} />
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: C.textMuted }}>
              Pas encore assez de sorties vélo avec capteur de puissance synchronisées. Ouvre quelques sorties récentes dans l'onglet Calendrier (Détail activité) ou attends la prochaine actualisation — le cache se complète progressivement.
            </div>
          )}

          {data?.ftpEstimate && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 12.5, color: C.textSecondary }}>
                Estimation FTP : <strong style={{ color: C.textPrimary }}>{data.ftpEstimate.value} W</strong>
                <span style={{ color: C.textMuted }}> — {data.ftpEstimate.method}</span>
              </div>
              {data.ftpEstimate.alt20minRule && (
                <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>Pour comparaison, règle classique 0.95 × 20min : {data.ftpEstimate.alt20minRule} W</div>
              )}
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={applyFtp} disabled={applied} style={{ fontSize: 12.5, fontWeight: 500, color: '#fff', background: applied ? C.good : C.volt, border: 'none', borderRadius: 8, padding: '7px 12px', cursor: applied ? 'default' : 'pointer' }}>
                  {applied ? '✓ Appliqué au profil' : `Appliquer ${data.ftpEstimate.value} W au profil`}
                </button>
                {profile?.ftp && <span style={{ fontSize: 11.5, color: C.textMuted }}>FTP actuel du profil : {profile.ftp} W</span>}
              </div>
            </div>
          )}

          {data?.coverage && (
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10 }}>
              {data.coverage.ridesWithStreams} / {data.coverage.totalRides} sorties vélo analysées en détail.
              {data.coverage.remainingToBackfill > 0 && ` ${data.coverage.remainingToBackfill} restantes — touche "Actualiser" à nouveau pour continuer à compléter (quota Strava ménagé).`}
            </div>
          )}
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px' }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>Records personnels — Course à pied</div>
        {data?.runPRs ? Object.entries(data.runPRs).map(([key, pr]) => (
          <RecordRow key={key} label={pr?.label || key} pr={pr} />
        )) : <div style={{ fontSize: 12.5, color: C.textMuted }}>Chargement…</div>}
      </div>

      {showSwim && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>Records personnels — Natation</div>
          {data?.swimPRs ? Object.entries(data.swimPRs).map(([key, pr]) => (
            <RecordRow key={key} label={pr?.label || key} pr={pr} />
          )) : <div style={{ fontSize: 12.5, color: C.textMuted }}>Chargement…</div>}
        </div>
      )}
    </div>
  );
}
