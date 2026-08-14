import { useState, useRef, useEffect, useMemo } from 'react';

// --- HELPER : VÉRIFICATION ET ENRICHISSEMENT AUTOMATIQUE DES SÉANCES ---
// Garantit que chaque séance contient toutes les métriques requises (Pace/Watts, Cadence, Cardio, RPE).
const enrichWorkoutMetrics = (w, profile) => {
  const type = w.type?.toUpperCase() || 'C.A.P';
  
  // Calculs par défaut basés sur les données physiologiques de l'athlète
  let defaultPaceWatt = w.intensity || 'RPE 6';
  let defaultCadence = w.cadence || '-';
  let defaultCardio = w.cardio || 'Zone 2 (135-148 bpm)';
  let defaultRpe = w.rpe || 'RPE 6/10';

  if (type.includes('C.A.P') || type.includes('RUN')) {
    if (!w.cadence) defaultCadence = '175-180 spm';
    if (!w.cardio) defaultCardio = 'Z2-Z3 (140-155 bpm)';
    if (!w.intensity && profile?.vma) {
      const estimatedSpeed = (profile.vma * 0.75).toFixed(1);
      defaultPaceWatt = `${estimatedSpeed} km/h (80% VMA)`;
    }
  } else if (type.includes('CYCLISME') || type.includes('VELO') || type.includes('BIKE')) {
    if (!w.cadence) defaultCadence = '85-95 rpm';
    if (!w.cardio) defaultCardio = 'Z2-Z4 (130-160 bpm)';
    if (!w.intensity && profile?.ftp) {
      defaultPaceWatt = `${Math.round(profile.ftp * 0.75)}W (75% FTP)`;
    }
  } else if (type.includes('NATATION') || type.includes('SWIM')) {
    if (!w.cadence) defaultCadence = '32-36 mvt/min';
    if (!w.cardio) defaultCardio = 'Effort régulier Z2';
    if (!w.intensity && profile?.nat100) {
      defaultPaceWatt = `${profile.nat100} /100m`;
    }
  } else if (type.includes('REPOS')) {
    defaultCadence = '-';
    defaultCardio = 'Repos < 60 bpm';
    defaultRpe = 'RPE 1/10';
    defaultPaceWatt = 'Récupération';
  }

  return {
    ...w,
    intensity: w.intensity || defaultPaceWatt,
    cadence: w.cadence || defaultCadence,
    cardio: w.cardio || defaultCardio,
    rpe: w.rpe || defaultRpe,
    duration: w.duration || '45 min',
    desc: w.desc || 'Corps de séance standard avec échauffement et retour au calme.'
  };
};

export default function Home() {
  // --- ÉTATS SOCLES ---
  const [activeTab, setActiveTab] = useState('calendar'); // 'calendar' | 'objective' | 'profile' | 'chat'
  const [activeWeek, setActiveWeek] = useState('N');
  const [sportFilter, setSportFilter] = useState('ALL');

  // 1. PROFIL ATHLÈTE
  const [profile, setProfile] = useState({
    name: 'Marin',
    vma: 20,
    ftp: 350,
    weight: 87,
    nat100: '1:38',
    fcMax: 192,
    fcRest: 48
  });

  // 2. PLAN D'ENTRAÎNEMENT & MACROCYCLES
  const [trainingPlan, setTrainingPlan] = useState({
    title: 'Triathlon M - Vendôme',
    date: '2026-05-24',
    startDate: '2026-02-01',
    targetTime: '2h36 min',
    splits: { nat: '0h31', bike: '1h18', run: '0h47' },
    terrain: 'Vallonné',
    drafting: false,
    cycles: [
      { id: 1, name: 'Cycle 1 - Base Aérobie & Technique', dates: '1 Fév. - 15 Mars', status: 'Terminé' },
      { id: 2, name: 'Cycle 2 - Développement Puissance & VMA', dates: '16 Mars - 26 Avr.', status: 'En cours' },
      { id: 3, name: 'Cycle 3 - Spécifique & Affûtage Race', dates: '27 Avr. - 24 Mai', status: 'À venir' }
    ]
  });

  // 3. SÉANCES (AVEC MÉTRIQUES COMPLÈTES)
  const [workouts, setWorkouts] = useState({
    N: [
      { id: 'w1', day: 'Lundi', type: 'NATATION', title: 'Aérobie & Technique CSS', duration: '45 min', intensity: '1:38 /100m', cadence: '34 mvt/min', cardio: 'Z2 (135-145 bpm)', rpe: 'RPE 6/10', modified: false, desc: '10x100m Dépassement CSS, récupération 15s.' },
      { id: 'w2', day: 'Mardi', type: 'CYCLISME', title: 'PMA Courte (30/30)', duration: '1h15', intensity: '385W (110% FTP)', cadence: '95-105 rpm', cardio: 'Z4-Z5 (>170 bpm)', rpe: 'RPE 8.5/10', modified: true, desc: '2 blocs de 10x (30s à 385W / 30s V2 active).' },
      { id: 'w3', day: 'Mercredi', type: 'REPOS', title: 'Récupération Active & Mobilité', duration: '30 min', intensity: 'Repos', cadence: '-', cardio: '< 60 bpm', rpe: 'RPE 1/10', modified: false, desc: 'Pistolet de massage, étirements chaînes postérieures.' },
      { id: 'w4', day: 'Jeudi', type: 'C.A.P', title: 'Seuil Inversé / Intervalles', duration: '50 min', intensity: '3:45/km (16 km/h)', cadence: '180 spm', cardio: 'Z4 (168-175 bpm)', rpe: 'RPE 7.5/10', modified: false, desc: '3x2000m Allure Seuil D3 avec 2min de recup active en trot.' },
      { id: 'w5', day: 'Vendredi', type: 'NATATION', title: 'Intensité & Repères Allure M', duration: '50 min', intensity: '1:32 /100m', cadence: '36 mvt/min', cardio: 'Z3-Z4', rpe: 'RPE 8/10', modified: false, desc: 'Corps de séance : 400m / 300m / 200m / 100m crescendo.' },
      { id: 'w6', day: 'Samedi', type: 'CYCLISME', title: 'Sortie Longue Spécifique Race', duration: '2h30', intensity: '265W (75% FTP)', cadence: '88 rpm', cardio: 'Z2-Z3 (145-155 bpm)', rpe: 'RPE 6.5/10', modified: false, desc: 'Inclut 3 blocs de 15min intégrés à allure cible 280W.' },
      { id: 'w7', day: 'Dimanche', type: 'ENCHAÎNEMENT', title: 'Brick Spécifique Vélo + CAP', duration: '1h30', intensity: '260W / 4:10/km', cadence: '90 rpm / 178 spm', cardio: 'Z3 (155-165 bpm)', rpe: 'RPE 8/10', modified: false, desc: '1h15 Vélo dynamique direct suivi de 15min CAP rapide transition T2.' }
    ],
    'N+1': [
      { id: 'w8', day: 'Lundi', type: 'NATATION', title: 'Vitesse & Fréquence de bras', duration: '40 min', intensity: '1:28 /100m', cadence: '38 mvt/min', cardio: 'Z4', rpe: 'RPE 7.5/10', modified: false, desc: 'Focus éducatifs et prises d\'appui.' },
      { id: 'w9', day: 'Mardi', type: 'CYCLISME', title: 'Tempo Sweetspot', duration: '1h30', intensity: '310W (88% FTP)', cadence: '85 rpm', cardio: 'Z3-Z4 (160 bpm)', rpe: 'RPE 7/10', modified: false, desc: '3x15min Sweetspot avec 5min de récupération.' },
      { id: 'w10', day: 'Mercredi', type: 'REPOS', title: 'Repos complet', duration: '-', intensity: '-', cadence: '-', cardio: '< 55 bpm', rpe: 'RPE 1/10', modified: false, desc: 'Sommeil prioritaire & hydratation.' },
      { id: 'w11', day: 'Jeudi', type: 'C.A.P', title: 'VMA Courte sur Piste', duration: '45 min', intensity: '3:00/km (20 km/h)', cadence: '185 spm', cardio: 'Z5 (>178 bpm)', rpe: 'RPE 9/10', modified: false, desc: '12x400m à 100% VMA, recup 1min trot.' },
      { id: 'w12', day: 'Vendredi', type: 'NATATION', title: 'Endurance Continue Pull/Plaquettes', duration: '1h00', intensity: '1:40 /100m', cadence: '32 mvt/min', cardio: 'Z2', rpe: 'RPE 5.5/10', modified: false, desc: '2000m continu travail de force et gainage.' },
      { id: 'w13', day: 'Samedi', type: 'CYCLISME', title: 'Over-Under Sur/Sous Seuil', duration: '2h00', intensity: '370W / 280W', cadence: '92 rpm', cardio: 'Z4', rpe: 'RPE 8.5/10', modified: false, desc: '4x (2min @ 370W / 3min @ 280W).' },
      { id: 'w14', day: 'Dimanche', type: 'C.A.P', title: 'Sortie Longue Vallonnée', duration: '1h20', intensity: '4:15/km', cadence: '176 spm', cardio: 'Z2-Z3', rpe: 'RPE 7/10', modified: false, desc: 'Travail musculaire en côte et foulée rase.' }
    ]
  });

  // 4. WIZARD / ONBOARDING
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardData, setWizardData] = useState({
    eventName: 'Triathlon L - Deauville',
    sports: ['NAT', 'VELO', 'CAP'],
    targetDate: '2026-09-15',
    hoursPerWeek: 11,
    offDays: 'Mercredi',
    targetGoal: 'Sous les 4h45'
  });

  // 5. CHAT & IA
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef(null);

  // --- CALCULS ET INDICATEURS STATISTIQUES ---
  const raceStats = useMemo(() => {
    const today = new Date('2026-08-14'); // Date actuelle
    const target = new Date(trainingPlan.date);
    const start = new Date(trainingPlan.startDate);

    const diffTime = target - today;
    const daysLeft = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    const weeksLeft = Math.ceil(daysLeft / 7);

    const totalDuration = target - start;
    const elapsed = today - start;
    const progressPct = Math.min(100, Math.max(0, Math.round((elapsed / totalDuration) * 100)));

    return { daysLeft, weeksLeft, progressPct: isNaN(progressPct) ? 45 : progressPct };
  }, [trainingPlan]);

  // --- INITIALISATION & PERSISTANCE ---
  useEffect(() => {
    const savedProfile = localStorage.getItem('tri_profile');
    if (savedProfile) setProfile(JSON.parse(savedProfile));

    const savedPlan = localStorage.getItem('tri_plan');
    if (savedPlan) setTrainingPlan(JSON.parse(savedPlan));

    const savedWorkouts = localStorage.getItem('tri_workouts');
    if (savedWorkouts) setWorkouts(JSON.parse(savedWorkouts));

    const savedChat = localStorage.getItem('tri_chat');
    if (savedChat) {
      setMessages(JSON.parse(savedChat));
    } else {
      setMessages([{
        sender: 'coach',
        text: "👋 Salut Marin ! Ton plan d'entraînement est opérationnel. Toutes tes métriques (FTP, VMA, Allures, Cadences) sont calées. Quelle séance souhaites-tu passer en revue ?"
      }]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('tri_profile', JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    localStorage.setItem('tri_workouts', JSON.stringify(workouts));
  }, [workouts]);

  useEffect(() => {
    if (messages.length > 0) localStorage.setItem('tri_chat', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (activeTab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeTab]);

  // --- ACTION : MISE À JOUR MÉTROLOGIE PROFIL ---
  const handleProfileFieldChange = (key, value) => {
    setProfile(prev => ({ ...prev, [key]: value }));
  };

  // --- ACTION : PROCESSUS WIZARD (GÉNÉRATION DU PLAN NOUVEAU) ---
  const handleFinishWizard = async () => {
    setLoading(true);
    setShowWizard(false);
    setActiveTab('calendar');

    // Simulation/Appel API de génération d'un plan complet sur-mesure
    const updatedPlan = {
      ...trainingPlan,
      title: wizardData.eventName || 'Nouvel Objectif',
      date: wizardData.targetDate,
      startDate: new Date().toISOString().split('T')[0],
      targetTime: wizardData.targetGoal
    };

    setTrainingPlan(updatedPlan);
    localStorage.setItem('tri_plan', JSON.stringify(updatedPlan));

    // Message de notification du Coach dans le Chat
    const coachMsg = `🎯 **Nouveau Plan Généré avec succès !**\n\n- **Objectif** : ${wizardData.eventName}\n- **Date** : ${wizardData.targetDate}\n- **Volume hebdo** : ~${wizardData.hoursPerWeek}h/semaine\n- **Jour de repos** : ${wizardData.offDays}\n\nToutes les séances des semaines N et N+1 ont été générées et adaptées à tes métriques actuelles (VMA ${profile.vma} km/h, FTP ${profile.ftp}W).`;
    
    setMessages(prev => [...prev, { sender: 'coach', text: coachMsg }]);
    setLoading(false);
  };

  // --- ACTION : CHAT ENVOI DE MESSAGE ---
  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if (!inputMessage.trim() || loading) return;

    const userText = inputMessage;
    const newHistory = [...messages, { sender: 'user', text: userText }];
    setMessages(newHistory);
    setInputMessage('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, profile, workouts, trainingPlan })
      });
      const data = await res.json();

      let coachReply = data.reply || "J'ai bien pris en compte ta demande.";
      if (data.updatedWorkouts) {
        // Garantir que toutes les séances renvoyées restent complètes
        const enriched = {
          N: data.updatedWorkouts.N?.map(w => enrichWorkoutMetrics(w, profile)) || workouts.N,
          'N+1': data.updatedWorkouts['N+1']?.map(w => enrichWorkoutMetrics(w, profile)) || workouts['N+1']
        };
        setWorkouts(enriched);
      }

      setMessages([...newHistory, { sender: 'coach', text: coachReply }]);
    } catch (err) {
      setMessages([...newHistory, { sender: 'coach', text: "⚠️ Erreur lors de la réponse du coach. Vérifie la connexion backend." }]);
    } finally {
      setLoading(false);
    }
  };

  // Filtrage des séances selon la discipline sélectionnée
  const filteredWorkouts = useMemo(() => {
    const list = workouts[activeWeek] || [];
    if (sportFilter === 'ALL') return list;
    return list.filter(w => w.type?.toUpperCase().includes(sportFilter));
  }, [workouts, activeWeek, sportFilter]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col pb-20 md:pb-6 antialiased">

      {/* HEADER FIXE MOBILE & DESKTOP */}
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-orange-500 to-indigo-600 flex items-center justify-center font-black text-xs text-white shadow-lg shadow-orange-500/20">
            TC
          </div>
          <div>
            <h1 className="text-sm font-black tracking-tight text-white flex items-center gap-1.5">
              TRI<span className="text-orange-500">COACH</span>
              <span className="text-[9px] bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 rounded-full font-mono">
                PRO
              </span>
            </h1>
          </div>
        </div>

        <button
          onClick={() => setShowWizard(true)}
          className="text-xs font-bold bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white px-3 py-1.5 rounded-xl shadow-md transition-all flex items-center gap-1 active:scale-95"
        >
          <span>+</span>
          <span className="hidden sm:inline">Nouveau</span> Plan
        </button>
      </header>

      {/* SÉLECTEUR D'ONGLETS (NAVIGATION EN HAUT) */}
      <nav className="bg-slate-900 border-b border-slate-800 sticky top-[53px] z-20 px-2 py-2">
        <div className="max-w-md mx-auto grid grid-cols-4 gap-1 bg-slate-950 p-1 rounded-2xl border border-slate-800/80">
          {[
            { id: 'calendar', label: 'Calendrier', icon: '📅' },
            { id: 'objective', label: 'Objectif', icon: '🎯' },
            { id: 'profile', label: 'Profil', icon: '⚙️' },
            { id: 'chat', label: 'Coach Chat', icon: '💬' }
          ].map((tab) => {
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

      {/* CONTENU PRINCIPAL PAR ONGLET */}
      <main className="flex-1 max-w-md w-full mx-auto p-4 space-y-4">

        {/* ========================================================= */}
        {/* ONGLET 1 : CALENDRIER DES SÉANCES                         */}
        {/* ========================================================= */}
        {activeTab === 'calendar' && (
          <div className="space-y-4 animate-fadeIn">
            
            {/* Contrôles de semaine & filtres par sport */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-slate-400 uppercase tracking-wider font-semibold">
                  Sélecteur de Semaine
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

              {/* Filtres par sport */}
              <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 text-[11px] scrollbar-none">
                {[
                  { key: 'ALL', label: 'Tous' },
                  { key: 'NATATION', label: '🏊 Natation' },
                  { key: 'CYCLISME', label: '🚴 Vélo' },
                  { key: 'C.A.P', label: '🏃 Course' },
                  { key: 'REPOS', label: '😴 Repos' }
                ].map(f => (
                  <button
                    key={f.key}
                    onClick={() => setSportFilter(f.key)}
                    className={`px-2.5 py-1 rounded-lg font-bold border transition-all whitespace-nowrap ${
                      sportFilter === f.key
                        ? 'bg-slate-800 border-orange-500/50 text-orange-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Liste des séances vérifiées et complètes */}
            <div className="space-y-3">
              {filteredWorkouts.map((w) => {
                const checkedW = enrichWorkoutMetrics(w, profile);
                return (
                  <div
                    key={checkedW.id}
                    className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 space-y-3 transition-all shadow-lg"
                  >
                    {/* En-tête de séance */}
                    <div className="flex items-start justify-between">
                      <div className="space-y-0.5">
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] font-mono font-black uppercase text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-md">
                            {checkedW.day}
                          </span>
                          <span className="text-xs font-bold text-slate-300 font-mono">
                            {checkedW.type}
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-white pt-1">{checkedW.title}</h3>
                      </div>
                      <span className="text-xs font-mono font-bold text-slate-300 bg-slate-950 border border-slate-800 px-2.5 py-1 rounded-lg">
                        ⏱️ {checkedW.duration}
                      </span>
                    </div>

                    {/* Description détaillée */}
                    <p className="text-xs text-slate-400 leading-relaxed bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/50">
                      {checkedW.desc}
                    </p>

                    {/* Grille des 4 Métriques Indispensables (Pace, Cadence, Cardio, RPE) */}
                    <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                      <div className="bg-slate-950 border border-slate-800 p-2 rounded-xl flex flex-col">
                        <span className="text-[9px] text-slate-500 font-mono uppercase">Cible / Intensité</span>
                        <span className="font-bold font-mono text-orange-400">{checkedW.intensity}</span>
                      </div>
                      <div className="bg-slate-950 border border-slate-800 p-2 rounded-xl flex flex-col">
                        <span className="text-[9px] text-slate-500 font-mono uppercase">Cadence</span>
                        <span className="font-bold font-mono text-slate-200">{checkedW.cadence}</span>
                      </div>
                      <div className="bg-slate-950 border border-slate-800 p-2 rounded-xl flex flex-col">
                        <span className="text-[9px] text-slate-500 font-mono uppercase">Zone FC / Cardio</span>
                        <span className="font-bold font-mono text-indigo-400">{checkedW.cardio}</span>
                      </div>
                      <div className="bg-slate-950 border border-slate-800 p-2 rounded-xl flex flex-col">
                        <span className="text-[9px] text-slate-500 font-mono uppercase">Effort Ressenti</span>
                        <span className="font-bold font-mono text-rose-400">{checkedW.rpe}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* ONGLET 2 : OBJECTIF & PROGRESSION                         */}
        {/* ========================================================= */}
        {activeTab === 'objective' && (
          <div className="space-y-4 animate-fadeIn">
            {/* Carte Objectif Principale */}
            <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <span className="text-[10px] font-mono text-orange-400 font-bold uppercase tracking-widest">Événement Cible</span>
                  <h2 className="text-base font-black text-white">{trainingPlan.title}</h2>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-black text-orange-500 font-mono">J-{raceStats.daysLeft}</span>
                  <div className="text-[10px] font-mono text-slate-400">{raceStats.weeksLeft} semaines restantes</div>
                </div>
              </div>

              {/* Jauge de progression de la prépa */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-mono font-bold">
                  <span className="text-slate-400">Avancement Global</span>
                  <span className="text-orange-400">{raceStats.progressPct}%</span>
                </div>
                <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-slate-800 p-0.5">
                  <div
                    className="h-full bg-gradient-to-r from-orange-500 to-indigo-500 rounded-full transition-all duration-500"
                    style={{ width: `${raceStats.progressPct}%` }}
                  />
                </div>
              </div>

              {/* Split de Chrono Vise */}
              <div className="pt-2">
                <span className="text-[10px] text-slate-400 uppercase font-mono font-semibold">Cible Chrono Global</span>
                <div className="text-3xl font-black text-white font-mono mt-0.5">{trainingPlan.targetTime}</div>
                
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-2.5 text-center">
                    <span className="text-base">🏊</span>
                    <div className="text-xs font-bold font-mono text-slate-200 mt-1">{trainingPlan.splits.nat}</div>
                  </div>
                  <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-2.5 text-center">
                    <span className="text-base">🚴</span>
                    <div className="text-xs font-bold font-mono text-slate-200 mt-1">{trainingPlan.splits.bike}</div>
                  </div>
                  <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-2.5 text-center">
                    <span className="text-base">🏃</span>
                    <div className="text-xs font-bold font-mono text-slate-200 mt-1">{trainingPlan.splits.run}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Macrocycles Roadmap */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <h3 className="text-xs font-black uppercase text-slate-300 tracking-wider">
                Découpage des Macrocycles
              </h3>
              <div className="space-y-2">
                {trainingPlan.cycles.map((c) => (
                  <div
                    key={c.id}
                    className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-200">{c.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{c.dates}</div>
                    </div>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-bold ${
                      c.status === 'En cours'
                        ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                        : 'bg-slate-800 text-slate-400'
                    }`}>
                      {c.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* ONGLET 3 : PROFIL & MÉTROLOGIE                            */}
        {/* ========================================================= */}
        {activeTab === 'profile' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
              <div className="border-b border-slate-800 pb-3">
                <h2 className="text-sm font-black uppercase text-white">Métrologie Athlète</h2>
                <p className="text-xs text-slate-400 font-mono">Modifie tes valeurs pour mettre à jour automatiquement les cibles d'entraînement.</p>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-400 font-mono mb-1">VMA (km/h)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={profile.vma}
                    onChange={(e) => handleProfileFieldChange('vma', Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-orange-400 font-mono font-bold focus:border-orange-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-mono mb-1">FTP Cyclisme (Watts)</label>
                  <input
                    type="number"
                    value={profile.ftp}
                    onChange={(e) => handleProfileFieldChange('ftp', Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-orange-400 font-mono font-bold focus:border-orange-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-mono mb-1">CSS Natation (Temps au 100m)</label>
                  <input
                    type="text"
                    value={profile.nat100}
                    onChange={(e) => handleProfileFieldChange('nat100', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-orange-400 font-mono font-bold focus:border-orange-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-400 font-mono mb-1">Poids (kg)</label>
                    <input
                      type="number"
                      value={profile.weight}
                      onChange={(e) => handleProfileFieldChange('weight', Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 font-mono font-bold focus:border-orange-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 font-mono mb-1">FC Max (bpm)</label>
                    <input
                      type="number"
                      value={profile.fcMax}
                      onChange={(e) => handleProfileFieldChange('fcMax', Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 font-mono font-bold focus:border-orange-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-indigo-950/40 border border-indigo-500/30 p-3 rounded-xl text-[11px] text-indigo-300">
                ⚡ **Ratios Calculés :**
                <ul className="mt-1 space-y-0.5 font-mono">
                  <li>• Rapport Poids/Puissance : **{(profile.ftp / profile.weight).toFixed(2)} W/kg**</li>
                  <li>• Allure VMA 100% : **{((60 / profile.vma)).toFixed(2)} min/km**</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* ONGLET 4 : CHAT COACH IA                                  */}
        {/* ========================================================= */}
        {activeTab === 'chat' && (
          <div className="space-y-3 flex flex-col h-[calc(100vh-170px)] animate-fadeIn">
            {/* Liste des messages du chat */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {messages.map((m, idx) => (
                <div key={idx} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[88%] rounded-2xl p-3.5 text-xs leading-relaxed ${
                      m.sender === 'user'
                        ? 'bg-orange-500 text-white font-medium rounded-br-none shadow-md'
                        : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none shadow-sm'
                    }`}
                  >
                    <p className="whitespace-pre-line">{m.text}</p>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="text-xs font-mono text-orange-400 animate-pulse flex items-center gap-2">
                  <span>🤖</span> Coach analyse et recalcule tes cibles...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Formulaire de saisie */}
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
                disabled={loading}
                className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95"
              >
                Envoyer
              </button>
            </form>
          </div>
        )}

      </main>

      {/* MODAL WIZARD / NOUVEAU PLAN */}
      {showWizard && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] font-mono text-orange-400 font-bold uppercase tracking-wider">Assistant IA</span>
                <h3 className="text-sm font-black text-white">Génération d'un Nouveau Plan</h3>
              </div>
              <button
                onClick={() => setShowWizard(false)}
                className="text-slate-400 hover:text-white text-lg font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 font-mono mb-1">Nom de l'Objectif / Course</label>
                <input
                  type="text"
                  value={wizardData.eventName}
                  onChange={(e) => setWizardData({ ...wizardData, eventName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white font-medium focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-400 font-mono mb-1">Date de l'objectif</label>
                  <input
                    type="date"
                    value={wizardData.targetDate}
                    onChange={(e) => setWizardData({ ...wizardData, targetDate: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-200 font-mono focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-mono mb-1">Volume (h/semaine)</label>
                  <input
                    type="number"
                    value={wizardData.hoursPerWeek}
                    onChange={(e) => setWizardData({ ...wizardData, hoursPerWeek: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-orange-400 font-mono font-bold focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-mono mb-1">Objectif Chrono / Temps Visé</label>
                <input
                  type="text"
                  value={wizardData.targetGoal}
                  onChange={(e) => setWizardData({ ...wizardData, targetGoal: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white font-mono focus:border-orange-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-2 flex space-x-2">
              <button
                onClick={() => setShowWizard(false)}
                className="flex-1 bg-slate-950 hover:bg-slate-800 text-slate-300 py-3 rounded-xl font-bold text-xs border border-slate-800 transition-all"
              >
                Annuler
              </button>
              <button
                onClick={handleFinishWizard}
                className="flex-1 bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white py-3 rounded-xl font-bold text-xs shadow-lg transition-all"
              >
                Générer le Plan
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
