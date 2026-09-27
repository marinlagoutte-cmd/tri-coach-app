import React, { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { aiFetch } from '../lib/aiFetch';

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
  const [summary, setSummary] = useState([]);
  const [recommendedEnv, setRecommendedEnv] = useState([]);
  const [copied, setCopied] = useState(false);
  const [testedAt, setTestedAt] = useState(null);
  const [fetchError, setFetchError] = useState('');

  if (!isOpen) return null;

  const runDiagnostics = async () => {
    setRunning(true);
    setFetchError('');
    try {
      const res = await aiFetch('/api/ai-diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResults(data.results || []);
      setSummary(data.summary || []);
      setRecommendedEnv(data.recommendedEnv || []);
      setCopied(false);
      setTestedAt(data.testedAt || new Date().toISOString());
    } catch (e) {
      setFetchError(e.message || t('settings.aiDiagnosticsFetchError'));
    } finally {
      setRunning(false);
    }
  };

  const geminiResults = (results || []).filter((r) => r.provider === 'gemini');
  const groqResults = (results || []).filter((r) => r.provider === 'groq');
  const mistralResults = (results || []).filter((r) => r.provider === 'mistral');

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-[60] flex items-end sm:items-center justify-center animate-sheetBackdrop"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-ink-900 border border-ink-800 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-4 shadow-2xl text-ink-100 max-h-[92dvh] overflow-y-auto animate-slideUp sm:animate-none"
      >
        <div className="sm:hidden -mt-1.5 mb-1 flex justify-center">
          <span className="w-9 h-1 rounded-full bg-ink-700" />
        </div>

        <div className="flex justify-between items-center border-b border-ink-800 pb-3">
          <h2 className="text-sm font-black text-ink-50 font-display">{t('settings.aiDiagnosticsTitle')}</h2>
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
          <p className="text-[10px] text-ink-600">
            {t('settings.aiDiagnosticsLastRun')} : {new Date(testedAt).toLocaleTimeString()}
          </p>
        )}

        {!results && !running && !fetchError && (
          <p className="text-[10px] text-ink-600 italic">{t('settings.aiDiagnosticsEmpty')}</p>
        )}

        {results && summary.length > 0 && (
          <UsageSummary summary={summary} />
        )}

        {results && recommendedEnv.length > 0 && (
          <div className="bg-ink-950 border border-ink-800 rounded-xl p-3 space-y-2">
            <p className="text-xs font-bold text-ink-100">Configuration recommandée (facultative)</p>
            <p className="text-[11px] text-ink-400 leading-snug">
              L'app ignore déjà d'elle-même les modèles indisponibles. Pour qu'elle ne les essaie plus du tout, colle ces lignes dans Vercel (Settings → Environment Variables), puis redéploie.
            </p>
            <pre className="text-[11px] font-mono text-ink-200 bg-ink-900 border border-ink-800 rounded-lg p-2 overflow-x-auto whitespace-pre">{recommendedEnv.join('\n')}</pre>
            <button
              type="button"
              onClick={async () => { try { await navigator.clipboard.writeText(recommendedEnv.join('\n')); setCopied(true); } catch (_) { setCopied(false); } }}
              className="w-full min-h-[40px] rounded-lg border border-ink-700 text-xs font-bold text-ink-200"
            >
              {copied ? '✓ Copié' : 'Copier'}
            </button>
          </div>
        )}

        {results && (
          <div className="space-y-3">
            <ProviderGroup label="Gemini" accentColor="#8ab4f8" results={geminiResults} t={t} />
            <ProviderGroup label="Groq" accentColor="#f97316" results={groqResults} t={t} />
            <ProviderGroup label="Mistral (secours)" accentColor="#fb923c" results={mistralResults} t={t} />
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
    <div className={`bg-ink-950 border rounded-xl p-3 space-y-1.5 ${ok ? 'border-emerald-800/60' : ['NOT_FOUND', 'NO_FREE_QUOTA'].includes(result.reason?.code) ? 'border-ink-800' : 'border-rose-800/60'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-ink-50 font-mono truncate">{model}</span>
        <span className={`shrink-0 text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
          {ok ? `✓ ${t('settings.aiDiagnosticsOk')}` : `✕ ${t('settings.aiDiagnosticsFail')}`}
        </span>
      </div>
      {Number.isFinite(latencyMs) && latencyMs > 0 && (
        <p className="text-[10px] text-ink-500">{t('settings.aiDiagnosticsLatency')} : {latencyMs}ms</p>
      )}
      {ok && sample && (
        <p className="text-[10px] text-ink-400 font-mono break-all">{t('settings.aiDiagnosticsSample')} : {sample}</p>
      )}
      {!ok && result.reason && (
        <div className="space-y-0.5">
          <p className={`text-xs font-bold ${['NOT_FOUND', 'NO_FREE_QUOTA'].includes(result.reason.code) ? 'text-ink-300' : 'text-rose-400'}`}>{result.reason.label}</p>
          <p className="text-[11px] text-ink-400 leading-snug">{result.reason.hint}</p>
        </div>
      )}
      {!ok && error && (
        <details className="text-[10px] text-ink-500">
          <summary className="cursor-pointer">Détail technique</summary>
          <p className="break-all mt-1">{error}</p>
        </details>
      )}
    </div>
  );
}

const TIER_LABEL = { plan: 'Génération du plan', review: 'Relecture du plan', chat: 'Chat coach', light: 'Tâches légères' };

// Ce que l'app utilisera réellement, tâche par tâche (premier modèle qui répond dans chaque liste).
function UsageSummary({ summary }) {
  const short = (m) => (m ? m.replace(/^openai\//, '') : null);
  const allOk = summary.every((row) => row.gemini || row.groq || row.mistral);
  const doubleCheck = summary.every((row) => [row.gemini, row.groq, row.mistral].filter(Boolean).length >= 2);
  return (
    <div className="bg-ink-950 border border-ink-800 rounded-xl p-3 space-y-2">
      <p className="text-xs font-bold text-ink-100">Ce que l'app utilisera</p>
      <p className={`text-[11px] font-bold leading-snug ${allOk ? 'text-emerald-400' : 'text-rose-400'}`}>
        {!allOk
          ? 'Au moins une tâche n\'a aucun modèle disponible : l\'IA ne fonctionnera pas pour elle.'
          : doubleCheck
            ? '✓ Tout fonctionne, avec double vérification par deux IA. Les modèles indisponibles sont simplement ignorés.'
            : '✓ L\'IA fonctionne, mais sans double vérification pour certaines tâches (une seule IA disponible).'}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-ink-500 text-left">
              <th className="font-bold py-1 pr-2">Tâche</th>
              <th className="font-bold py-1 pr-2">Gemini</th>
              <th className="font-bold py-1 pr-2">Groq</th>
              <th className="font-bold py-1">Mistral</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((row) => (
              <tr key={row.tier} className="border-t border-ink-800 align-top">
                <td className="py-1.5 pr-2 text-ink-300 font-bold">{TIER_LABEL[row.tier] || row.tier}</td>
                {['gemini', 'groq', 'mistral'].map((prov) => (
                  <td key={prov} className={`py-1.5 pr-2 font-mono ${row[prov] ? 'text-emerald-400' : 'text-ink-600'}`}>{short(row[prov]) || '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
