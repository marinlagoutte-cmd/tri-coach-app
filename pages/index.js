import { useState, useEffect } from 'react';
import Head from 'next/head';

export default function Home() {
  const [step, setStep] = useState('onboarding'); // 'onboarding' | 'dashboard' | 'chat'
  const [profile, setProfile] = useState({
    name: '',
    age: '',
    weight: '',
    level: 'Avancé / D3',
    vma: '',
    ftp: '',
    nat100: '1:38',
    goal: 'Sprint / D3',
    tone: 'cash'
  });

  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);

  // Charger le profil s'il existe déjà
  useEffect(() => {
    const saved = localStorage.getItem('tri_profile');
    if (saved) {
      setProfile(JSON.parse(saved));
      setStep('dashboard');
    }
  }, []);

  const handleOnboardingSubmit = (e) => {
    e.preventDefault();
    localStorage.setItem('tri_profile', JSON.stringify(profile));
    setStep('dashboard');
    
    // Message de bienvenue initial
    setMessages([
      {
        role: 'model',
        text: `Salut ${profile.name} ! Ton profil est prêt. Objectif : ${profile.goal}. VMA : ${profile.vma} km/h | FTP : ${profile.ftp}W. Je suis ton coach. On part sur du direct et du cash : pas de volume poubelle. Qu'est-ce qu'on travaille aujourd'hui ?`
      }
    ]);
  };

  const sendMessage = async () => {
    if (!inputMessage.trim()) return;

    const userMsg = { role: 'user', text: inputMessage };
    setMessages(prev => [...prev, userMsg]);
    setInputMessage('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: inputMessage,
          profile: profile,
          history: messages
        })
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'model', text: data.reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'model', text: "Erreur de connexion avec le coach. Vérifie ta clé API Gemini sur Vercel." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-4 max-w-md mx-auto">
      <Head>
        <title>Tri-Coach App</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>

      {/* HEADER */}
      <header className="flex justify-between items-center pb-4 border-b border-slate-800 mb-6">
        <h1 className="text-xl font-bold text-amber-500">TRI-COACH</h1>
        {step !== 'onboarding' && (
          <nav className="flex gap-2">
            <button 
              onClick={() => setStep('dashboard')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold ${step === 'dashboard' ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-300'}`}
            >
              Dashboard
            </button>
            <button 
              onClick={() => setStep('chat')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold ${step === 'chat' ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-300'}`}
            >
              Coach Chat
            </button>
          </nav>
        )}
      </header>

      {/* 1. ECRAN ONBOARDING / QUESTIONNAIRE */}
      {step === 'onboarding' && (
        <form onSubmit={handleOnboardingSubmit} className="space-y-4">
          <h2 className="text-lg font-bold text-amber-400 mb-2">Configuration de ton Profil</h2>
          
          <div>
            <label className="text-xs text-slate-400 block mb-1">Prénom</label>
            <input 
              required
              type="text" 
              value={profile.name} 
              onChange={e => setProfile({...profile, name: e.target.value})}
              className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-sm text-white focus:outline-none focus:border-amber-500"
              placeholder="Ex: Marin"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Poids (kg)</label>
              <input 
                type="number" 
                value={profile.weight} 
                onChange={e => setProfile({...profile, weight: e.target.value})}
                className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-sm text-white focus:outline-none focus:border-amber-500"
                placeholder="90"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Niveau</label>
              <select 
                value={profile.level}
                onChange={e => setProfile({...profile, level: e.target.value})}
                className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-sm text-white focus:outline-none focus:border-amber-500"
              >
                <option>Débutant</option>
                <option>Intermédiaire</option>
                <option>Avancé / D3</option>
              </select>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-3">
            <h3 className="text-xs font-bold text-slate-300 mb-2">Métriques de Performance</h3>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">VMA (km/h)</label>
                <input 
                  type="number" step="0.5"
                  value={profile.vma} 
                  onChange={e => setProfile({...profile, vma: e.target.value})}
                  className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-sm text-white focus:outline-none focus:border-amber-500"
                  placeholder="18"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">FTP (Watts)</label>
                <input 
                  type="number" 
                  value={profile.ftp} 
                  onChange={e => setProfile({...profile, ftp: e.target.value})}
                  className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-sm text-white focus:outline-none focus:border-amber-500"
                  placeholder="350"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Nat (100m)</label>
                <input 
                  type="text" 
                  value={profile.nat100} 
                  onChange={e => setProfile({...profile, nat100: e.target.value})}
                  className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-sm text-white focus:outline-none focus:border-amber-500"
                  placeholder="1:38"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">Style de Coaching</label>
            <select 
              value={profile.tone}
              onChange={e => setProfile({...profile, tone: e.target.value})}
              className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-sm text-white focus:outline-none focus:border-amber-500"
            >
              <option value="cash">Direct & Cash (Alerte sur-entraînement)</option>
              <option value="pedagogique">Encourageant & Pédagogique</option>
            </select>
          </div>

          <button 
            type="submit" 
            className="w-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-3 rounded-xl mt-4 transition"
          >
            Lancer l'Application
          </button>
        </form>
      )}

      {/* 2. DASHBOARD */}
      {step === 'dashboard' && (
        <div className="space-y-4">
          <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-md font-bold text-slate-200">Profil : {profile.name}</h2>
              <button 
                onClick={() => setStep('onboarding')}
                className="text-[10px] text-slate-400 underline"
              >
                Modifier
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center mt-3">
              <div className="bg-slate-900/50 p-2 rounded">
                <span className="text-[10px] text-slate-500 block">VMA</span>
                <span className="text-sm font-bold text-emerald-400">{profile.vma || '--'} km/h</span>
              </div>
              <div className="bg-slate-900/50 p-2 rounded">
                <span className="text-[10px] text-slate-500 block">FTP</span>
                <span className="text-sm font-bold text-amber-400">{profile.ftp || '--'} W</span>
              </div>
              <div className="bg-slate-900/50 p-2 rounded">
                <span className="text-[10px] text-slate-500 block">Natation</span>
                <span className="text-sm font-bold text-blue-400">{profile.nat100 || '--'}</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/60 p-4 rounded-xl border border-slate-700">
            <h3 className="text-xs font-bold text-slate-300 uppercase mb-2">Zones Cibles Estimées</h3>
            <ul className="text-xs space-y-1.5 text-slate-400">
              <li>• <b>CAP Z2 (EF) :</b> ~{profile.vma ? (profile.vma * 0.65).toFixed(1) : '--'} km/h</li>
              <li>• <b>Vélo SweetSpot :</b> ~{profile.ftp ? Math.round(profile.ftp * 0.88) : '--'} W - {profile.ftp ? Math.round(profile.ftp * 0.93) : '--'} W</li>
              <li>• <b>Natation Sprint S :</b> Focus cadence & déblocage sous {profile.nat100}</li>
            </ul>
          </div>

          <button 
            onClick={() => setStep('chat')}
            className="w-full bg-amber-500 text-slate-900 font-bold py-3 rounded-xl flex justify-center items-center gap-2 hover:bg-amber-600 transition"
          >
            💬 Ouvrir la Discussion avec le Coach
          </button>
        </div>
      )}

      {/* 3. CHAT AVEC LE COACH */}
      {step === 'chat' && (
        <div className="flex flex-col h-[75vh]">
          <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-1">
            {messages.map((m, idx) => (
              <div 
                key={idx} 
                className={`p-3 rounded-xl text-xs ${
                  m.role === 'user' 
                    ? 'bg-amber-500/10 border border-amber-500/20 text-slate-200 ml-6' 
                    : 'bg-slate-800 border border-slate-700 text-slate-300 mr-6'
                }`}
              >
                <span className="font-bold block mb-1 text-[10px] text-slate-400">
                  {m.role === 'user' ? 'Vous' : 'Coach IA'}
                </span>
                <p className="whitespace-pre-line">{m.text}</p>
              </div>
            ))}
            {loading && <p className="text-xs text-amber-500 animate-pulse">Le coach analyse ta demande...</p>}
          </div>

          <div className="flex gap-2">
            <input 
              type="text" 
              value={inputMessage}
              onChange={e => setInputMessage(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder="Ex: Séance vélo reçue, RPE 8/10..."
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-amber-500"
            />
            <button 
              onClick={sendMessage}
              className="bg-amber-500 text-slate-900 font-bold px-4 rounded-xl text-xs hover:bg-amber-600 transition"
            >
              Envoyer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
