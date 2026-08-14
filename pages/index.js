import { useState, useRef, useEffect } from 'react';

export default function Home() {
  const [messages, setMessages] = useState([
    {
      sender: 'coach',
      text: "Salut Marin ! Profil chargé. VMA : 20 km/h | FTP : 350W. On part sur du direct et du cash : pas de volume poubelle. Qu'est-ce qu'on travaille aujourd'hui ?"
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef(null);

  // Auto-scroll vers le bas
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = async (customText) => {
    const textToSend = customText || input;
    if (!textToSend.trim() || loading) return;

    const newMessages = [...messages, { sender: 'user', text: textToSend }];
    setMessages(newMessages);
    if (!customText) setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          profile: { name: 'Marin', vma: 20, ftp: 350, weight: 87, nat100: '1:38' }
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

  return (
    <div className="flex flex-col h-screen bg-ria-bg text-gray-100 font-sans antialiased selection:bg-ria-neon selection:text-ria-darkText">
      
      {/* HEADER RIA STYLE */}
      <header className="flex items-center justify-between px-5 py-4 bg-ria-card/80 backdrop-blur-md border-b border-ria-border sticky top-0 z-10">
        <div className="flex items-center space-x-3">
          <div className="w-3 h-3 rounded-full bg-ria-neon animate-pulse" />
          <h1 className="text-xl font-black uppercase tracking-wider text-white">
            TRI<span className="text-ria-neon">-COACH</span>
          </h1>
        </div>
        <div className="flex items-center space-x-2 text-xs font-mono bg-ria-bg px-3 py-1.5 rounded-full border border-ria-border">
          <span className="text-gray-400">VMA</span>
          <span className="text-ria-neon font-bold">20</span>
          <span className="text-gray-600">|</span>
          <span className="text-gray-400">FTP</span>
          <span className="text-ria-neon font-bold">350W</span>
        </div>
      </header>

      {/* ZONE DE CHAT */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4 max-w-3xl mx-auto w-full">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-5 py-3.5 leading-relaxed text-sm ${
                msg.sender === 'user'
                  ? 'bg-ria-neon text-ria-darkText font-medium rounded-br-none shadow-lg shadow-ria-neon/10'
                  : 'bg-ria-card border border-ria-border text-gray-200 rounded-bl-none whitespace-pre-line'
              }`}
            >
              {msg.sender === 'coach' && (
                <div className="text-[10px] font-black uppercase tracking-widest text-ria-neon mb-1">
                  COACH D3
                </div>
              )}
              {msg.text}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-ria-card border border-ria-border text-ria-neon rounded-2xl rounded-bl-none px-5 py-3 text-xs font-mono flex items-center space-x-2">
              <span className="animate-bounce">●</span>
              <span className="animate-bounce [animation-delay:0.2s]">●</span>
              <span className="animate-bounce [animation-delay:0.4s]">●</span>
              <span className="ml-2 text-gray-400">Analyse de la séance...</span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </main>

      {/* QUICK ACTIONS & BARRE DE SAISIE */}
      <footer className="p-4 bg-ria-card/90 border-t border-ria-border max-w-3xl mx-auto w-full space-y-3">
        {/* Raccourcis tactiques */}
        <div className="flex space-x-2 overflow-x-auto pb-1 scrollbar-none text-xs">
          {[
            "⚡ Séance CAP 5km D3",
            "🚴‍♂️ PMA / Seuil Vélo",
            "🏊‍♂️ Spé Natation 100m",
            "🛡️ Bilan Fatigue / RPE"
          ].map((prompt, i) => (
            <button
              key={i}
              onClick={() => sendMessage(prompt)}
              className="px-3 py-1.5 bg-ria-bg border border-ria-border hover:border-ria-neon/50 text-gray-300 rounded-lg whitespace-nowrap transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Input Text */}
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
            placeholder="Pose ta question ou demande une séance..."
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
    </div>
  );
}
