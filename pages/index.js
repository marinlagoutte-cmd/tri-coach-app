import { useState, useRef, useEffect } from 'react';

export default function Home() {
  // 1. État du profil & plan d'entraînement
  const [profile, setProfile] = useState({
    name: 'Marin',
    vma: 20,
    ftp: 350,
    weight: 87,
    nat100: '1:38'
  });

  // État de l'objectif sur 3 mois (Inspiré de la maquette)
  const [trainingPlan, setTrainingPlan] = useState({
    title: 'Triathlon M - Vendôme',
    date: '2025-05-24',
    daysLeft: 88,
    targetTime: '2h36 min',
    splits: { nat: '0h31', bike: '1h18', run: '0h47' },
    terrain: 'Vallonné',
    drafting: false,
    cycles: [
      { id: 1, name: 'Cycle 1 - Base aérobie & technique', dates: '6 janv. au 9 név', active: false },
      { id: 2, name: 'Cycle 2 - Développement puissance & intensité', dates: '10 fev. au 16 mars', active: false },
      { id: 3, name: 'Cycle 3 - Spécificité triathlon', dates: '17 mars au 27 avril', active: true }
    ]
  });

  // Semaine active (Rolling Window 2 semaines)
  const [activeWeek, setActiveWeek] = useState('N'); // 'N' ou 'N+1'

  // Exemple de séances sur 2 semaines (Générées / Modifiables)
  const [workouts, setWorkouts] = useState({
    N: [
      { id: 'w1', day: 'Lundi', type: 'NATATION', title: 'Aérobie & Technique', duration: '45 min', intensity: 'RPE 6', modified: false, desc: '10x100m Dépassement CSS, récupration 15s' },
      { id: 'w2', day: 'Mardi', type: 'CYCLISME', title: 'PMA Courte (30/30)', duration: '1h15', intensity: '380W', modified: true, desc: '2 blocs de 10x (30s à 110% FTP / 30s V2)' },
      { id: 'w3', day: 'Mercredi', type: 'REPOS', title: 'Récupération Active', duration: '-', intensity: '-', modified: false, desc: 'Stretching & Pression mousse' },
      { id: 'w4', day: 'Jeudi', type: 'C.A.P', title: 'Seuil Inversé 5k', duration: '50 min', intensity: '3:45/km', modified: false, desc: '3x2000m Allure Seuil D3, récup 2min trot' },
      { id: 'w5', day: 'Vendredi', type: 'NATATION', title: 'Intensité Eau Libre', duration: '50 min', intensity: 'RPE 8', modified: false, desc: 'Corps de séance avec changements de rythme' },
      { id: 'w6', day: 'Samedi', type: 'CYCLISME', title: 'Sortie Longue Spécifique', duration: '2h30', intensity: '260W', modified: false, desc: 'Sortie avec 3x15min Allure Race M' },
      { id: 'w7', day: 'Dimanche', type: 'ENCHAÎNEMENT', title: 'Brick vélo/CAP', duration: '1h30', intensity: 'RPE 7.5', modified: false, desc: '1h15 Vélo W' }
    ],
    'N+1': [
      { id: 'w8', day: 'Lundi', type: 'NATATION', title: 'Vitesse & Educatifs', duration: '40 min', intensity: 'RPE 7', modified: false, desc: 'Focus fréquences de bras' },
      { id: 'w9', day: 'Mardi', type: 'CYCLISME', title: 'Tempo Sweetspot', duration: '1h30', intensity: '310W', modified: false, desc: '3x15min à 90% FTP' },
      { id: 'w10', day: 'Mercredi', type: 'REPOS', title: 'Repos complet', duration: '-', intensity: '-', modified: false, desc: 'Sommeil & Hydratation' },
      { id: 'w11', day: 'Jeudi', type: 'C.A.P', title: 'VMA Courte sur Piste', duration: '45 min', intensity: '21 km/h', modified: false, desc: '12x400m à 100% VMA' },
      { id: 'w12', day: 'Vendredi', type: 'NATATION', title: 'Endurance Continue', duration: '1h00', intensity: 'RPE 5', modified: false, desc: '2000m continu avec pull/plaquettes' },
      { id: 'w13', day: 'Samedi', type: 'CYCLISME', title: 'Over-Under Watts', duration: '2h00', intensity: 'Variable', modified: false, desc: '4x(2min @ 370W / 3min @ 280W)' },
      { id: 'w14', day: 'Dimanche', type: 'C.A.P', title: 'Sortie Longue Vallonnée', duration: '1h20', intensity: '4:15/km', modified: false, desc: 'Travail musculaire en côte' }
    ]
  });

  // États pour les modales
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);

  // Formulaire du questionnaire
  const [questData, setQuestData] = useState({
    sports: ['NAT', 'VELO', 'CAP'],
    targetDate: '2026-11-15',
    hoursPerWeek: 10,
    offDays: 'Mercredi',
    targetGoal: 'Sous les 2h15'
  });

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
        text: "Salut Marin ! Je suis branché sur ton plan d'entraînement sur 3 mois. Tu peux consulter les séances des 2 semaines à venir. Dis-moi si tu veux ajuster une séance !"
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

  const formatCoachResponse = (text) => {
    const lines = text.split('\n');
    const elements = [];
    let tableRows = [];
    let inTable = false;

    lines.forEach((line, i) => {
      const trimmed = line.trim();

      if (trimmed.startsWith('|')) {
        inTable = true;
        if (!trimmed.includes('---')) {
          const cells = trimmed.split('|').filter(c => c.trim() !== '');
          tableRows.push(cells);
        }
      } else {
        if (inTable && tableRows.length > 0) {
          const headers = tableRows[0];
          const body = tableRows.slice(1);

          elements.push(
            <div key={`table-${i}`} className="my-3 overflow-x-auto rounded-xl border border-ria-border bg-ria-bg p-1">
              <table className="w-full text-left border-collapse min-w-[320px]">
                <thead>
                  <tr className="border-b border-ria-border bg-ria-card">
                    {headers.map((h, idx) => (
                      <th key={idx} className="p-2 text-[11px] font-black uppercase text-ria-neon font-mono">
                        {h.trim()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ria-border/50 text-xs">
                  {body.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-ria-card/40 transition-colors">
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="p-2 text-gray-200 font-mono text-[11px]">
                          {cell.trim()}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          tableRows = [];
          inTable = false;
        }

        if (trimmed.startsWith('#') || trimmed.startsWith('**')) {
          elements.push(
            <p key={i} className="font-bold text-ria-neon mt-3 mb-1 uppercase text-xs tracking-wider">
              {trimmed.replace(/[#*]/g, '').trim()}
            </p>
          );
        } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          elements.push(
            <li key={i} className="ml-4 text-xs text-gray-300 list-disc my-0.5">
              {trimmed.replace(/^[-*]\s*/, '')}
            </li>
          );
        } else if (trimmed) {
          elements.push(
            <p key={i} className="my-1 text-xs text-gray-200 leading-relaxed">
              {trimmed}
            </p>
          );
        }
      }
    });

    return elements;
  };

  return (
    <div className="flex flex-col min-h-screen bg-ria-bg text-gray-100 font-sans antialiased pb-10">
      
      {/* HEADER RIA */}
      <header className="flex items-center justify-between px-5 py-4 bg-ria-card/90 backdrop-blur-md border-b border-ria-border sticky top-0 z-20">
        <div className="flex items-center space-x-3">
          <div className="w-3 h-3 rounded-full bg-ria-neon animate-pulse" />
          <h1 className="text-xl font-black uppercase tracking-wider text-white">
            TRI<span className="text-ria-neon">-COACH</span>
          </h1>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowQuestionnaire(true)}
            className="text-xs font-bold uppercase bg-ria-neon text-ria-darkText px-3 py-1.5 rounded-full hover:bg-ria-neonHover transition-all"
          >
            + Nouveau Plan
          </button>
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
        </div>
      </header>

      <main className="max-w-4xl mx-auto w-full p-4 space-y-6">

        {/* 1. CARTE OBJECTIF PRINCIPAL (Style adapté de l'image) */}
        <section className="bg-ria-card border border-ria-border rounded-2xl p-5 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-gradient-to-l from-ria-neon/20 to-transparent w-40 h-full pointer-events-none" />
          
          <div className="flex justify-between items-start mb-4">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-ria-neon">Objectif Majeur</span>
              <h2 className="text-2xl font-black text-white uppercase tracking-wide mt-0.5">{trainingPlan.title}</h2>
              <p className="text-xs font-mono text-gray-400">{trainingPlan.date}</p>
            </div>
            <div className="bg-ria-bg border border-ria-border px-3 py-1.5 rounded-xl text-right">
              <span className="text-[10px] font-mono text-gray-400 block">COMPTE À REBOURS</span>
              <span className="text-sm font-black text-ria-neon font-mono">J-{trainingPlan.daysLeft}</span>
            </div>
          </div>

          <div className="my-5 bg-ria-bg/60 border border-ria-border/60 rounded-xl p-4">
            <div className="text-xs text-gray-400 font-mono mb-2">CIBLE GLOBALE</div>
            <div className="text-3xl font-black text-white font-mono mb-4">{trainingPlan.targetTime}</div>

            {/* SPLITS PAR DISCIPLINE */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-ria-card border border-ria-border rounded-lg p-2.5 text-center">
                <span className="text-[10px] text-gray-400 block font-mono">🏊‍♂️ NATATION</span>
                <span className="text-sm font-bold text-ria-neon font-mono">{trainingPlan.splits.nat}</span>
              </div>
              <div className="bg-ria-card border border-ria-border rounded-lg p-2.5 text-center">
                <span className="text-[10px] text-gray-400 block font-mono">🚴‍♂️ CYCLISME</span>
                <span className="text-sm font-bold text-ria-neon font-mono">{trainingPlan.splits.bike}</span>
              </div>
              <div className="bg-ria-card border border-ria-border rounded-lg p-2.5 text-center">
                <span className="text-[10px] text-gray-400 block font-mono">🏃‍♂️ C.A.P</span>
                <span className="text-sm font-bold text-ria-neon font-mono">{trainingPlan.splits.run}</span>
              </div>
            </div>
          </div>

          {/* DÉCOUPAGE EN CYCLES (Macrocycles sur 3 mois) */}
          <div className="space-y-2">
            <span className="text-xs font-mono text-gray-400 uppercase tracking-wider block mb-2">Plan de la préparation (3 Mois)</span>
            {trainingPlan.cycles.map(c => (
              <div key={c.id} className={`p-3 rounded-xl border text-xs flex justify-between items-center transition-all ${c.active ? 'bg-ria-neon/10 border-ria-neon text-white' : 'bg-ria-bg/40 border-ria-border/40 text-gray-400'}`}>
                <div>
                  <div className="font-bold uppercase tracking-wide">{c.name}</div>
                  <div className="text-[10px] font-mono text-gray-500">{c.dates}</div>
                </div>
                {c.active && <span className="bg-ria-neon text-ria-darkText text-[9px] font-black px-2 py-0.5 rounded uppercase">En Cours</span>}
              </div>
            ))}
          </div>
        </section>

        {/* 2. GESTION DES 2 SEMAINES GLISSANTES (Rolling Window N & N+1) */}
        <section className="bg-ria-card border border-ria-border rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex justify-between items-center border-b border-ria-border pb-3">
            <div>
              <h3 className="text-lg font-black uppercase text-white">CALENDRIER <span className="text-ria-neon">SÉANCES</span></h3>
              <p className="text-xs text-gray-400 font-mono">2 semaines de visibilité • Auto-génération le dimanche</p>
            </div>

            {/* Selector de semaine */}
            <div className="flex bg-ria-bg border border-ria-border rounded-lg p-1 text-xs font-mono">
              <button
                onClick={() => setActiveWeek('N')}
                className={`px-3 py-1 rounded-md font-bold transition-all ${activeWeek === 'N' ? 'bg-ria-neon text-ria-darkText' : 'text-gray-400 hover:text-white'}`}
              >
                Semaine N (En cours)
              </button>
              <button
                onClick={() => setActiveWeek('N+1')}
                className={`px-3 py-1 rounded-md font-bold transition-all ${activeWeek === 'N+1' ? 'bg-ria-neon text-ria-darkText' : 'text-gray-400 hover:text-white'}`}
              >
                Semaine N+1
              </button>
            </div>
          </div>

          {/* LISTE DES SEMAINES */}
          <div className="space-y-2">
            {workouts[activeWeek].map((w) => (
              <div key={w.id} className="bg-ria-bg border border-ria-border/70 hover:border-ria-neon/40 rounded-xl p-3 flex flex-col md:flex-row md:items-center justify-between transition-all space-y-2 md:space-y-0">
                <div className="flex items-center space-x-3">
                  <div className="w-20 font-mono text-xs font-bold text-gray-400 uppercase">{w.day}</div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-black uppercase tracking-wider text-ria-neon">{w.title}</span>
                      {w.modified && (
                        <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded">
                          MODIFIÉ VIA CHAT
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{w.desc}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-4 font-mono text-xs self-end md:self-auto">
                  <span className="bg-ria-card px-2.5 py-1 rounded-md border border-ria-border text-gray-300">{w.type}</span>
                  <span className="text-gray-400">{w.duration}</span>
                  <span className="text-ria-neon font-bold">{w.intensity}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 3. CHAT COACH POUR AJUSTEMENT & CONSEILS */}
        <section className="bg-ria-card border border-ria-border rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center space-x-2 border-b border-ria-border pb-3">
            <span className="text-ria-neon font-mono text-lg">💬</span>
            <h3 className="text-lg font-black uppercase text-white">INTERACTION <span className="text-ria-neon">COACHING</span></h3>
          </div>

          <div className="max-h-80 overflow-y-auto space-y-3 p-2">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                  msg.sender === 'user' ? 'bg-ria-neon text-ria-darkText font-bold' : 'bg-ria-bg border border-ria-border text-gray-200'
                }`}>
                  {msg.sender === 'coach' ? formatCoachResponse(msg.text) : msg.text}
                </div>
              </div>
            ))}
            {loading && <div className="text-xs font-mono text-ria-neon animate-pulse">Coach en train d'analyser...</div>}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="flex space-x-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ex: 'Décale la séance vélo de samedi à dimanche' ou 'J'ai mal au mollet'"
              className="flex-1 bg-ria-bg border border-ria-border focus:border-ria-neon rounded-xl px-4 py-3 text-xs text-white focus:outline-none"
            />
            <button type="submit" disabled={loading || !input.trim()} className="bg-ria-neon text-ria-darkText font-black px-5 py-3 rounded-xl uppercase text-xs">
              Envoyer
            </button>
          </form>
        </section>

      </main>

      {/* QUESTIONNAIRE WIZARD (Modale d'Onboarding Plan 3 mois) */}
      {showQuestionnaire && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-ria-card border border-ria-border w-full max-w-lg rounded-2xl p-6 space-y-5">
            <div className="flex justify-between items-center border-b border-ria-border pb-3">
              <h3 className="text-md font-black uppercase text-white">CRÉATION DU PLAN <span className="text-ria-neon">(Étape {wizardStep}/3)</span></h3>
              <button onClick={() => setShowQuestionnaire(false)} className="text-gray-400 font-bold">✕</button>
            </div>

            {wizardStep === 1 && (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-gray-400 mb-1 font-mono">Disciplines préparées</label>
                  <div className="flex space-x-2">
                    {['NAT', 'VELO', 'CAP'].map((s) => (
                      <button key={s} className="flex-1 bg-ria-bg border border-ria-neon text-ria-neon font-bold py-2 rounded-lg">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-gray-400 mb-1 font-mono">Date de l'objectif (dans 3 mois max)</label>
                  <input type="date" value={questData.targetDate} onChange={(e) => setQuestData({...questData, targetDate: e.target.value})} className="w-full bg-ria-bg border border-ria-border rounded-lg p-2.5 text-white font-bold" />
                </div>
              </div>
            )}

            {wizardStep === 2 && (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-gray-400 mb-1 font-mono">Volume horaire hebdo disponible</label>
                  <input type="number" value={questData.hoursPerWeek} onChange={(e) => setQuestData({...questData, hoursPerWeek: Number(e.target.value)})} className="w-full bg-ria-bg border border-ria-border rounded-lg p-2.5 text-white font-bold" />
                </div>
                <div>
                  <label className="block text-gray-400 mb-1 font-mono">Jour de repos obligatoire</label>
                  <input type="text" value={questData.offDays} onChange={(e) => setQuestData({...questData, offDays: e.target.value})} className="w-full bg-ria-bg border border-ria-border rounded-lg p-2.5 text-white font-bold" />
                </div>
              </div>
            )}

            {wizardStep === 3 && (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-gray-400 mb-1 font-mono">Cible / Objectif chrono</label>
                  <input type="text" value={questData.targetGoal} onChange={(e) => setQuestData({...questData, targetGoal: e.target.value})} className="w-full bg-ria-bg border border-ria-border rounded-lg p-2.5 text-white font-bold" />
                </div>
                <p className="text-gray-400 italic">L'IA va générer les 3 cycles ainsi que les 14 premières séances adaptées à vos métriques (VMA {profile.vma} / FTP {profile.ftp}W).</p>
              </div>
            )}

            <div className="flex justify-between pt-2">
              {wizardStep > 1 && (
                <button onClick={() => setWizardStep(wizardStep - 1)} className="bg-ria-bg border border-ria-border text-white font-bold px-4 py-2 rounded-xl text-xs uppercase">
                  Retour
                </button>
              )}
              {wizardStep < 3 ? (
                <button onClick={() => setWizardStep(wizardStep + 1)} className="bg-ria-neon text-ria-darkText font-black px-5 py-2 rounded-xl uppercase text-xs ml-auto">
                  Suivant
                </button>
              ) : (
                <button onClick={() => setShowQuestionnaire(false)} className="bg-ria-neon text-ria-darkText font-black px-5 py-2 rounded-xl uppercase text-xs ml-auto">
                  Générer le Plan 3 Mois
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODALE REGLAGES PROFIL */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-ria-card border border-ria-border w-full max-w-md rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-ria-border pb-3">
              <h2 className="text-lg font-black uppercase text-white">MÉTRIQUES <span className="text-ria-neon">ATHLÈTE</span></h2>
              <button onClick={() => setShowProfileModal(false)} className="text-gray-400 font-bold">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-gray-400 font-mono mb-1">VMA (km/h)</label>
                <input type="number" step="0.5" value={profile.vma} onChange={(e) => handleProfileChange('vma', Number(e.target.value))} className="w-full bg-ria-bg border border-ria-border rounded-lg p-2.5 text-white font-bold" />
              </div>
              <div>
                <label className="block text-gray-400 font-mono mb-1">FTP (Watts)</label>
                <input type="number" value={profile.ftp} onChange={(e) => handleProfileChange('ftp', Number(e.target.value))} className="w-full bg-ria-bg border border-ria-border rounded-lg p-2.5 text-white font-bold" />
              </div>
            </div>
            <button onClick={() => setShowProfileModal(false)} className="w-full bg-ria-neon text-ria-darkText font-black py-2.5 rounded-xl text-xs uppercase">
              Enregistrer
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
