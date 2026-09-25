import React, { useState } from 'react';
import { useI18n } from '../lib/i18n';

// Panneau de diagnostic IA — ouvert depuis Réglages via le bouton "IA" (voir
// SettingsModal.js). Demande explicite de l'athlète : les notes techniques du
// double-check Gemini+Groq (ex. "Double-check indisponible cette fois : Groq
// injoignable...") ne doivent plus jamais s'afficher ailleurs dans l'app, mais il doit
// rester possible de tester chaque modèle à la demande pour repérer un bug/une panne
// (voir pages/api/ai-diagnostics.js, qui teste chaque candidat individuellement, sans
// le fallback silencieux utilisé en production par lib/gemini.js / lib/groq.js).
export default function AiDiagnosticsModal({ isOpen, onClose }) {
  const { t, lang } = useI18n();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [testedAt, setTestedAt] = useState(null);
  const [fetchError, setFetchError] = useState('');

  if (!isOpen) return null;

  const runDiagnostics = async () => {
    setRunning(true);
    setFetchError('');
    try {
      const res = await fetch('/api/ai-diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResults(data.results || []);
      setTestedAt(data.testedAt || new Date().toISOString());
    } catch (e) {
      setFetchError(e.message || t('settings.aiDiagnosticsFetchError'));
    } finally {
      setRunning(false);
    }
  };

  const geminiResults = (results || []).filter((r) => r.provider === 'gemini');
  const groqResults = (results || []).filter((r) => r.provider === 'groq');

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-[60] flex items-end sm:items-center justify-center animate-sheetBackdrop"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-ink-900 border border-ink-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-4 shadow-2xl text-ink-100 max-h-[92vh] overflow-y-auto animate-slideUp sm:animate-none"
      >
        <div className="sm:hidden -mt-1.5 mb-1 flex justify-center">
          <span className="w-9 h-1 rounded-full bg-ink-700" />
        </div>

        <div className="flex justify-between items-center border-b border-ink-800 pb-3">
          <h2 className="text-sm font-black text-ink-50 font-display">🤖 {t('settings.aiDiagnosticsTitle')}</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-50 font-bold p-1 min-h-tap min-w-[44px]">✕</button>
        </div>

        <p className="text-[10px] text-ink-500 leading-relaxed">{t('settings.aiDiagnosticsSubtitle')}</p>

        <button
          onClick={runDiagnostics}
          disabled={running}
          className="w-full text-xs font-bold text-ink-950 bg-volt-400 hover:bg-volt-300 disabled:opacity-50 px-3 py-2.5 rounded-xl uppercase tracking-wide"
        >
          {running ? t('settings.aiDiagnosticsRunning') : t('settings.aiDiagnosticsRun')}
        </button>

        {fetchError && <p className="text-[10px] text-rose-400">{fetchError}</p>}

        {testedAt && (
          <p className="text-[9px] text-ink-600">
            {t('settings.aiDiagnosticsLastRun')} : {new Date(testedAt).toLocaleTimeString()}
          </p>
        )}

        {!results && !running && !fetchError && (
          <p className="text-[10px] text-ink-600 italic">{t('settings.aiDiagnosticsEmpty')}</p>
        )}

        {results && (
          <div className="space-y-3">
            <ProviderGroup label="Gemini" accentColor="#8ab4f8" results={geminiResults} t={t} />
            <ProviderGroup label="Groq" accentColor="#f97316" results={groqResults} t={t} />
          </div>
        )}
      </div>
    </div>
  );
}

function ProviderGroup({ label, accentColor, results, t }) {
  if (!results.length) return null;
  return (
    <div className="space-y-2">
      <span className="text-[10px] font-mono uppercase tracking-widest block" style={{ color: accentColor }}>{label}</span>
      <div className="space-y-2">
        {results.map((r) => (
          <ModelResultCard key={`${r.provider}-${r.model}`} result={r} t={t} />
        ))}
      </div>
    </div>
  );
}

function ModelResultCard({ result, t }) {
  const { model, ok, latencyMs, sample, error } = result;
  return (
    <div className={`bg-ink-950 border rounded-xl p-3 space-y-1.5 ${ok ? 'border-emerald-800/60' : 'border-rose-800/60'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-ink-50 font-mono truncate">{model}</span>
        <span className={`shrink-0 text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
          {ok ? `✓ ${t('settings.aiDiagnosticsOk')}` : `✕ ${t('settings.aiDiagnosticsFail')}`}
        </span>
      </div>
      {Number.isFinite(latencyMs) && latencyMs > 0 && (
        <p className="text-[9px] text-ink-500">{t('settings.aiDiagnosticsLatency')} : {latencyMs}ms</p>
      )}
      {ok && sample && (
        <p className="text-[9px] text-ink-400 font-mono break-all">{t('settings.aiDiagnosticsSample')} : {sample}</p>
      )}
      {!ok && error && (
        <p className="text-[9px] text-rose-400 break-all">{t('settings.aiDiagnosticsError')} : {error}</p>
      )}
    </div>
  );
}
