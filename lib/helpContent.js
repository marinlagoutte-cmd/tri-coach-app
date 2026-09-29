// lib/helpContent.js
//
// CONTENU DE L'AIDE — un seul fichier pour tout le texte d'aide de l'app, facile à relire et
// à corriger sans toucher aux composants :
//   - GLOSSARY : lexique (bulles "?" à côté du jargon + onglet Lexique du centre d'aide) ;
//   - TOUR_STEPS : visite guidée (lancée une fois après le premier plan, rejouable via ❓) ;
//   - TAB_TIPS : astuce affichée à la première visite de chaque onglet ;
//   - FAQ : questions fréquentes.
// Les définitions reprennent les règles RÉELLES de l'app (moyennes 42 j / 7 j pour la forme et
// la fatigue, décharge à ~70 %, tests proposés automatiquement, etc.).

export const GLOSSARY = [
  {
    id: 'vma', term: 'VMA — vitesse maximale aérobie',
    text: "La vitesse de course à laquelle ton corps consomme le maximum d'oxygène : tu peux la tenir environ 4 à 7 minutes. Elle sert à calculer toutes tes allures de course. Test simple : après un bon échauffement, cours 6 minutes le plus loin possible ; distance en mètres ÷ 100 = ta VMA en km/h (1 700 m → 17 km/h).",
  },
  {
    id: 'ftp', term: 'FTP — puissance au seuil (vélo)',
    text: "La puissance, en watts, que tu peux tenir environ une heure. Elle sert à calculer tes zones vélo. Elle se mesure avec un capteur de puissance ou un home-trainer connecté (test courant : 20 minutes à fond, puissance moyenne × 0,95). Sans capteur, laisse vide : le coach te donnera des repères d'effort (RPE).",
  },
  {
    id: 'css', term: 'CSS — vitesse critique en natation',
    text: "Ton allure de seuil en natation, en temps pour 100 m. Test : 400 m à fond, récupération, puis 200 m à fond. CSS = (temps du 400 − temps du 200) ÷ 2, pour 100 m. Exemple : 6'20 et 2'55 → 1'42 /100 m.",
  },
  {
    id: 'fcmax', term: 'FC max — fréquence cardiaque maximale',
    text: "Le nombre maximal de battements par minute atteint lors d'un effort à fond. Prends la valeur la plus haute vue sur tes activités (fin de course, côtes) plutôt qu'une formule comme « 220 − âge », souvent très imprécise.",
  },
  {
    id: 'fcrepos', term: 'FC repos',
    text: "Tes battements par minute au réveil, allongé, avant de te lever. Avec la FC max, elle permet de calculer tes zones cardiaques.",
  },
  {
    id: 'zones', term: 'Zones Z1 à Z5',
    text: "Des niveaux d'intensité calculés à partir de TES mesures. Z1 récupération (très facile) · Z2 endurance fondamentale (tu peux parler en phrases complètes) · Z3 tempo (soutenu, phrases courtes) · Z4 seuil (difficile, quelques mots) · Z5 VMA (très dur, quelques minutes seulement). L'essentiel de l'entraînement se fait en Z1-Z2.",
  },
  {
    id: 'rpe', term: 'RPE — effort perçu',
    text: "Une note de 1 à 10 de la difficulté ressentie (1 = très facile, 10 = à fond). Utilisée quand une mesure chiffrée n'est pas connue, et pour ton ressenti après chaque séance.",
  },
  {
    id: 'ef', term: 'EF — endurance fondamentale',
    text: "Une allure facile (Z2) à laquelle tu peux tenir une conversation. C'est la base de toute progression en endurance.",
  },
  {
    id: 'seuil', term: 'Seuil',
    text: "Une intensité « difficile mais tenable » (Z4), proche de l'allure que tu pourrais tenir une heure. Elle se travaille en blocs de 8 à 20 minutes.",
  },
  {
    id: 'fractionne', term: 'Fractionné',
    text: "Une alternance d'efforts intenses et de récupérations. Exemple : 6*(2' @Z4 - 2' trot) = 6 fois 2 minutes en Z4, avec 2 minutes de trot entre chaque.",
  },
  {
    id: 'notation', term: 'Lire une feuille de séance',
    text: "Trois parties : échauffement, corps de séance, retour au calme. ' = minutes, '' = secondes, @ = à l'intensité indiquée. En natation, 4*100 NC Z2 R : 20'' = 4 fois 100 m en nage complète, zone 2, 20 secondes de récupération. NC nage complète · PULL pull-buoy · PLAQ plaquettes · educ éducatifs · Total = distance totale de la séance.",
  },
  {
    id: 'enchainement', term: 'Enchaînement (brick)',
    text: "Deux disciplines à la suite sans pause, le plus souvent vélo puis course, pour habituer les jambes à la transition. Dans l'app, un enchaînement compte pour 2 séances.",
  },
  {
    id: 'ppg', term: 'PPG',
    text: "Préparation physique générale : gainage, renforcement, mobilité. Courte (20 à 30 minutes) et peu intense, elle aide à prévenir les blessures.",
  },
  {
    id: 'seance_cle', term: 'Séance clé',
    text: "Une séance de qualité (seuil, fractionné, côtes…). Le coach les espace pour que tu récupères entre deux.",
  },
  {
    id: 'cycle', term: 'Cycle charge / décharge',
    text: "Des semaines de travail (charge) suivies d'une semaine allégée (décharge, environ 70 % du volume) pour assimiler l'entraînement. Exemple 3:1 = 3 semaines de charge puis 1 de décharge. Réglable dans Objectif → Réglages du plan.",
  },
  {
    id: 'phases', term: 'Phases de la saison',
    text: "Base (construire l'endurance) → Développement (plus d'intensité) → Spécifique (allure de course) → Affûtage → Semaine de course → Récupération. L'onglet Objectif montre où tu en es.",
  },
  {
    id: 'affutage', term: 'Affûtage',
    text: "Les dernières semaines avant l'objectif : le volume baisse nettement et quelques rappels d'intensité restent, pour arriver frais le jour J.",
  },
  {
    id: 'forme', term: 'Forme, fatigue, fraîcheur (CTL / ATL / TSB)',
    text: "Calculées à partir de tes activités Strava. Forme (CTL) : ta charge moyenne des 42 derniers jours ; elle monte lentement quand tu t'entraînes régulièrement. Fatigue (ATL) : ta charge des 7 derniers jours. Fraîcheur (TSB) = forme − fatigue : très négative, tu accumules de la fatigue ; proche de 0, c'est équilibré ; positive, tu es frais (idéal avant une course).",
  },
  {
    id: 'vfc', term: 'VFC — variabilité de la fréquence cardiaque',
    text: "Les petites variations de temps entre deux battements, mesurées par certaines montres (souvent la nuit). Une VFC nettement plus basse que ta moyenne est un signe de fatigue : le coach allège alors une séance.",
  },
  {
    id: 'semaines', term: 'Semaine N et semaine N+1',
    text: "Le coach prépare toujours deux semaines : la semaine en cours (N) et la suivante (N+1). Quand une nouvelle semaine commence, la suivante devient la semaine en cours, et tu génères la nouvelle depuis le Calendrier.",
  },
  {
    id: 'note_auto', term: 'Note ⓘ sous une séance',
    text: "Quand l'app ajuste une séance automatiquement (allégée après une grosse journée, raccourcie pour tenir dans ton temps disponible, affûtage…), la raison s'affiche en petit dans le détail de la séance.",
  },
  {
    id: 'aspiration', term: 'Aspiration (drafting)',
    text: "Rouler dans le sillage d'un autre concurrent pour économiser de l'énergie. Autorisée seulement dans certaines courses (souvent les formats courts et les championnats des clubs) : vérifie le règlement de ta course.",
  },
  {
    id: 'transitions', term: 'T1 / T2',
    text: "Les transitions : T1 = natation → vélo, T2 = vélo → course. Le chrono tourne pendant les transitions : l'outil Transitions (checklist, routines, rappels du règlement) t'aide à ne rien oublier.",
  },
  {
    id: 'dplus', term: 'D+ (dénivelé positif)',
    text: "Le total des montées d'un parcours, en mètres.",
  },
  {
    id: 'formats', term: 'Formats XS / S / M / L / XL',
    text: "Les distances de triathlon, du plus court au plus long : XS découverte, S sprint (750 m / 20 km / 5 km), M olympique (1,5 / 40 / 10 km), L « half » (1,9 / 90 / 21,1 km), XL « Ironman » (3,8 / 180 / 42,2 km).",
  },
];

export function glossaryEntry(id) {
  return GLOSSARY.find((g) => g.id === id) || null;
}

// Visite guidée : un écran par grande fonctionnalité. `visual` = aperçu dessiné par
// components/GuidedTour.js ; `tab` = onglet concerné (affiché comme repère).
export const TOUR_STEPS = [
  {
    id: 'welcome', visual: 'welcome', title: 'Bienvenue sur TRI COACH',
    text: "Ton coach construit ton plan semaine par semaine, à partir de tes réponses au questionnaire, puis l'adapte à ce que tu fais vraiment : ressentis, séances manquées, fatigue, activités Strava.",
  },
  {
    id: 'today', visual: 'today', tab: "Aujourd'hui", title: 'Chaque jour, commence ici',
    text: "Ta ou tes séances du jour en grand, ce qui t'attend demain, et les séances passées à confirmer (« Faite » / « Pas faite »). Touche une séance pour ouvrir sa feuille complète.",
  },
  {
    id: 'calendar', visual: 'calendar', tab: 'Calendrier', title: 'Ta semaine et la suivante',
    text: "Le coach prépare toujours la semaine en cours et la suivante. Glisse pour voir tous les jours ; le jour actuel est encadré. Quand une nouvelle semaine commence, un bouton « Générer cette semaine » apparaît.",
  },
  {
    id: 'detail', visual: 'detail', tab: 'Détail d\'une séance', title: 'Une séance, trois parties',
    text: "Échauffement, corps de séance, retour au calme, avec des cibles chiffrées tirées de TES zones. Après la séance, touche « Valider la séance » et donne ton ressenti : c'est ce qui permet au coach d'ajuster la suite.",
  },
  {
    id: 'coach', visual: 'coach', tab: 'Coach', title: 'Parle à ton coach',
    text: "Écris avec tes mots : fatigue, douleur, imprévu, question. « Je n'ai qu'une heure jeudi », « décale ma sortie longue à dimanche »… Le coach modifie le plan et t'explique ce qu'il a changé.",
  },
  {
    id: 'objective', visual: 'objective', tab: 'Objectif', title: 'Ta saison et tes réglages',
    text: "Les phases jusqu'à ton objectif, et « Réglages du plan » : jours de repos, temps disponible par jour, cycle charge/décharge, priorités, et infos libres pour le coach (créneaux de club, matériel…).",
  },
  {
    id: 'profile', visual: 'profile', tab: 'Ta photo, en haut à droite', title: 'Ton profil et tes mesures',
    text: "Touche ta photo en haut à droite pour ouvrir ton profil (photo, mesures, santé, records). VMA, FTP, CSS, fréquences cardiaques : plus elles sont justes, plus tes allures le sont. Inconnues ? Le coach te proposera des tests.",
  },
  {
    id: 'tools', visual: 'tools', tab: 'Bouton + au centre', title: 'Actions rapides et outils',
    text: "Le bouton + au centre de la barre du bas ouvre la séance du jour, le coach, et les outils : checklist de course, météo, nutrition, parcours, pression des pneus, matériel.",
  },
  {
    id: 'strava', visual: 'strava', title: 'Strava (conseillé)',
    text: "Connecte Strava dans les réglages (touche ta photo en haut à droite, puis ⚙️) : l'app reconnaît tes séances faites, calcule ta forme et ta fatigue, et le coach tient compte de ce que tu fais vraiment. Sans Strava, tout fonctionne aussi, en confirmant tes séances à la main.",
  },
  {
    id: 'end', visual: 'end', title: 'Tu es prêt !',
    text: "Le bouton ❓ en haut te permet de revoir cette visite, de consulter le lexique (VMA, FTP, zones…) et les questions fréquentes. Les petits « ? » à côté des termes techniques les expliquent aussi.",
  },
];

export const TAB_TIPS = {
  today: "Ton point de départ chaque jour : la séance du jour, demain, et les séances passées à confirmer. Touche une séance pour voir son détail.",
  calendar: "Ta semaine en cours et la suivante. Glisse pour voir tous les jours, touche une séance pour ouvrir sa feuille. Filtre par sport avec TOUT / SWIM (natation) / BIKE (vélo) / RUN (course).",
  chat: "Parle au coach comme à un entraîneur : fatigue, douleur, imprévu, question. Il peut modifier ton plan et t'explique ce qu'il change.",
  objective: "Ta saison : phases, date de l'objectif et « Réglages du plan » (jours de repos, temps disponible, cycle, priorités). Modifiables à tout moment.",
  profile: "Ton profil s'ouvre en touchant ta photo en haut à droite. Tes mesures (VMA, FTP, CSS, FC) et tes zones : plus elles sont justes, plus tes allures le sont. Touche ✏️ pour modifier une valeur, « ? » pour une explication.",
  tools: "Les outils s'ouvrent depuis le bouton + au centre de la barre du bas. Fais défiler les onglets pour passer de l'un à l'autre.",
};

export const FAQ = [
  {
    q: 'Par où commencer ?',
    a: "Réponds au questionnaire (5 étapes, 2 minutes). Plus tes réponses sont précises (temps disponible, mesures), plus le plan est juste. Tu pourras tout modifier ensuite dans Objectif → Réglages du plan.",
  },
  {
    q: 'Je ne connais pas ma VMA, ma FTP ou ma CSS',
    a: "Laisse vide. Le coach te proposera un test simple dans une prochaine semaine (jamais plus de 1 à 3 par semaine), puis calculera tes allures. En attendant, les séances utilisent l'effort perçu (RPE).",
  },
  {
    q: 'Comment modifier une séance ?',
    a: "Écris-le au coach dans l'onglet Coach Chat, avec tes mots : « décale ma sortie longue à dimanche », « je n'ai qu'une heure jeudi », « remplace la natation de mardi par du vélo ». Il modifie le plan et te dit ce qu'il a changé.",
  },
  {
    q: "J'ai raté une séance, je fais quoi ?",
    a: "Dans Aujourd'hui, marque-la « Pas faite », puis touche « Réorganiser avec le coach ». Le plus souvent, mieux vaut passer à la suite que tout rattraper : le coach ne réempile pas les séances manquées.",
  },
  {
    q: 'Pourquoi valider mes séances ?',
    a: "Ton ressenti (difficulté, forme) permet au coach d'ajuster les semaines suivantes : plus léger si tu es fatigué, plus dense si tout te paraît trop facile.",
  },
  {
    q: 'Pourquoi une séance a-t-elle changé toute seule ?',
    a: "L'app applique des règles de sécurité (pas deux grosses séances d'affilée, respect de ton temps disponible, affûtage…). Quand elle ajuste une séance, la raison s'affiche en petit (ⓘ) dans son détail.",
  },
  {
    q: 'À quoi sert Strava ?',
    a: "Connecté (ta photo en haut à droite → ⚙️ Réglages), Strava transmet tes activités : l'app reconnaît les séances faites, calcule ta forme et ta fatigue, et le coach tient compte de ce que tu fais vraiment. Sans Strava, tout fonctionne en confirmant tes séances à la main.",
  },
  {
    q: "Le coach dit que l'IA est indisponible",
    a: "Les services d'IA utilisés ont des quotas gratuits limités. Réessaie un peu plus tard : ton plan reste accessible et utilisable en attendant.",
  },
  {
    q: 'Qui voit mes données ?',
    a: "Ton plan et ton profil sont enregistrés sur ton téléphone et, si tu es connecté, dans ton compte. Pour générer un plan ou répondre dans le chat, les informations nécessaires (profil sportif, séances) sont envoyées aux services d'IA utilisés par l'app (Google Gemini, Groq, et Mistral en secours), selon leurs conditions d'utilisation.",
  },
  {
    q: 'Comment revoir ce tutoriel ?',
    a: "Touche le bouton ❓ en haut à droite, puis « Revoir la visite guidée ».",
  },
];
