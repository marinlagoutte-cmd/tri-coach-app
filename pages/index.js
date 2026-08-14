import { useState, useRef, useEffect } from 'react';
import CalendarView from '../components/CalendarView';

export default function Home() {
  const [profile, setProfile] = useState({
    name: 'Marin',
    vma: 20,
    ftp: 350,
    weight: 87,
    nat100: '1:38'
  });

  const [trainingPlan, setTrainingPlan] = useState({
    title: 'Triathlon M - Vendôme',
    date: '2025-05-24',
    daysLeft: 88,
    targetTime: '2h36 min',
    splits: { nat: '0h31', bike: '1h18', run: '0h47' },
    terrain: 'Vallonné',
    drafting: false,
    cycles: [
      { id: 1, name: 'Cycle 1 - Base aérobie & technique', dates: '6 janv. au 9 fév', active: false },
      { id: 2, name: 'Cycle 2 - Développement puissance & intensité', dates: '10 fév. au 16 mars', active: false },
      { id: 3, name: 'Cycle 3 - Spécificité triathlon', dates: '17 mars au 27 avril', active: true }
    ]
  });

  const [activeWeek, setActiveWeek] = useState('N');
  const [view, setView] = useState('dashboard'); // 'dashboard' | 'calendar'
  const [expandedCycle, setExpandedCycle] = useState(
    trainingPlan.cycles.find(c => c.active)?.id ?? null
  );

  const [workouts, setWorkouts] = useState({
    N: [
      { id: 'w1', day: 'Lundi', type: 'NATATION', title: 'Aérobie & Technique', duration: '45 min', intensity: 'RPE 6', modified: false, desc: '10x100m Dépassement CSS, récupération 15s' },
      { id: 'w2', day: 'Mardi', type: 'CYCLISME', title: 'PMA Courte (30/30)', duration: '1h15', intensity: '380W', modified: true, desc: '2 blocs de 10x (30s à 110% FTP / 30s V2)' },
      { id: 'w3', day: 'Mercredi', type: 'REPOS', title: 'Récupération Active', duration: '-', intensity: '-', modified: false, desc: 'Stretching & Pression mousse' },
      { id: 'w4', day: 'Jeudi', type: 'C.A.P', title: 'Seuil Inversé 5k', duration: '50 min', intensity: '3:45/km', modified: false, desc: '3x2000m Allure Seuil D3, récup 2min trot' },
      { id: 'w5', day: 'Vendredi', type: 'NATATION', title: 'Intensité Eau Libre', duration: '50 min', intensity: 'RPE 8', modified: false, desc: 'Corps de séance avec changements de rythme' },
      { id: 'w6', day: 'Samedi', type: 'CYCLISME', title: 'Sortie Longue Spécifique', duration: '2h30', intensity: '260W', modified: false, desc: 'Sortie avec 3x15min Allure Race M' },
      { id: 'w7', day: 'Dimanche', type: 'ENCHAÎNEMENT', title: 'Brick vélo/CAP', duration: '1h30', intensity: 'RPE 7.5', modified: false, desc: '1h15 Vélo' }
    ],
    'N+1': [
      { id: 'w8', day: 'Lundi', type: 'NATATION', title: 'Vitesse & Éducatifs', duration: '40 min', intensity: 'RPE 7', modified: false, desc: 'Focus fréquences de bras' },
      { id: 'w9', day: 'Mardi', type: 'CYCLISME', title: 'Tempo Sweetspot', duration: '1h30', intensity: '310W', modified: false, desc: '3x15min à 90% FTP' },
      { id: 'w10', day: 'Mercredi', type: 'REPOS', title: 'Repos complet', duration: '-', intensity: '-', modified: false, desc: 'Sommeil & Hydratation' },
      { id: 'w11', day: 'Jeudi', type: 'C.A.P', title: 'VMA Courte sur Piste', duration: '45 min', intensity: '21 km/h', modified: false, desc: '12x400m à 100% VMA' },
      { id: 'w12', day: 'Vendredi', type: 'NATATION', title: 'Endurance Continue', duration: '1h00', intensity: 'RPE 5', modified: false, desc: '2000m continu avec pull/plaquettes' },
      { id: 'w13', day: 'Samedi', type: 'CYCLISME', title: 'Over-Under Watts', duration: '2h00', intensity: 'Variable', modified: false, desc: '4x(2min @ 370W / 3min @ 280W)' },
      { id: 'w14', day: 'Dimanche', type: 'C.A.P', title: 'Sortie Longue Vallonnée', duration: '1h20', intensity: '4:15/km', modified: false, desc: 'Travail musculaire en côte' }
    ]
  });

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);

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
        body: JSON.stringify({ message: textToSend, profile, workouts })
      });
      const data = await res.json();
      setMessages([...newMessages, { sender: 'coach', text: data.reply }]);
      if (data.updatedWorkouts) {
        setWorkouts(data.updatedWorkouts);
      }
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
            <div key={`table-${i}`} className="my-3 overflow-x-auto rounded-xl border border-ria-border bg-white p-1">
              <table className="w-full text-left border-collapse min-w-[320px]">
                <thead>
                  <tr className="border-b border-ria-border bg-ria-bg">
                    {headers.map((h, idx) => (
                      <th key={idx} className="p-2 text-[11px] font-black uppercase text-ria-neon font-mono">
                        {h.trim()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ria-border text-xs">
                  {body.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-ria-bg/60 transition-colors">
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="p-2 text-ria-darkText font-mono text-[11px]">
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
            <li key={i} className="ml-4 text-xs text-ria-darkText list-disc my-0.5">
              {trimmed.replace(/^[-*]\s*/, '')}
            </li>
          );
        } else if (trimmed) {
          elements.push(
            <p key={i} className="my-1 text-xs text-ria-darkText leading-relaxed">
              {trimmed}
            </p>
          );
        }
      }
    });

    return elements;
  };

  return (
    <div className="flex flex-col min-h-screen bg-ria-bg text-ria-darkText font-sans antialiased pb-10">

      {/* HEADER */}
      <header className="flex items-center justify-between px-5 py-4 bg-white/90 backdrop-blur-md border-b border-ria-border sticky top-0 z-20">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#FF7A59] to-[#3A5C99] flex items-center justify-center text-white text-xs font-black">
            TC
          </div>
          <h1 className="text-lg font-black tracking-tight">
            TRI<span className="text-ria-neon">-COACH</span>
          </h1>
        </div>

        <div className="flex items-center space-x-2">
          <div className="flex bg-ria-bg border border-ria-border rounded-full p-1 text-[11px] font-semibold mr-1">
            <button
              onClick={() => setView('dashboard')}
              className={`px-3 py-1 rounded-full transition-all ${view === 'dashboard' ? 'bg-ria-neon text-white' : 'text-ria-sub'}`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setView('calendar')}
              className={`px-3 py-1 rounded-full transition-all ${view === 'calendar' ? 'bg-ria-neon text-white' : 'text-ria-sub'}`}
            >
              Calendrier
            </button>
          </div>
          <button
            onClick={() => setShowQuestionnaire(true)}
            className="text-[11px] font-bold uppercase bg-ria-neon text-white px-3 py-1.5 rounded-full hover:bg-ria-neonHover transition-all"
          >
            + Nouveau plan
          </button>
          <button
            onClick={() => setShowProfileModal(true)}
            className="flex items-center space-x-2 text-[11px] font-mono bg-ria-bg px-3 py-1.5 rounded-full border border-ria-border hover:border-ria-neon transition-colors"
          >
            <span className="text-ria-sub">VMA</span>
            <span className="text-ria-neon font-bold">{profile.vma}</span>
            <span className="text-ria-border">|</span>
            <span className="text-ria-sub">FTP</span>
            <span className="text-ria-neon font-bold">{profile.ftp}W</span>
            <span className="ml-1">⚙️</span>
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto w-full p-4 space-y-6">
        {view === 'calendar' ? (
          <CalendarView workouts={workouts} />
        ) : (
          <>
            {/* 1. CARTE OBJECTIF */}
            <section className="rounded-3xl overflow-hidden shadow-lg border border-ria-border">
              <div className="bg-gradient-to-br from-[#FF7A59] via-[#F2555A] to-[#3A5C99] px-5 pt-5 pb-12 text-white">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-widest text-white/90">Objectif</span>
                  <span className="text-xs font-mono font-bold bg-white/20 px-2.5 py-1 rounded-full">
                    J-{trainingPlan.daysLeft}
                  </span>
                </div>
                <div className="mt-3 h-1.5 w-full bg-white/25 rounded-full overflow-hidden">
                  <div className="h-full bg-white rounded-full" style={{ width: '35%' }} />
                </div>
              </div>

              <div className="-mt-7 mx-3 mb-3 bg-white rounded-2xl shadow-md border border-ria-border p-5 relative z-10">
                <div className="flex items-center space-x-3 pb-4 border-b border-ria-border">
                  <div className="w-10 h-10 rounded-xl bg-ria-bg flex items-center justify-center text-lg">🏁</div>
                  <div>
                    <h2 className="text-sm font-bold">{trainingPlan.title}</h2>
                    <p className="text-xs text-ria-sub">{trainingPlan.date}</p>
                  </div>
                </div>

                <div className="py-4">
                  <span className="text-[11px] text-ria-sub uppercase font-semibold tracking-wide">Objectif</span>
                  <div className="text-3xl font-black mt-1">{trainingPlan.targetTime}</div>
                </div>

                <div className="grid grid-cols-3 gap-2 pb-4">
                  {[
                    { icon: '🏊', value: trainingPlan.splits.nat },
                    { icon: '🚴', value: trainingPlan.splits.bike },
                    { icon: '🏃', value: trainingPlan.splits.run }
                  ].map((s, idx) => (
                    <div key={idx} className="bg-ria-bg rounded-2xl py-3 flex flex-col items-center border border-ria-border">
                      <span className="text-lg">{s.icon}</span>
                      <span className="text-xs font-bold mt-1 font-mono">{s.value}</span>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 py-3 border-t border-ria-border text-xs">
                  <div className="flex justify-between">
                    <span className="text-ria-sub">Début de la préparation</span>
                    <span className="font-semibold">{trainingPlan.date}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ria-sub">Caractéristiques du triathlon</span>
                    <span className="font-semibold">{trainingPlan.terrain}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ria-sub">Drafting autorisé ?</span>
                    <span className="font-semibold">{trainingPlan.drafting ? 'Oui' : 'Non'}</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-ria-border">
                  <span className="text-[11px] text-ria-sub uppercase font-semibold tracking-wide">
                    Plan de la préparation annuelle
                  </span>
                  <div className="mt-2 space-y-2">
                    {trainingPlan.cycles.map((c) => {
                      const isOpen = expandedCycle === c.id;
                      return (
                        <div key={c.id} className="border border-ria-border rounded-xl overflow-hidden">
                          <button
                            onClick={() => setExpandedCycle(isOpen ? null : c.id)}
                            className="w-full flex items-center justify-between px-3 py-2.5 text-left bg-ria-bg/60 hover:bg-ria-bg transition-colors"
                          >
                            <div>
                              <div className="text-[10px] text-ria-sub font-mono">
                                Cycle {c.id} · {c.dates}
                              </div>
                              <div className="text-xs font-bold">
                                {c.name.replace(/^Cycle \d+ - /, '')}
                              </div>
                            </div>
                            <span className={`text-ria-neon transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                              ⌄
                            </span>
                          </button>
                          {isOpen && (
                            <div className="px-3 py-2.5 text-xs text-ria-sub bg-white border-t border-ria-border">
                              {c.name}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            {/* 2. CALENDRIER SÉANCES (résumé 2 semaines) */}
            <section className="bg-white border border-ria-border rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex justify-between items-center border-b border-ria-border pb-3">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide">
                    Calendrier <span className="text-ria-neon">séances</span>
                  </h3>
                  <p className="text-[11px] text-ria-sub font-mono">
                    2 semaines de visibilité · Auto-génération le dimanche
                  </p>
                </div>
                <div className="flex bg-ria-bg border border-ria-border rounded-lg p-1 text-[11px] font-semibold">
                  <button
                    onClick={() => setActiveWeek('N')}
                    className={`px-3 py-1 rounded-md transition-all ${activeWeek === 'N' ? 'bg-ria-neon text-white' : 'text-ria-sub hover:text-ria-darkText'}`}
                  >
                    Semaine N
                  </button>
                  <button
                    onClick={() => setActiveWeek('N+1')}
                    className={`px-3 py-1 rounded-md transition-all ${activeWeek === 'N+1' ? 'bg-ria-neon text-white' : 'text-ria-sub hover:text-ria-darkText'}`}
                  >
                    Semaine N+1
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {workouts[activeWeek]?.map((w) => (
                  <div
                    key={w.id}
                    className="bg-ria-bg border border-ria-border hover:border-ria-neon/40 rounded-xl p-3 flex flex-col md:flex-row md:items-center justify-between transition-all space-y-2 md:space-y-0"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-16 text-[11px] font-bold text-ria-sub uppercase">{w.day}</div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-bold">{w.title}</span>
                          {w.modified && (
                            <span className="bg-amber-100 text-amber-700 border border-amber-200 text-[9px] font-bold px-1.5 py-0.5 rounded">
                              MODIFIÉ VIA CHAT
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-ria-sub">{w.desc}</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 text-[11px] font-mono self-end md:self-auto">
                      <span className="bg-white px-2 py-1 rounded-md border border-ria-border text-ria-sub">{w.type}</span>
                      <span className="text-ria-sub">{w.duration}</span>
                      <span className="text-ria-neon font-bold">{w.intensity}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 3. CHAT COACH */}
            <section className="bg-white border border-ria-border rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center space-x-2 border-b border-ria-border pb-3">
                <span className="text-ria-neon text-lg">💬</span>
                <h3 className="text-sm font-black uppercase tracking-wide">
                  Interaction <span className="text-ria-neon">coaching</span>
                </h3>
              </div>

              <div className="max-h-80 overflow-y-auto space-y-3 p-2">
                {messages.map((msg, idx) => (
                  <div key={idx} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[90%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                        msg.sender === 'user'
                          ? 'bg-ria-neon text-white font-semibold'
                          : 'bg-ria-bg border border-ria-border text-ria-darkText'
                      }`}
                    >
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
                  className="flex-1 bg-ria-bg border border-ria-border focus:border-ria-neon rounded-xl px-4 py-3 text-xs text-ria-darkText focus:outline-none placeholder:text-ria-sub"
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="bg-ria-neon text-white font-black px-5 py-3 rounded-xl uppercase text-xs disabled:opacity-40"
                >
                  Envoyer
                </button>
              </form>
            </section>
          </>
        )}
      </main>

      {/* WIZARD ONBOARDING */}
      {showQuestionnaire && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-ria-border w-full max-w-lg rounded-2xl p-6 space-y-5">
            <div className="flex justify-between items-center border-b border-ria-border pb-3">
              <h3 className="text-sm font-black uppercase">
                Création du plan <span className="text-ria-neon">(Étape {wizardStep}/3)</span>
              </h3>
              <button onClick={() => setShowQuestionnaire(false)} className="text-ria-sub font-bold">✕</button>
            </div>

            {wizardStep === 1 && (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-ria-sub mb-1 font-mono">Disciplines préparées</label>
                  <div className="flex space-x-2">
                    {['NAT', 'VELO', 'CAP'].map((s) => (
                      <button key={s} className="flex-1 bg-ria-bg border border-ria-neon text-ria-neon font-bold py-2 rounded-lg">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-ria-sub mb-1 font-mono">Date de l'objectif (dans 3 mois max)</label>
                  <input
                    type="date"
                    value={questData.targetDate}
                    onChange={(e) => setQuestData({ ...questData, targetDate: e.target.value })}
                    className="w-full bg-ria-bg border border-ria-border rounded-lg p-2.5 text-ria-darkText font-bold"
                  />
                </div>
              </div>
            )}

            {wizardStep === 2 && (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-ria-sub mb-1 font-mono">Volume horaire hebdo disponible</label>
                  <input
                    type="number"
                    value={questData.hoursPerWeek}
                    onChange={(e) => setQuestData({ ...questData, hoursPerWeek: Number(e.target.value) })}
                    className="w-full bg-ria-bg border border-ria-border rounded-lg p-2.5 text-ria-darkText font-bold"
                  />
                </div>
                <div>
                  <label className="block text-ria-sub mb-1 font-mono">Jour de repos obligatoire</label>
                  <input
                    type="text"
                    value={questData.offDays}
                    onChange={(e) => setQuestData({ ...questData, offDays: e.target.value })}
                    className="w-full bg-ria-bg border border-ria-border rounded-lg p-2.5 text-ria-darkText font-bold"
                  />
                </div>
              </div>
            )}

            {wizardStep === 3 && (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-ria-sub mb-1 font-mono">Cible / Objectif chrono</label>
                  <input
                    type="text"
                    value={questData.targetGoal}
                    onChange={(e) => setQuestData({ ...questData, targetGoal: e.target.value })}
                    className="w-full bg-ria-bg border border-ria-border rounded-lg p-2.5 text-ria-darkText font-bold"
                  />
                </div>
                <p className="text-ria-sub italic">
                  L'IA va générer les 3 cycles ainsi que les 14 premières séances adaptées à tes métriques (VMA {profile.vma} / FTP {profile.ftp}W).
                </p>
              </div>
            )}

            <div className="flex justify-between pt-2">
              {wizardStep > 1 && (
                <button
                  onClick={() => setWizardStep(wizardStep - 1)}
                  className="bg-ria-bg border border-ria-border text-ria-darkText font-bold px-4 py-2 rounded-xl text-xs uppercase"
                >
                  Retour
                </button>
              )}
              {wizardStep < 3 ? (
                <button
                  onClick={() => setWizardStep(wizardStep + 1)}
                  className="bg-ria-neon text-white font-black px-5 py-2 rounded-xl uppercase text-xs ml-auto"
                >
                  Suivant
                </button>
              ) : (
                <button
                  onClick={() => setShowQuestionnaire(false)}
                  className="bg-ria-neon text-white font-black px-5 py-2 rounded-xl uppercase text-xs ml-auto"
                >
                  Générer le plan 3 mois
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODALE PROFIL */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-ria-border w-full max-w-md rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-ria-border pb-3">
              <h2 className="text-sm font-black uppercase">
                Métriques <span className="text-ria-neon">athlète</span>
              </h2>
              <button onClick={() => setShowProfileModal(false)} className="text-ria-sub font-bold">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-ria-sub font-mono mb-1">VMA (km/h)</label>
                <input
                  type="number"
                  step="0.5"
                  value={profile.vma}
                  onChange={(e) => handleProfileChange('vma', Number(e.target.value))}
                  className="w-full bg-ria-bg border border-ria-border rounded-lg p-2.5 text-ria-darkText font-bold"
                />
              </div>
              <div>
                <label className="block text-ria-sub font-mono mb-1">FTP (Watts)</label>
                <input
                  type="number"
                  value={profile.ftp}
                  onChange={(e) => handleProfileChange('ftp', Number(e.target.value))}
                  className="w-full bg-ria-bg border border-ria-border rounded-lg p-2.5 text-ria-darkText font-bold"
                />
              </div>
            </div>
            <button
              onClick={() => setShowProfileModal(false)}
              className="w-full bg-ria-neon text-white font-black py-2.5 rounded-xl text-xs uppercase"
            >
              Enregistrer
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
