// lib/referenceWeeks.js
//
// BIBLIOTHÈQUE DE SEMAINES MODÈLES ("few-shot") — rédigées par Claude Opus 5.5.
//
// But : élever la qualité des réponses des modèles gratuits (Gemini Flash, gpt-oss, Mistral)
// en leur montrant UN exemple de semaine rédigée avec rigueur, choisi au plus près du profil
// de l'athlète (discipline/format × niveau). Un modèle suit bien mieux un exemple concret
// qu'une liste de règles abstraites.
//
// Choix délibérés :
//   - 6 familles × 3 niveaux = 18 semaines, toutes en phase de DÉVELOPPEMENT (la phase réelle
//     de l'athlète est donnée par ailleurs dans le prompt) ;
//   - intensités exprimées en REPÈRES DE ZONE ("@Z4 seuil", "CSS"), jamais en chiffres : le
//     modèle doit convertir avec les zones de l'athlète réel (impossible de recopier les
//     allures d'un autre coureur) ;
//   - chaque semaine est VALIDÉE par le validateur de l'app (test/referenceWeeks.test.js) :
//     nombre de séances, jour de repos, disciplines par jour, "Total" natation au mètre près,
//     volume ±15 %, espacement des séances dures selon le niveau ;
//   - une seule semaine est injectée par génération (~2 000 caractères), avec la consigne de
//     s'en inspirer sans la recopier. Désactivable : AI_REFERENCE_WEEKS=false.

const S = (day, type, title, duration, intensity, effortZone, desc, restTime = '-') => ({
  day, type, title, duration, intensity, effortZone, restTime, desc,
});

const NAT_14 = "Échauffement :\n200 NC souple Z1\n4*50 educ R : 20''\nCorps de séance :\n6*100 NC Z2 R : 20''\n4*50 educ (rattrapé) R : 20''\n---\n200 souple\nTotal : 1400m";
const NAT_15 = "Échauffement :\n200 NC souple Z1\n4*50 educ R : 20''\nCorps de séance :\n5*100 NC Z2 R : 20''\n6*50 educ (rattrapé) R : 20''\n---\n300 souple\nTotal : 1500m";
const NAT_30_END = "Échauffement :\n400 NC souple Z1\n4*50 educ R : 15''\nCorps de séance :\n3*400 PULL Z2 R : 30''\n8*100 NC Z3 R : 15''\n---\n400 souple\nTotal : 3000m";

export const REFERENCE_WEEKS = [
  // ------------------------------------------------------------ COURSE SUR ROUTE (10 km – semi)
  {
    id: 'run-road-debutant', family: 'run-road', level: 'debutant',
    label: 'course sur route 10 km, débutant, 3 séances, ~3 h',
    context: { sportType: 'running', hoursPerWeek: 3, maxSessionsPerWeek: 3, offDays: 'Lundi' },
    week: [
      S('Mardi', 'C.A.P', 'Footing endurance fondamentale', '45 min', 'Z2 endurance', 'Z2', "Échauffement :\n10' marche rapide puis trot très souple\nCorps de séance :\n30' continu Z2, allure conversationnelle\n5' marche"),
      S('Jeudi', 'C.A.P', 'Fractionné court 6x2\'', '50 min', 'Z4 allure 10 km', 'Z4', "Échauffement :\n15' footing Z2\nCorps de séance :\n6*(2' @Z4 allure 10 km - 2' trot)\n10' retour au calme Z1", "2' trot"),
      S('Samedi', 'C.A.P', 'Sortie longue progressive', '1h15', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n55' continu Z2 (dernières 10' en haut de Z2)\n10' retour au calme Z1"),
    ],
  },
  {
    id: 'run-road-intermediaire', family: 'run-road', level: 'intermediaire',
    label: 'course sur route 10 km – semi, intermédiaire, 4 séances, ~5 h',
    context: { sportType: 'running', hoursPerWeek: 5, maxSessionsPerWeek: 4, offDays: 'Lundi' },
    week: [
      S('Mardi', 'C.A.P', 'VMA courte 10x400', '1h00', 'Z5 VMA', 'Z5', "Échauffement :\n20' footing Z2 + 3 lignes droites\nCorps de séance :\n10*(400m @Z5 VMA - 1'15 trot)\n15' retour au calme Z1", "1'15 trot"),
      S('Mercredi', 'C.A.P', 'Footing endurance fondamentale', '1h00', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n45' continu Z2\n5' retour au calme"),
      S('Vendredi', 'C.A.P', 'Seuil 3x8\'', '1h05', 'Z4 seuil', 'Z4', "Échauffement :\n20' footing Z2 + 3 lignes droites\nCorps de séance :\n3*(8' @Z4 seuil - 2' trot)\n15' retour au calme Z1", "2' trot"),
      S('Dimanche', 'C.A.P', 'Sortie longue endurance', '1h40', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n1h25 continu Z2\n5' retour au calme"),
    ],
  },
  {
    id: 'run-road-expert', family: 'run-road', level: 'expert',
    label: 'course sur route 10 km – semi, expert, 7 séances, ~8 h',
    context: { sportType: 'running', hoursPerWeek: 8, maxSessionsPerWeek: 7, offDays: 'Lundi' },
    week: [
      S('Mardi', 'C.A.P', 'VMA courte 12x400', '1h10', 'Z5 VMA', 'Z5', "Échauffement :\n20' footing Z2 + gammes + 3 lignes droites\nCorps de séance :\n12*(400m @Z5 VMA - 1' trot)\n15' retour au calme Z1", "1' trot"),
      S('Mardi', 'C.A.P', 'PPG gainage et pieds', '30 min', 'RPE 3/10', 'Z1', "Échauffement :\n5' mobilité chevilles/hanches\nCorps de séance :\n3*(45'' planche - 30'' gainage latéral par côté - 15 montées sur pointes par pied)\n5' étirements doux", "30''"),
      S('Mercredi', 'C.A.P', 'Footing endurance fondamentale', '1h10', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n55' continu Z2\n5' retour au calme"),
      S('Jeudi', 'C.A.P', 'Seuil 3x10\'', '1h15', 'Z4 seuil', 'Z4', "Échauffement :\n20' footing Z2 + 3 lignes droites\nCorps de séance :\n3*(10' @Z4 seuil - 2' trot)\n19' retour au calme Z1-Z2", "2' trot"),
      S('Vendredi', 'C.A.P', 'Footing récupération', '45 min', 'Z1 récupération', 'Z1', "Échauffement :\n5' très souple\nCorps de séance :\n35' continu Z1\n5' marche"),
      S('Samedi', 'C.A.P', 'Footing et lignes droites', '1h00', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n40' continu Z2\n6*(20'' vif relâché - 1' marche)\n4' retour au calme", "1' marche"),
      S('Dimanche', 'C.A.P', 'Sortie longue, fin allure semi', '1h45', 'Z2 puis Z3', 'Z2-Z3', "Échauffement :\n10' très souple\nCorps de séance :\n1h15 continu Z2\n15' Z3 allure semi\n5' retour au calme"),
    ],
  },

  // ------------------------------------------------------------ TRAIL (~30-40 km, dénivelé)
  {
    id: 'trail-debutant', family: 'trail', level: 'debutant',
    label: 'trail ~30 km, débutant, 3 séances, ~3 h 30',
    context: { sportType: 'running', runningSubtype: 'trail', hoursPerWeek: 3.5, maxSessionsPerWeek: 3, offDays: 'Lundi' },
    week: [
      S('Mardi', 'C.A.P', 'Footing vallonné', '50 min', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple sur le plat\nCorps de séance :\n35' continu Z2 sur parcours vallonné, marche active dans les montées raides\n5' retour au calme"),
      S('Jeudi', 'C.A.P', 'Côtes courtes 8x45\'\'', '55 min', 'Z5 effort en côte', 'Z5', "Échauffement :\n20' footing Z2\nCorps de séance :\n8*(45'' côte effort soutenu - descente trot)\n15' retour au calme Z1", 'Descente trot'),
      S('Samedi', 'C.A.P', 'Sortie longue trail', '1h45', 'Z2 endurance', 'Z2', "Échauffement :\n15' progressif\nCorps de séance :\n1h20 sur sentier Z2 (~400 m D+), marche active dans les pentes raides, descentes souples\n10' retour au calme"),
    ],
  },
  {
    id: 'trail-intermediaire', family: 'trail', level: 'intermediaire',
    label: 'trail ~30-40 km, intermédiaire, 4 séances, ~5 h 30',
    context: { sportType: 'running', runningSubtype: 'trail', hoursPerWeek: 5.5, maxSessionsPerWeek: 4, offDays: 'Lundi' },
    week: [
      S('Mardi', 'C.A.P', 'Côtes longues 6x3\'', '1h05', 'Z4 effort en côte', 'Z4', "Échauffement :\n20' footing Z2\nCorps de séance :\n6*(3' côte @Z4 - descente trot)\n15' retour au calme Z1", 'Descente trot'),
      S('Jeudi', 'C.A.P', 'Footing endurance fondamentale', '1h00', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n45' continu Z2\n5' retour au calme"),
      S('Samedi', 'C.A.P', 'Sortie longue trail', '2h30', 'Z2 endurance', 'Z2', "Échauffement :\n15' progressif\nCorps de séance :\n2h05 sur sentier Z2 (~900 m D+), bâtons si utilisés en course, travail des descentes en relâchement\n10' retour au calme"),
      S('Dimanche', 'C.A.P', 'Footing récupération', '45 min', 'Z1 récupération', 'Z1', "Échauffement :\n5' très souple\nCorps de séance :\n35' continu Z1 sur terrain souple\n5' marche"),
    ],
  },
  {
    id: 'trail-expert', family: 'trail', level: 'expert',
    label: 'trail ~40-80 km, expert, 6 séances, ~9 h',
    context: { sportType: 'running', runningSubtype: 'trail', hoursPerWeek: 9, maxSessionsPerWeek: 6, offDays: 'Lundi' },
    week: [
      S('Mardi', 'C.A.P', 'Côtes longues 5x5\'', '1h20', 'Z4 effort en côte', 'Z4', "Échauffement :\n25' footing Z2\nCorps de séance :\n5*(5' côte @Z4 - descente trot)\n15' retour au calme Z1", 'Descente trot'),
      S('Mardi', 'C.A.P', 'Renforcement excentrique', '30 min', 'RPE 4/10', 'Z1', "Échauffement :\n5' mobilité\nCorps de séance :\n3*(12 descentes de marche lentes par jambe - 12 fentes arrière - 45'' chaise)\n5' étirements doux", "1'"),
      S('Mercredi', 'C.A.P', 'Footing endurance fondamentale', '1h15', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n1h00 continu Z2\n5' retour au calme"),
      S('Jeudi', 'C.A.P', 'Seuil en montée 3x10\'', '1h20', 'Z4 seuil', 'Z4', "Échauffement :\n25' footing Z2\nCorps de séance :\n3*(10' montée régulière @Z4 seuil - 3' redescente trot)\n16' retour au calme Z1", "3' trot"),
      S('Samedi', 'C.A.P', 'Sortie longue trail', '3h30', 'Z2 endurance', 'Z2', "Échauffement :\n15' progressif\nCorps de séance :\n3h05 sur sentier Z2 (~1 500 m D+), ravitaillement toutes les 45', descentes techniques relâchées\n10' retour au calme"),
      S('Dimanche', 'C.A.P', 'Footing jambes fatiguées', '1h15', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n1h00 continu Z2 vallonné\n5' retour au calme"),
    ],
  },

  // ------------------------------------------------------------ TRIATHLON COURT (XS / S)
  {
    id: 'tri-short-debutant', family: 'tri-short', level: 'debutant',
    label: 'triathlon XS/S, débutant, 4 séances, ~4 h',
    context: { sportType: 'triathlon', triathlonFormat: 'S', hoursPerWeek: 4, maxSessionsPerWeek: 4, offDays: 'Lundi' },
    week: [
      S('Mardi', 'NATATION', 'Technique et endurance', '50 min', 'Z2 endurance', 'Z1-Z2', NAT_14, "20''"),
      S('Jeudi', 'C.A.P', 'Fractionné court 6x2\'', '50 min', 'Z4 allure course', 'Z4', "Échauffement :\n15' footing Z2\nCorps de séance :\n6*(2' @Z4 - 2' trot)\n11' retour au calme Z1", "2' trot"),
      S('Samedi', 'ENCHAÎNEMENT', 'Enchaînement vélo-course', '1h55', 'Z2', 'Z2-Z3', "Échauffement :\n15' vélo progressif\nCorps de séance :\n1h10 vélo Z2, cadence 85-95 rpm\nTransition calme (chaussures, casque détaché une fois le vélo posé)\n20' course Z2 puis 5' Z3\nRetour au calme : 5' marche"),
    ],
  },
  {
    id: 'tri-short-intermediaire', family: 'tri-short', level: 'intermediaire',
    label: 'triathlon XS/S, intermédiaire, 6 séances, ~6 h',
    context: { sportType: 'triathlon', triathlonFormat: 'S', hoursPerWeek: 6, maxSessionsPerWeek: 6, offDays: 'Lundi' },
    week: [
      S('Mardi', 'NATATION', 'Endurance aérobie', '45 min', 'Z2 endurance', 'Z2', "Échauffement :\n300 NC souple Z1\n4*50 educ R : 20''\nCorps de séance :\n4*200 NC Z2 R : 20''\n4*100 PULL Z2 R : 15''\n---\n300 souple\nTotal : 2000m", "15-20''"),
      S('Mercredi', 'C.A.P', 'Fractionné 5x3\'', '55 min', 'Z4 allure course', 'Z4', "Échauffement :\n20' footing Z2 + 3 lignes droites\nCorps de séance :\n5*(3' @Z4 - 1'30 trot)\n12' retour au calme Z1", "1'30 trot"),
      S('Jeudi', 'CYCLISME', 'Endurance Z2', '1h15', 'Z2 endurance', 'Z2', "Échauffement :\n15' progressif\nCorps de séance :\n50' continu Z2, cadence 85-95 rpm\n10' souple"),
      S('Vendredi', 'NATATION', 'Vitesse et départs', '45 min', 'Z5 vitesse', 'Z2-Z5', "Échauffement :\n300 NC souple Z1\n4*50 educ R : 20''\nCorps de séance :\n8*50 vite Z5 R : 30''\n4*100 NC Z3 R : 20''\n4*50 relâché Z2 R : 15''\n---\n300 souple\nTotal : 1800m", "15-30''"),
      S('Samedi', 'ENCHAÎNEMENT', 'Enchaînement vélo-course', '1h45', 'Z2', 'Z2-Z3', "Échauffement :\n15' vélo progressif\nCorps de séance :\n1h05 vélo Z2 dont 4*(1' relance Z3 - 4' Z2)\nTransition rapide\n20' course Z2-Z3\nRetour au calme : 5' marche", "4' Z2"),
    ],
  },
  {
    id: 'tri-short-expert', family: 'tri-short', level: 'expert',
    label: 'triathlon S avec aspiration, expert, 10 séances, ~12 h',
    context: { sportType: 'triathlon', triathlonFormat: 'S', hoursPerWeek: 12, maxSessionsPerWeek: 10, offDays: 'Lundi' },
    week: [
      S('Mardi', 'NATATION', 'Vitesse et départs groupés', '1h05', 'Z4-Z5 vitesse', 'Z2-Z5', "Échauffement :\n400 NC souple Z1\n4*50 educ R : 15''\n4*50 progressif R : 15''\nCorps de séance :\n3*(100 à fond R : 1' / 300 allure S Z3 R : 30'')\n8*50 départ plongé à fond Z5 R : 30''\n4*100 PLAQ Z2 R : 15''\n---\n400 souple\nTotal : 3200m", "15''-1'"),
      S('Mardi', 'C.A.P', 'Footing endurance fondamentale', '50 min', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n35' continu Z2\n5' retour au calme"),
      S('Mercredi', 'CYCLISME', 'Seuil 3x12\'', '1h45', 'Z4 seuil', 'Z4', "Échauffement :\n20' progressif + 3*1' vélocité\nCorps de séance :\n3*(12' @Z4 seuil - 5' souple Z1)\n34' Z2\n15' souple", "5' souple"),
      S('Mercredi', 'NATATION', 'Aérobie et éducatifs', '1h00', 'Z2 endurance', 'Z1-Z2', "Échauffement :\n400 NC souple Z1\n6*50 educ (rattrapé / doigts traînants) R : 15''\nCorps de séance :\n5*400 NC Z2 respiration 3 temps R : 20''\n---\n300 souple\nTotal : 3000m", "15-20''"),
      S('Jeudi', 'C.A.P', 'VMA courte 10x300', '1h00', 'Z5 VMA', 'Z5', "Échauffement :\n20' footing Z2 + gammes\nCorps de séance :\n10*(300m @Z5 VMA - 1' trot)\n20' retour au calme Z1-Z2", "1' trot"),
      S('Jeudi', 'CYCLISME', 'Récupération active', '50 min', 'Z1 récupération', 'Z1', "Échauffement :\n10' très souple\nCorps de séance :\n35' continu Z1, cadence 95-100 rpm\n5' souple"),
      S('Vendredi', 'NATATION', 'Séance longue, allures de course mêlées', '1h25', 'Z2 puis allures S / à fond', 'Z2-Z5', "Échauffement :\n400 NC souple Z1\n4*50 educ R : 15''\nCorps de séance :\n3*800 PULL Z2 R : 30''\n2*(200 all HALF R : 40'' / 2*50 all S R : 20'' / 100 à fond R : 1')\n---\n400 souple\nTotal : 4200m", "20''-1'"),
      S('Samedi', 'ENCHAÎNEMENT', 'Enchaînement avec relances de peloton', '2h40', 'Z2', 'Z2-Z3', "Échauffement :\n20' vélo progressif\nCorps de séance :\n1h50 vélo Z2 dont 6*(20'' relance à fond - 3' Z2)\nTransition rapide (< 1')\n25' course Z2-Z3\nRetour au calme : 5' marche", "3' Z2"),
      S('Dimanche', 'C.A.P', 'Sortie longue endurance', '1h15', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n1h00 continu Z2\n5' retour au calme"),
    ],
  },

  // ------------------------------------------------------------ TRIATHLON M (olympique)
  {
    id: 'tri-M-debutant', family: 'tri-M', level: 'debutant',
    label: 'triathlon M, débutant, 5 séances, ~5 h',
    context: { sportType: 'triathlon', triathlonFormat: 'M', hoursPerWeek: 5, maxSessionsPerWeek: 5, offDays: 'Lundi' },
    week: [
      S('Mardi', 'NATATION', 'Technique et endurance', '45 min', 'Z2 endurance', 'Z1-Z2', NAT_15, "20''"),
      S('Mercredi', 'C.A.P', 'Fractionné 5x3\'', '50 min', 'Z4', 'Z4', "Échauffement :\n15' footing Z2\nCorps de séance :\n5*(3' @Z4 - 2' trot)\n10' retour au calme Z1", "2' trot"),
      S('Jeudi', 'CYCLISME', 'Endurance Z2', '1h15', 'Z2 endurance', 'Z2', "Échauffement :\n15' progressif\nCorps de séance :\n50' continu Z2, cadence 85-95 rpm\n10' souple"),
      S('Samedi', 'ENCHAÎNEMENT', 'Enchaînement vélo-course', '1h45', 'Z2', 'Z2', "Échauffement :\n15' vélo progressif\nCorps de séance :\n1h05 vélo Z2\nTransition calme\n20' course Z2\nRetour au calme : 5' marche"),
    ],
  },
  {
    id: 'tri-M-intermediaire', family: 'tri-M', level: 'intermediaire',
    label: 'triathlon M, intermédiaire, 7 séances, ~8 h',
    context: { sportType: 'triathlon', triathlonFormat: 'M', hoursPerWeek: 8, maxSessionsPerWeek: 7, offDays: 'Lundi' },
    week: [
      S('Mardi', 'NATATION', 'Endurance aérobie', '50 min', 'Z2 endurance', 'Z2', "Échauffement :\n300 NC souple Z1\n4*50 educ R : 20''\nCorps de séance :\n3*300 NC Z2 R : 30''\n4*100 PULL Z2 R : 15''\n---\n400 souple\nTotal : 2200m", "15-30''"),
      S('Mardi', 'C.A.P', 'Footing endurance fondamentale', '45 min', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n30' continu Z2\n5' retour au calme"),
      S('Mercredi', 'CYCLISME', 'Seuil 2x15\'', '1h30', 'Z4 seuil', 'Z4', "Échauffement :\n20' progressif + 3*1' vélocité\nCorps de séance :\n2*(15' @Z4 seuil - 5' souple Z1)\n20' Z2\n10' souple", "5' souple"),
      S('Jeudi', 'NATATION', 'Technique', '45 min', 'Z2 endurance', 'Z1-Z2', "Échauffement :\n400 NC souple Z1\nCorps de séance :\n8*50 educ R : 15''\n4*200 NC Z2 respiration 3 temps R : 20''\n---\n400 souple\nTotal : 2000m", "15-20''"),
      S('Vendredi', 'C.A.P', 'Fractionné 6x4\'', '1h00', 'Z4 allure 10 km', 'Z4', "Échauffement :\n20' footing Z2 + 3 lignes droites\nCorps de séance :\n6*(4' @Z4 - 1'30 trot)\n7' retour au calme Z1", "1'30 trot"),
      S('Samedi', 'CYCLISME', 'Sortie longue Z2', '2h30', 'Z2 endurance', 'Z2', "Échauffement :\n20' progressif\nCorps de séance :\n2h00 continu Z2, alimentation toutes les 40'\n10' souple"),
      S('Dimanche', 'C.A.P', 'Sortie longue endurance', '1h15', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n1h00 continu Z2\n5' retour au calme"),
    ],
  },
  {
    id: 'tri-M-expert', family: 'tri-M', level: 'expert',
    label: 'triathlon M, expert, 10 séances, ~13 h',
    context: { sportType: 'triathlon', triathlonFormat: 'M', hoursPerWeek: 13, maxSessionsPerWeek: 10, offDays: 'Lundi' },
    week: [
      S('Mardi', 'NATATION', 'Seuil CSS 10x100', '1h00', 'CSS (Z4)', 'Z4', "Échauffement :\n400 NC souple Z1\n4*50 educ R : 15''\nCorps de séance :\n10*100 NC Z4 CSS R : 15''\n4*200 PULL Z2 R : 20''\n4*50 à fond Z5 R : 30''\n---\n400 souple\nTotal : 3000m", "15-30''"),
      S('Mardi', 'CYCLISME', 'Endurance Z2', '1h15', 'Z2 endurance', 'Z2', "Échauffement :\n15' progressif\nCorps de séance :\n50' continu Z2\n10' souple"),
      S('Mercredi', 'C.A.P', 'Seuil 3x10\'', '1h10', 'Z4 seuil', 'Z4', "Échauffement :\n20' footing Z2 + 3 lignes droites\nCorps de séance :\n3*(10' @Z4 seuil - 2' trot)\n14' retour au calme Z1", "2' trot"),
      S('Mercredi', 'NATATION', 'Aérobie et éducatifs', '55 min', 'Z2 endurance', 'Z1-Z2', "Échauffement :\n400 NC souple Z1\nCorps de séance :\n8*50 educ R : 15''\n5*300 NC Z2 respiration 3 temps R : 20''\n---\n500 souple dos/crawl\nTotal : 2800m", "15-20''"),
      S('Jeudi', 'CYCLISME', 'Sweet spot 3x15\'', '1h45', 'Z3-Z4 sweet spot', 'Z3-Z4', "Échauffement :\n20' progressif + 3*1' vélocité\nCorps de séance :\n3*(15' @Z3-Z4 sweet spot - 5' souple)\n15' Z2\n10' souple", "5' souple"),
      S('Vendredi', 'NATATION', 'Séance longue', '1h30', 'Z2 puis allure M', 'Z2-Z3', "Échauffement :\n400 NC souple Z1\n4*50 educ R : 15''\nCorps de séance :\n3*1000 PULL Z2 R : 40''\n4*100 NC Z3 allure M R : 15''\n---\n500 souple\nTotal : 4500m", "15-40''"),
      S('Vendredi', 'C.A.P', 'Footing endurance fondamentale', '50 min', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n35' continu Z2\n5' retour au calme"),
      S('Samedi', 'CYCLISME', 'Sortie longue Z2', '3h00', 'Z2 endurance', 'Z2', "Échauffement :\n20' progressif\nCorps de séance :\n2h30 continu Z2, alimentation toutes les 40'\n10' souple"),
      S('Dimanche', 'ENCHAÎNEMENT', 'Enchaînement à allure course', '2h00', 'Allure course (Z3-Z4)', 'Z3-Z4', "Échauffement :\n20' vélo progressif\nCorps de séance :\n1h00 vélo dont 3*(10' @Z3-Z4 allure M - 5' Z2)\nTransition rapide (< 1')\n30' course dont 20' @Z3-Z4 allure M\nRetour au calme : 10' trot et marche", "5' Z2"),
    ],
  },

  // ------------------------------------------------------------ TRIATHLON LONG (L / XL)
  {
    id: 'tri-long-debutant', family: 'tri-long', level: 'debutant',
    label: 'triathlon L/XL, débutant, 6 séances, ~8 h',
    context: { sportType: 'triathlon', triathlonFormat: 'L', hoursPerWeek: 8, maxSessionsPerWeek: 6, offDays: 'Lundi' },
    week: [
      S('Mardi', 'NATATION', 'Endurance aérobie', '50 min', 'Z2 endurance', 'Z2', "Échauffement :\n300 NC souple Z1\n4*50 educ R : 20''\nCorps de séance :\n3*300 NC Z2 R : 30''\n---\n400 souple\nTotal : 1800m", "20-30''"),
      S('Mercredi', 'C.A.P', 'Footing avec tempo', '50 min', 'Z2 puis Z3', 'Z2-Z3', "Échauffement :\n15' footing Z2\nCorps de séance :\n2*(8' Z3 tempo - 3' trot)\n13' retour au calme Z1", "3' trot"),
      S('Jeudi', 'CYCLISME', 'Endurance Z2', '1h30', 'Z2 endurance', 'Z2', "Échauffement :\n15' progressif\nCorps de séance :\n1h05 continu Z2, cadence 85-95 rpm\n10' souple"),
      S('Vendredi', 'NATATION', 'Technique', '45 min', 'Z2 endurance', 'Z1-Z2', NAT_15, "20''"),
      S('Samedi', 'CYCLISME', 'Sortie longue Z2', '3h00', 'Z2 endurance', 'Z2', "Échauffement :\n20' progressif\nCorps de séance :\n2h30 continu Z2, boire et manger toutes les 30-40'\n10' souple"),
      S('Dimanche', 'C.A.P', 'Sortie longue endurance', '1h15', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n1h00 continu Z2\n5' retour au calme"),
    ],
  },
  {
    id: 'tri-long-intermediaire', family: 'tri-long', level: 'intermediaire',
    label: 'triathlon L/XL, intermédiaire, 8 séances, ~11 h',
    context: { sportType: 'triathlon', triathlonFormat: 'L', hoursPerWeek: 11, maxSessionsPerWeek: 8, offDays: 'Lundi' },
    week: [
      S('Mardi', 'NATATION', 'Endurance longue', '55 min', 'Z2 endurance', 'Z2', "Échauffement :\n300 NC souple Z1\n4*50 educ R : 20''\nCorps de séance :\n2*600 NC Z2 R : 45''\n4*100 PULL Z2 R : 15''\n---\n400 souple\nTotal : 2500m", "15-45''"),
      S('Mardi', 'C.A.P', 'Footing endurance fondamentale', '50 min', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n35' continu Z2\n5' retour au calme"),
      S('Mercredi', 'CYCLISME', 'Sweet spot 3x15\'', '1h45', 'Z3-Z4 sweet spot', 'Z3-Z4', "Échauffement :\n20' progressif\nCorps de séance :\n3*(15' @Z3-Z4 sweet spot - 5' souple)\n15' Z2\n10' souple", "5' souple"),
      S('Jeudi', 'NATATION', 'Pull-buoy et allure', '1h00', 'Z2-Z3', 'Z2-Z3', "Échauffement :\n400 NC souple Z1\nCorps de séance :\n4*400 PULL Z2 R : 30''\n4*100 NC Z3 R : 15''\n---\n400 souple\nTotal : 2800m", "15-30''"),
      S('Jeudi', 'CYCLISME', 'Récupération active', '45 min', 'Z1 récupération', 'Z1', "Échauffement :\n10' très souple\nCorps de séance :\n30' continu Z1, cadence élevée\n5' souple"),
      S('Vendredi', 'C.A.P', 'Seuil 3x10\'', '1h05', 'Z4 seuil', 'Z4', "Échauffement :\n20' footing Z2\nCorps de séance :\n3*(10' @Z4 seuil - 2' trot)\n9' retour au calme Z1", "2' trot"),
      S('Samedi', 'CYCLISME', 'Sortie longue Z2', '4h00', 'Z2 endurance', 'Z2', "Échauffement :\n20' progressif\nCorps de séance :\n3h30 continu Z2, stratégie nutrition de course testée (glucides toutes les 20-30')\n10' souple"),
      S('Dimanche', 'C.A.P', 'Sortie longue endurance', '1h30', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n1h15 continu Z2\n5' retour au calme"),
    ],
  },
  {
    id: 'tri-long-expert', family: 'tri-long', level: 'expert',
    label: 'triathlon L/XL, expert, 11 séances, ~16 h',
    context: { sportType: 'triathlon', triathlonFormat: 'XL', hoursPerWeek: 16, maxSessionsPerWeek: 11, offDays: 'Lundi' },
    week: [
      S('Mardi', 'NATATION', 'Seuil CSS 5x300', '1h10', 'CSS (Z4)', 'Z4', "Échauffement :\n400 NC souple Z1\n4*50 educ R : 15''\nCorps de séance :\n5*300 NC Z4 CSS R : 20''\n2*400 PULL Z2 R : 30''\n---\n600 souple\nTotal : 3500m", "20-30''"),
      S('Mardi', 'C.A.P', 'Footing endurance fondamentale', '1h00', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n45' continu Z2\n5' retour au calme"),
      S('Mercredi', 'CYCLISME', 'Seuil 3x20\'', '2h15', 'Z4 seuil', 'Z4', "Échauffement :\n20' progressif + 3*1' vélocité\nCorps de séance :\n3*(20' @Z4 seuil - 5' souple)\n30' Z2\n10' souple", "5' souple"),
      S('Mercredi', 'NATATION', 'Aérobie et éducatifs', '55 min', 'Z2 endurance', 'Z1-Z2', "Échauffement :\n400 NC souple Z1\nCorps de séance :\n8*50 educ R : 15''\n4*400 NC Z2 respiration 3 temps R : 30''\n---\n400 souple\nTotal : 2800m", "15-30''"),
      S('Jeudi', 'C.A.P', 'Tempo 3x15\'', '1h15', 'Z3 tempo', 'Z3', "Échauffement :\n15' footing Z2\nCorps de séance :\n3*(15' Z3 tempo - 3' trot)\n6' retour au calme Z1", "3' trot"),
      S('Jeudi', 'CYCLISME', 'Récupération active', '1h00', 'Z1 récupération', 'Z1', "Échauffement :\n10' très souple\nCorps de séance :\n45' continu Z1, cadence élevée\n5' souple"),
      S('Vendredi', 'NATATION', 'Séance longue', '1h30', 'Z2 endurance', 'Z2-Z3', "Échauffement :\n400 NC souple Z1\n4*50 educ R : 15''\nCorps de séance :\n3*1000 PULL Z2 R : 45''\n4*100 NC Z3 allure L R : 15''\n---\n500 souple\nTotal : 4500m", "15-45''"),
      S('Vendredi', 'CYCLISME', 'Endurance Z2', '1h30', 'Z2 endurance', 'Z2', "Échauffement :\n15' progressif\nCorps de séance :\n1h05 continu Z2\n10' souple"),
      S('Samedi', 'ENCHAÎNEMENT', 'Sortie longue enchaînée', '5h00', 'Z2', 'Z2-Z3', "Échauffement :\n20' vélo progressif\nCorps de séance :\n4h00 vélo Z2, nutrition de course (glucides toutes les 20-30')\nTransition\n30' course Z2 puis 10' Z3\nRetour au calme : 10' marche"),
      S('Dimanche', 'C.A.P', 'Sortie longue endurance', '1h45', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n1h30 continu Z2\n5' retour au calme"),
    ],
  },

  // ------------------------------------------------------------ DUATHLON (S : course / vélo / course)
  {
    id: 'duathlon-debutant', family: 'duathlon', level: 'debutant',
    label: 'duathlon XS/S, débutant, 4 séances, ~4 h',
    context: { sportType: 'duathlon', triathlonFormat: 'S', hoursPerWeek: 4, maxSessionsPerWeek: 4, offDays: 'Lundi' },
    week: [
      S('Mardi', 'CYCLISME', 'Endurance Z2', '1h00', 'Z2 endurance', 'Z2', "Échauffement :\n10' progressif\nCorps de séance :\n40' continu Z2, cadence 85-95 rpm\n10' souple"),
      S('Jeudi', 'C.A.P', 'Fractionné court 6x2\'', '50 min', 'Z4 allure course', 'Z4', "Échauffement :\n15' footing Z2\nCorps de séance :\n6*(2' @Z4 - 2' trot)\n11' retour au calme Z1", "2' trot"),
      S('Samedi', 'ENCHAÎNEMENT', 'Enchaînement course-vélo-course', '1h40', 'Z2', 'Z2-Z3', "Échauffement :\n10' footing Z2\nCorps de séance :\n15' course Z2\nTransition calme\n45' vélo Z2\nTransition calme\n15' course Z2-Z3\nRetour au calme : 10' marche"),
    ],
  },
  {
    id: 'duathlon-intermediaire', family: 'duathlon', level: 'intermediaire',
    label: 'duathlon S, intermédiaire, 5 séances, ~6 h',
    context: { sportType: 'duathlon', triathlonFormat: 'S', hoursPerWeek: 6, maxSessionsPerWeek: 5, offDays: 'Lundi' },
    week: [
      S('Mardi', 'C.A.P', 'VMA courte 10x300', '55 min', 'Z5 VMA', 'Z5', "Échauffement :\n20' footing Z2 + 3 lignes droites\nCorps de séance :\n10*(300m @Z5 VMA - 1' trot)\n15' retour au calme Z1", "1' trot"),
      S('Mercredi', 'CYCLISME', 'Endurance Z2', '1h15', 'Z2 endurance', 'Z2', "Échauffement :\n15' progressif\nCorps de séance :\n50' continu Z2\n10' souple"),
      S('Vendredi', 'CYCLISME', 'Seuil 3x8\'', '1h15', 'Z4 seuil', 'Z4', "Échauffement :\n20' progressif\nCorps de séance :\n3*(8' @Z4 seuil - 4' souple)\n19' Z2", "4' souple"),
      S('Samedi', 'ENCHAÎNEMENT', 'Enchaînement course-vélo-course', '1h55', 'Z2-Z3', 'Z2-Z3', "Échauffement :\n15' footing Z2\nCorps de séance :\n20' course Z2-Z3\nTransition rapide\n1h00 vélo Z2 dont 3*(3' Z3 - 3' Z2)\nTransition rapide\n15' course Z2-Z3 (relâchement des premières minutes)\nRetour au calme : 5' marche", "3' Z2"),
    ],
  },
  {
    id: 'duathlon-expert', family: 'duathlon', level: 'expert',
    label: 'duathlon S (type D3), expert, 8 séances, ~10 h',
    context: { sportType: 'duathlon', triathlonFormat: 'S', hoursPerWeek: 10, maxSessionsPerWeek: 8, offDays: 'Lundi' },
    week: [
      S('Mardi', 'C.A.P', 'VMA courte 10x400', '1h00', 'Z5 VMA', 'Z5', "Échauffement :\n20' footing Z2 + gammes\nCorps de séance :\n10*(400m @Z5 VMA - 1'15 trot)\n15' retour au calme Z1", "1'15 trot"),
      S('Mardi', 'CYCLISME', 'Récupération active', '45 min', 'Z1 récupération', 'Z1', "Échauffement :\n10' très souple\nCorps de séance :\n30' continu Z1, cadence élevée\n5' souple"),
      S('Mercredi', 'CYCLISME', 'Seuil 3x12\'', '1h40', 'Z4 seuil', 'Z4', "Échauffement :\n20' progressif + 3*1' vélocité\nCorps de séance :\n3*(12' @Z4 seuil - 5' souple)\n29' Z2", "5' souple"),
      S('Mercredi', 'C.A.P', 'Footing endurance fondamentale', '1h00', 'Z2 endurance', 'Z2', "Échauffement :\n10' très souple\nCorps de séance :\n45' continu Z2\n5' retour au calme"),
      S('Vendredi', 'CYCLISME', 'Endurance Z2', '1h45', 'Z2 endurance', 'Z2', "Échauffement :\n15' progressif\nCorps de séance :\n1h20 continu Z2\n10' souple"),
      S('Vendredi', 'C.A.P', 'PPG gainage et pieds', '30 min', 'RPE 3/10', 'Z1', "Échauffement :\n5' mobilité\nCorps de séance :\n3*(45'' planche - 30'' gainage latéral par côté - 15 montées sur pointes par pied)\n5' étirements doux", "30''"),
      S('Samedi', 'ENCHAÎNEMENT', 'Enchaînement course-vélo-course à allure course', '2h30', 'Allure course (Z4)', 'Z3-Z4', "Échauffement :\n20' footing Z2 + 3 lignes droites\nCorps de séance :\n2*(2 km course @Z4 allure course - 20' vélo @Z3-Z4 - 1 km course @Z4) avec 10' Z2 entre les 2 blocs\nTransitions rapides (casque attaché avant de toucher le vélo)\n30' vélo Z2\nRetour au calme : 10' trot et marche", "10' Z2"),
    ],
  },
];

// ---------------------------------------------------------------------------------------
// Sélection et rendu
// ---------------------------------------------------------------------------------------

const EXPERIENCE_RANK = { debutant: 1, novice: 2, intermediaire: 3, confirme: 4, expert: 5 };

export function referenceFamily(wizardData = {}) {
  if (wizardData.sportType === 'running') return wizardData.runningSubtype === 'trail' ? 'trail' : 'run-road';
  if (wizardData.sportType === 'duathlon') return 'duathlon';
  const fmt = wizardData.triathlonFormat;
  if (fmt === 'L' || fmt === 'XL') return 'tri-long';
  if (fmt === 'M') return 'tri-M';
  return 'tri-short';
}

export function referenceLevel(wizardData = {}) {
  const rank = EXPERIENCE_RANK[wizardData.trainingExperience] || 3;
  if (rank <= 2) return 'debutant';
  if (rank === 3) return 'intermediaire';
  return 'expert';
}

export function pickReferenceWeek(wizardData = {}) {
  if (String(process.env.AI_REFERENCE_WEEKS || '').toLowerCase() === 'false') return null;
  const family = referenceFamily(wizardData);
  const level = referenceLevel(wizardData);
  return REFERENCE_WEEKS.find((r) => r.family === family && r.level === level) || null;
}

/** Bloc de prompt : l'exemple le plus proche du profil, avec la consigne d'adaptation. */
export function referenceWeekBlock(wizardData = {}) {
  const ref = pickReferenceWeek(wizardData);
  if (!ref) return '';
  const lines = ref.week.map((w) => `- ${w.day} — ${w.type} « ${w.title} » ${w.duration} — ${w.intensity}\n  ${w.desc.replace(/\n+/g, ' / ')}`);
  return `EXEMPLE DE RÉFÉRENCE (profil proche : ${ref.label}, phase de développement, repos le lundi)
Il montre le NIVEAU DE QUALITÉ attendu : séances clés espacées, notation précise, durée cohérente avec le contenu, natation au mètre près. Ce n'est PAS le plan de cet athlète : son nombre de séances, son volume, ses jours de repos, sa phase, ses disponibilités et ses priorités priment. Remplace chaque repère de zone (Z2, Z4 seuil, CSS…) par la valeur chiffrée des zones de l'athlète, et ne recopie ni les titres ni l'enchaînement à l'identique.
${lines.join('\n')}`;
}
