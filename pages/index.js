import { useState, useRef, useEffect } from 'react';

export default function Home() {
  const [profile, setProfile] = useState({
    name: 'Marin',
    vma: 20,
    ftp: 350,
    weight: 87,
    nat100: '1:38'
  });

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    const savedProfile = localStorage.getItem('tri_coach_profile');
    if (savedProfile) {
      try { setProfile(JSON.parse(savedProfile)); } catch (e) {}
    }

    const savedMessages = localStorage.getItem('tri_coach_chat');
    if (savedMessages) {
      try { setMessages(JSON.parse(savedMessages)); } catch (e) {}
    } else {
      setMessages([{
        sender: 'coach',
        text: "Salut Marin ! Ton profil est chargé (VMA 20 km/h | FTP 350W). On part sur du direct et du cash. Donne-moi ta cible d'entraînement et je te sors une séance structurée en tableau."
      }]);
    }
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem('tri_coach_chat', JSON.stringify(messages));
    }
  }, [messages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleProfileChange = (key, value) => {
    const updated = { ...profile, [key]: value };
    setProfile(updated);
    localStorage.setItem('tri_coach_profile', JSON.stringify(updated));
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const textToSend = input;
    const newMessages = [...messages, { sender: 'user', text: textToSend }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          profile: profile
        })
      });

      const data = await res.json();
      setMessages([...newMessages, { sender: 'coach', text: data.reply }]);
    } catch (err) {
      setMessages([...newMessages, { sender: 'coach', text: "❌ Erreur de connexion avec le coach." }]);
    } finally {
      setLoading(false);
    }
  };

  const resetChat = () => {
    if (confirm("Effacer la conversation avec le coach ?")) {
      const initial = [{
        sender: 'coach',
        text: `Profil mis à jour (${profile.vma} km/h | ${profile.ftp}W). On repart à zéro. Qu'est-ce qu'on travaille ?`
      }];
      setMessages(initial);
      localStorage.setItem('tri_coach_chat', JSON.stringify(initial));
    }
  };

  // Convertisseur sommaire de tableaux Markdown vers HTML propre avec style Ultra Tour de l'Aria
  const formatCoachResponse = (text) => {
    return text.split('\n').map((line, i) => {
      // Détection des lignes de tableaux Markdown
      if (line.trim().startsWith('|')) {
        const cells = line.split('|').filter((cell) => cell.trim() !== '');
        if (line.includes('---')) return null; // Ignore les séparateurs Markdown (---)

        const isHeader = i > 0 && text.split('\n')[i - 1]?.includes('---') === false && i < 3;

        return (
          <div key={i} className="grid grid-cols-4 gap-1 text-xs py-1.5 border-b border-ria-border font-mono">
            {cells.map((c, cellIdx) => (
              <div
                key={cellIdx}
                className={`${
                  isHeader
                    ? 'text-ria-neon font-bold uppercase text-[10px]'
                    : 'text-gray-200'
                } px-1 overflow-hidden text-ellipsis`}
              >
                {c.trim()}
              </div>
            ))}
          </div>
        );
      }

      // Formatage des titres ou listes
      if (line.startsWith('#') || line.startsWith('**')) {
        return (
          <p key={i} className="font-bold text-ria-neon mt-3 mb-1 uppercase text-xs tracking-wider">
            {line.replace(/[#*]/g, '').trim()}
          </p>
        );
      }

      if (line.startsWith('- ') || line.startsWith('* ')) {
        return (
          <li key={i} className="ml-4 text-xs text-gray-300 list-disc my-0.5">
            {line.replace(/^[-*]\s*/, '')}
          </li>
        );
      }

      return line.trim() ? (
        <p key={i} className="my-1 text-xs text-gray-200 leading-relaxed">
          {line}
        </p>
      ) : null;
    });
  };

  return (
    <div className="flex flex-col h-screen bg-ria-bg text-gray-100 font-sans antialiased selection:bg-ria-neon selection:text-ria-darkText">
      
      {/* HEADER RIA */}
      <header className="flex items-center justify-between px-5 py-4 bg-ria-card/90 backdrop-blur-md border-b border-ria-border sticky top-0 z-10">
        <div className="flex items-center space-x-3">
          <div className="w-3 h-3 rounded-full bg-ria-neon animate-pulse" />
          <h1 className="text-xl font-black uppercase tracking-wider text-white">
            TRI<span className="text-ria-neon">-COACH</span>
          </h1>
        </div>

        <button
          onClick={() => setShowProfileModal(true)}
          className="flex items-center space-x-2 text-xs font-mono bg-ria-bg px-3 py-1.5 rounded-full border border-ria-border hover:border-ria-neon transition-colors"
        >
          <span className="text-gray-400">VMA</span>
          <span className="text-ria-neon font-bold">{profile.vma}</span>
          <span className="text-gray-600">|</span>
          <span className="text-gray-400">FTP</span>
          <span className="text-ria-neon font-bold">{profile.ftp}W</span>
          <span className="ml-1 text-gray-400">⚙️</span>
        </button>
      </header>

      {/* CHAT AREA */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4 max-w-3xl mx-auto w-full">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[92%] rounded-2xl px-5 py-3.5 leading-relaxed text-sm ${
                msg.sender === 'user'
                  ? 'bg-ria-neon text-ria-darkText font-semibold rounded-br-none shadow-lg shadow-ria-neon/10'
                  : 'bg-ria-card border border-ria-border text-gray-200 rounded-bl-none overflow-x-auto'
              }`}
            >
              {msg.sender === 'coach' && (
                <div className="text-[10px] font-black uppercase tracking-widest text-ria-neon mb-2">
                  COACH D3
                </div>
              )}
              {msg.sender === 'coach' ? formatCoachResponse(msg.text) : msg.text}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-ria-card border border-ria-border text-ria-neon rounded-2xl rounded-bl-none px-5 py-3 text-xs font-mono flex items-center space-x-2">
              <span className="animate-bounce">●</span>
              <span className="animate-bounce [animation-delay:0.2s]">●</span>
              <span className="animate-bounce [animation-delay:0.4s]">●</span>
              <span className="ml-2 text-gray-400">Analyse et structuration du tableau...</span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </main>

      {/* SAISIE */}
      <footer className="p-4 bg-ria-card/90 border-t border-ria-border max-w-3xl mx-auto w-full">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          className="flex space-x-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ex: Donne-moi une séance PMA vélo de 1h"
            className="flex-1 bg-ria-bg border border-ria-border focus:border-ria-neon rounded-xl px-4 py-3 text-sm text-white focus:outline-none placeholder-gray-500 transition-all"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-ria-neon hover:bg-ria-neonHover text-ria-darkText font-black px-5 py-3 rounded-xl uppercase tracking-wider text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
          >
            Envoyer
          </button>
        </form>
      </footer>

      {/* MODALE REGLAGES */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-ria-card border border-ria-border w-full max-w-md rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-ria-border pb-3">
              <h2 className="text-lg font-black uppercase tracking-wider text-white">
                MÉTRIQUES <span className="text-ria-neon">ATHLÈTE</span>
              </h2>
              <button
                onClick={() => setShowProfileModal(false)}
                className="text-gray-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-gray-400 font-mono mb-1">Nom / Pseudo</label>
                <input
                  type="text"
                  value={profile.name}
                  onChange={(e) => handleProfileChange('name', e.target.value)}
                  className="w-full bg-ria-bg border border-ria-border rounded-lg p-2.5 text-white font-bold focus:border-ria-neon focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-gray-400 font-mono mb-1">Poids (kg)</label>
                <input
                  type="number"
                  value={profile.weight}
                  onChange={(e) => handleProfileChange('weight', Number(e.target.value))}
                  className="w-full bg-ria-bg border border-ria-border rounded-lg p-2.5 text-white font-bold focus:border-ria-neon focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-ria-neon font-mono mb-1">VMA (km/h)</label>
                <input
                  type="number"
                  step="0.5"
                  value={profile.vma}
                  onChange={(e) => handleProfileChange('vma', Number(e.target.value))}
                  className="w-full bg-ria-bg border border-ria-border rounded-lg p-2.5 text-white font-bold focus:border-ria-neon focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-ria-neon font-mono mb-1">FTP (Watts)</label>
                <input
                  type="number"
                  value={profile.ftp}
                  onChange={(e) => handleProfileChange('ftp', Number(e.target.value))}
                  className="w-full bg-ria-bg border border-ria-border rounded-lg p-2.5 text-white font-bold focus:border-ria-neon focus:outline-none"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-gray-400 font-mono mb-1">Ref Natation (100m)</label>
                <input
                  type="text"
                  value={profile.nat100}
                  placeholder="ex: 1:38"
                  onChange={(e) => handleProfileChange('nat100', e.target.value)}
                  className="w-full bg-ria-bg border border-ria-border rounded-lg p-2.5 text-white font-bold focus:border-ria-neon focus:outline-none"
                />
              </div>
            </div>

            <div className="flex space-x-3 pt-2">
              <button
                onClick={resetChat}
                className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-bold py-2.5 rounded-xl text-xs uppercase"
              >
                RAZ Discussion
              </button>
              <button
                onClick={() => setShowProfileModal(false)}
                className="flex-1 bg-ria-neon hover:bg-ria-neonHover text-ria-darkText font-black py-2.5 rounded-xl text-xs uppercase"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
