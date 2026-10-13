import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function AuthScreen({ onSkip }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
      });
      if (authError) throw authError;
      // La redirection OAuth quitte la page ; si on arrive ici c'est qu'elle a échoué.
    } catch (e) {
      setError("Connexion Google indisponible pour le moment. Réessaie, ou continue sans compte.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-ink-900 border border-ink-800 rounded-2xl p-6 space-y-5 text-center">
        <div className="text-4xl">🏊‍♂️🚴‍♂️🏃‍♂️</div>
        <div>
          <h1 className="text-lg font-black text-ink-50 font-display">Tri Coach</h1>
          <p className="text-xs text-ink-400 mt-2 leading-relaxed">
            Connecte-toi pour retrouver ton plan, ton calendrier et ton profil sur tous tes appareils —
            tes données sont sauvegardées automatiquement dans le cloud.
          </p>
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full bg-white text-ink-50 font-bold text-sm rounded-xl py-3 flex items-center justify-center gap-2.5 disabled:opacity-60 active:scale-[0.98] transition-all"
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.3 5.5 29.4 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5 44.5 35.3 44.5 24c0-1.2-.1-2.4-.3-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.3 5.5 29.4 3.5 24 3.5c-7.7 0-14.4 4.4-17.7 10.8z" />
            <path fill="#4CAF50" d="M24 44.5c5.3 0 10.1-2 13.7-5.3l-6.3-5.3c-2.1 1.4-4.7 2.2-7.4 2.2-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.5 40 16.2 44.5 24 44.5z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.7l6.3 5.3C40.7 36.4 44.5 30.7 44.5 24c0-1.2-.1-2.4-.3-3.5z" />
          </svg>
          {loading ? 'Connexion…' : 'Se connecter avec Google'}
        </button>

        {error && <p className="text-[10px] text-rose-400">{error}</p>}

        <button
          type="button"
          onClick={onSkip}
          className="w-full text-[11px] text-ink-500 underline underline-offset-2"
        >
          Continuer sans compte (données stockées uniquement sur cet appareil)
        </button>
      </div>
    </div>
  );
}

