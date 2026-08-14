import { useState, useEffect, useRef, useMemo } from 'react';
import CalendarView from '../components/CalendarView';
import ChatMessage from '../components/ChatMessage';
import WorkoutDetail from '../components/WorkoutDetail';
import WizardModal from '../components/WizardModal';
import { STORAGE_KEYS, loadFromStorage, saveToStorage } from '../lib/storage';
import { DEFAULT_PROFILE, DEFAULT_TRAINING_PLAN, DEFAULT_WORKOUTS } from '../lib/defaults';
import { computeRaceStats } from '../lib/workouts';

const TABS = [
  { id: 'calendar', label: 'Calendrier', icon: '📅' },
  { id: 'objective', label: 'Objectif', icon: '🎯' },
  { id: 'profile', label: 'Profil', icon: '⚙️' },
  { id: 'chat', label: 'Coach Chat', icon: '💬' },
];

const SPORT_FILTERS = [
  { id: 'ALL', label: 'Tout' },
  { id: 'NATATION', label: 'Nat' },
  { id: 'CYCLISME', label: 'Vélo' },
  { id: 'C.A.P', label: 'CAP' },
];

const WELCOME_MESSAGE = {
  sender: 'coach',
  text: "👋 Salut Marin ! Ton plan d'entraînement est opérationnel. Quelle séance souhaites-tu passer en revue ?",
};

export default function Home() {
  const [activeTab, setActiveTab] = useState('calendar');
  const [activeWeek, setActiveWeek] = useState('N');
  const [sportFilter, setSportFilter] = useState('ALL');

  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [trainingPlan, setTrainingPlan] = useState(DEFAULT_TRAINING_PLAN);
  const [workouts, setWorkouts] = useState(DEFAULT_WORKOUTS);

  const [showWizard, setShowWizard] = useState(false);
  const [wizardSubmitting, setWizardSubmitting] = useState(false);
  const [wizardError, setWizardError] = useState(null);

  const [selectedWorkout, setSelectedWorkout] = useState(null);

  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [inputMessage, setInputMessage] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  const [hydrated, setHydrated] = useState(false);

  // --- CHARGEMENT INITIAL DEPUIS LE STOCKAGE LOCAL ---
  useEffect(() => {
    setProfile(loadFromStorage(STORAGE_KEYS.profile, DEFAULT_PROFILE));
    setTrainingPlan(loadFromStorage(STORAGE_KEYS.plan, DEFAULT_TRAINING_PLAN));
    setWorkouts(loadFromStorage(STORAGE_KEYS.workouts, DEFAULT_WORKOUTS));
    setMessages(loadFromStorage(STORAGE_KEYS.chat, [WELCOME_MESSAGE]));
    setHydrated(true);
  }, []);

  // --- PERSISTANCE (uniquement après hydratation pour ne pas écraser avec les valeurs par défaut) ---
  useEffect(() => { if (hydrated) saveToStorage(STORAGE_KEYS.profile, profile); }, [profile, hydrated]);
  useEffect(() => { if (hydrated) saveToStorage(STORAGE_KEYS.plan, trainingPlan); }, [trainingPlan, hydrated]);
  useEffect(() => { if (hydrated) saveToStorage(STORAGE_KEYS.workouts, workouts); }, [workouts, hydrated]);
  useEffect(() => { if (hydrated) saveToStorage(STORAGE_KEYS.chat, messages); }, [messages, hydrated]);

  useEffect(() => {
    if (activeTab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeTab]);

  const raceStats = useMemo(() => computeRaceStats(trainingPlan), [trainingPlan]);

  const filteredWorkouts = useMemo(() => {
    const list = workouts[activeWeek] || [];
    if (sportFilter === 'ALL') return list;
    return list.filter((w) => w.type?.toUpperCase().includes(sportFilter));
  }, [workouts, activeWeek, sportFilter]);

  const handleProfileFieldChange = (key, value) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };

  // --- GÉNÉRATION D'UN NOUVEAU PLAN VIA L'ASSISTANT ---
  const handleWizardComplete = async (wizardData) => {
    setWizardSubmitting(true);
    setWizardError(null);
    try {
      const res = await fetch('/api/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wizardData, profile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la génération du plan.');

      setTrainingPlan(data.trainingPlan);
      setWorkouts(data.workouts);
      setShowWizard(false);
      setActiveTab('calendar');

      const coachMsg = `🎯 **Nouveau plan généré !**\n\n- **Objectif** : ${data.trainingPlan?.title || wizardData.eventName || 'Nouvel objectif'}\n- **Volume hebdo** : ~${wizardData.hoursPerWeek}h/semaine sur ${wizardData.maxSessionsPerWeek} séances\n\nLes semaines N et N+1 ont été calées sur tes métriques actuelles.`;
      setMessages((prev) => [...prev, { sender: 'coach', text: coachMsg }]);

      if (data.coherenceWarnings?.length) {
        setMessages((prev) => [
          ...prev,
          { sender: 'coach', text: `⚠️ ${data.coherenceWarnings.join(' ')}` },
        ]);
      }
    } catch (err) {
      setWizardError(err.message || 'Erreur lors de la génération du plan.');
    } finally {
      setWizardSubmitting(false);
    }
  };

  // --- CHAT AVEC LE COACH IA ---
  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if (!inputMessage.trim() || chatLoading) return;

    const userText = inputMessage;
    const newHistory = [...messages, { sender: 'user', text: userText }];
    setMessages(newHistory);
    setInputMessage('');
    setChatLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, profile, workouts, trainingPlan }),
      });
      const data = await res.json();

      if (data.updatedWorkouts) setWorkouts(data.updatedWorkouts);
      setMessages([...newHistory, { sender: 'coach', text: data.reply || "J'ai bien pris en compte ta demande." }]);
    } catch (err) {
      setMessages([
        ...newHistory,
        { sender: 'coach', text: '⚠️ Erreur lors de la réponse du coach. Vérifie la connexion backend.' },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col pb-20 md:pb-6 antialiased">

      {/* HEADER */}
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-orange-500 to-indigo-600 flex items-center justify-center font-black text-xs text-white shadow-lg shadow-orange-500/20">
            TC
          </div>
          <h1 className="text-sm font-black tracking-tight text-white flex items-center gap-1.5">
            TRI<span className="text-orange-500">COACH</span>
          </h1>
        </div>

        <button
          onClick={() => { setWizardError(null); setShowWizard(true); }}
          className="text-xs font-bold bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white px-3 py-1.5 rounded-xl shadow-md transition-all flex items-center gap-1 active:scale-95"
        >
          <span>+</span>
          <span className="hidden sm:inline">Nouveau</span> Plan
        </button>
      </header>

      {/* ONGLETS */}
      <nav className="bg-slate-900 border-b border-slate-800 sticky top-[53px] z-20 px-2 py-2">
        <div className="max-w-md mx-auto grid grid-cols-4 gap-1 bg-slate-950 p-1 rounded-2xl border border-slate-800/80">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl text-[11px] font-bold transition-all ${
                  isActive
                    ? 'bg-slate-800 text-orange-400 border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
                }`}
              >
                <span className="text-base mb-0.5">{tab.icon}</span>
                <span className="truncate w-full text-center">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <main className="flex-1 max-w-md w-full mx-auto p-4 space-y-4">

        {/* ONGLET CALENDRIER */}
        {activeTab === 'calendar' && (
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-slate-400 uppercase tracking-wider font-semibold">
                  Sélecteur de semaine
                </span>
                <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-0.5">
                  <button
                    onClick={() => setActiveWeek('N')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      activeWeek === 'N' ? 'bg-orange-500 text-white' : 'text-slate-400'
                    }`}
                  >
                    Semaine N
                  </button>
                  <button
                    onClick={() => setActiveWeek('N+1')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      activeWeek === 'N+1' ? 'bg-orange-500 text-white' : 'text-slate-400'
                    }`}
                  >
                    Semaine N+1
                  </button>
                </div>
              </div>

              <div className="flex gap-1.5 overflow-x-auto">
                {SPORT_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setSportFilter(f.id)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap border transition-all ${
                      sportFilter === f.id
                        ? 'bg-orange-500/10 border-orange-500 text-orange-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <CalendarView
              weekKey={activeWeek}
              workouts={filteredWorkouts}
              onSelectWorkout={setSelectedWorkout}
            />
          </div>
        )}

        {/* ONGLET OBJECTIF */}
        {activeTab === 'objective' && (
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <span className="text-[10px] font-mono text-orange-400 uppercase tracking-widest block">Objectif en cours</span>
              <h2 className="text-lg font-black text-white">{trainingPlan.title}</h2>
              <p className="text-xs text-slate-400 font-mono">{trainingPlan.date}</p>

              <div className="grid grid-cols-3 gap-2 text-center pt-2">
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5">
                  <span className="text-[9px] text-slate-500 uppercase block">Jours restants</span>
                  <span className="text-base font-black text-orange-400 font-mono">{raceStats.daysLeft}</span>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5">
                  <span className="text-[9px] text-slate-500 uppercase block">Semaines</span>
                  <span className="text-base font-black text-white font-mono">{raceStats.weeksLeft}</span>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5">
                  <span className="text-[9px] text-slate-500 uppercase block">Progression</span>
                  <span className="text-base font-black text-indigo-400 font-mono">{raceStats.progressPct}%</span>
                </div>
              </div>

              {trainingPlan.splits && (
                <div className="grid grid-cols-3 gap-2 text-center pt-1 text-[11px] font-mono">
                  <div><span className="text-cyan-400 block">🏊 {trainingPlan.splits.nat}</span></div>
                  <div><span className="text-amber-400 block">🚴 {trainingPlan.splits.bike}</span></div>
                  <div><span className="text-emerald-400 block">🏃 {trainingPlan.splits.run}</span></div>
                </div>
              )}
            </div>

            {trainingPlan.cycles?.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest block mb-1">Macrocycles</span>
                {trainingPlan.cycles.map((c) => (
                  <div key={c.id} className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs">
                    <div>
                      <p className="font-bold text-white">{c.name}</p>
                      <p className="text-slate-500 font-mono text-[10px]">{c.dates}</p>
                    </div>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                      c.status === 'En cours' ? 'bg-orange-500/10 border-orange-500 text-orange-400' :
                      c.status === 'Terminé' ? 'bg-emerald-950 border-emerald-800 text-emerald-400' :
                      'bg-slate-900 border-slate-800 text-slate-500'
                    }`}>
                      {c.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ONGLET PROFIL */}
        {activeTab === 'profile' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
            <span className="text-[10px] font-mono text-orange-400 uppercase tracking-widest block">Profil physiologique</span>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 font-mono mb-1">VMA (km/h)</label>
                <input
                  type="number"
                  step="0.1"
                  value={profile.vma}
                  onChange={(e) => handleProfileFieldChange('vma', Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 font-mono font-bold focus:border-orange-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-400 font-mono mb-1">FTP (W)</label>
                <input
                  type="number"
                  value={profile.ftp}
                  onChange={(e) => handleProfileFieldChange('ftp', Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 font-mono font-bold focus:border-orange-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-400 font-mono mb-1">CSS natation (/100m)</label>
                <input
                  type="text"
                  value={profile.nat100}
                  onChange={(e) => handleProfileFieldChange('nat100', e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 font-mono font-bold focus:border-orange-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-400 font-mono mb-1">Poids (kg)</label>
                <input
                  type="number"
                  value={profile.weight}
                  onChange={(e) => handleProfileFieldChange('weight', Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 font-mono font-bold focus:border-orange-500 focus:outline-none"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-slate-400 font-mono mb-1">FC Max (bpm)</label>
                <input
                  type="number"
                  value={profile.fcMax}
                  onChange={(e) => handleProfileFieldChange('fcMax', Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 font-mono font-bold focus:border-orange-500 focus:outline-none"
                />
              </div>
            </div>

            {profile.ftp && profile.weight ? (
              <div className="bg-indigo-950/40 border border-indigo-500/30 p-3 rounded-xl text-[11px] text-indigo-300">
                ⚡ Rapport Poids/Puissance : <strong>{(profile.ftp / profile.weight).toFixed(2)} W/kg</strong>
              </div>
            ) : null}
          </div>
        )}

        {/* ONGLET CHAT */}
        {activeTab === 'chat' && (
          <div className="space-y-3 flex flex-col h-[calc(100vh-170px)]">
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {messages.map((m, idx) => (
                <ChatMessage key={idx} text={m.text} sender={m.sender} />
              ))}
              {chatLoading && (
                <div className="text-xs font-mono text-orange-400 animate-pulse flex items-center gap-2">
                  <span>🤖</span> Coach analyse et recalcule tes cibles...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={handleSendMessage} className="flex space-x-2 pt-2">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Ex: Décale ma séance de vélo à jeudi..."
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-orange-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={chatLoading}
                className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95"
              >
                Envoyer
              </button>
            </form>
          </div>
        )}

      </main>

      <WizardModal
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        onComplete={handleWizardComplete}
        submitting={wizardSubmitting}
        submitError={wizardError}
      />

      <WorkoutDetail workout={selectedWorkout} onClose={() => setSelectedWorkout(null)} />

    </div>
  );
}
