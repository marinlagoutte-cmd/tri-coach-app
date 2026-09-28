import React from 'react';

// BUG RÉEL SIGNALÉ : un clic sur une séance ("j'ai ENCORE un message d'erreur") faisait
// planter toute l'app sans qu'aucun détail exploitable ne remonte — l'app n'avait AUCUN
// error boundary React nulle part, donc n'importe quelle erreur de rendu (ex: un champ
// texte renvoyé comme objet par l'IA, voir sanitizeWorkoutFieldTypes dans lib/workouts.js)
// faisait disparaître TOUTE la page derrière l'écran d'erreur générique de Next.js
// ("Application error: a client-side exception has occurred"), sans aucun détail
// utilisable pour diagnostiquer. Ce composant capture l'erreur, affiche le message réel
// (utile pour signaler précisément le bug) et propose de continuer sans tout recharger.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Log console pour un diagnostic éventuel via les outils de dev / Vercel logs.
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4">
          <div className="bg-ink-900 border border-rose-800/60 rounded-2xl p-5 max-w-sm w-full space-y-3 text-ink-100">
            <p className="text-sm font-black text-rose-300">⚠️ Une erreur est survenue</p>
            <p className="text-[11px] text-ink-400 leading-relaxed">
              Voici le message technique exact — merci de le copier si tu signales le problème :
            </p>
            <pre className="bg-ink-950 border border-ink-800 rounded-xl p-2.5 text-[10px] text-rose-300 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
              {String(this.state.error?.message || this.state.error)}
            </pre>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => this.setState({ error: null })}
                className="flex-1 bg-ink-800 hover:bg-ink-700 text-ink-50 font-bold px-3 py-2 rounded-xl text-[11px]"
              >
                Continuer
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 bg-volt-500 hover:bg-volt-600 text-white font-bold px-3 py-2 rounded-xl text-[11px]"
              >
                Recharger la page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
