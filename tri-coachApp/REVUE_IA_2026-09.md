# Revue de code & refonte de la couche IA — septembre 2026

Objectif de la revue : vérifier que tout fonctionne et améliorer la qualité des réponses IA
(génération de plan, régénération de semaine, chat coach), identifiée comme le point faible.

## 1. Diagnostic mesuré

Un banc d'essai (`test/aiPipeline.test.js`, fixture `test/fixtures/marinPlan.js`) simule une IA
qui renvoie un plan **cohérent** — celui qu'écrirait un coach pour un triathlète expert, format S
avec aspiration, 18 h, 12 séances, repos le dimanche — et mesure ce que le pipeline en fait.
Même fixture pour les deux versions.

| | Avant | Après |
|---|---|---|
| Appels IA par génération (et par fournisseur) | 4 | 2 |
| Taille du prompt de génération | ~28 000 caractères | ~6 500 |
| Séances modifiées par le code sur 12 | 6 | 0 |
| Tests unitaires | 23/24 | 169/169 |

Ce que l'ancien pipeline faisait au plan cohérent :

- **Seuil vélo 3×15' (séance clé) détruit** : titre « (allégée) », intensité « Endurance
  fondamentale », description « 3*(15' @345W…) » inchangée → séance contradictoire.
- **Footing EF 4:55/km → 4:00/km** : l'allure de l'IA était remplacée par 75 % VMA, trop rapide
  pour de l'endurance fondamentale.
- **Course enchaînée à 4:05/km (allure course) écrasée** : sa description contenait « 8' Z2 »
  en fin de séance, ce qui suffisait à la classer « endurance continue ».
- **Natation de récupération 40 min → 1h16** : plancher unique de 3200 m pour un expert, quel
  que soit le format visé et le rôle de la séance.
- **2 appels IA de « complétion » inutiles** à chaque génération : les entrées REPOS sans champ
  `intensity` étaient jugées incomplètes.

Conclusion : une grande partie de la mauvaise qualité perçue ne venait pas des modèles, mais du
code qui dégradait leurs réponses après coup.

## 2. Problèmes de fond relevés

**Prompts contradictoires** (ancien `buildWorkoutSchema`, lib/gemini.js) :
- « EXACTEMENT 7 − N jours REPOS » → « -5 jours REPOS » pour 12 séances ;
- « MAXIMUM ABSOLU 2 séances/jour, JAMAIS 3 » dans le prompt qui autorise la triple séance ;
- « une seule séance par jour » dans l'auto-vérification, alors que des jours doubles sont requis ;
- « jamais de pourcentage » suivi d'exemples « @85% VMA » ;
- zones annoncées « de progression » alors que calculées sur la VMA actuelle ;
- une dizaine de « RÈGLE ABSOLUE », qui se diluent mutuellement.

**Appels aux modèles** :
- aucune instruction système ;
- aucun schéma de sortie ;
- même liste de modèles pour toutes les tâches, avec le modèle le plus léger en premier ;
- timeout de 25 s pour générer 14 séances.

**Relecture IA mal placée** : elle tournait après les garde-fous, et ses corrections n'étaient
jamais revalidées.

**Chat** :
- aucun historique de conversation ;
- aucune date ;
- les modifications n'indiquaient jamais la semaine visée → tout tombait sur la semaine N.

**Co-génération** :
- comparaison par position dans le tableau (un jour double décale tout → faux désaccords) ;
- les séances « en trop » de Groq étaient ajoutées au compromis ;
- la moyenne des durées créait des durées que la feuille de séance ne décrit pas.

**Périodisation** : recalculée depuis « aujourd'hui » à chaque régénération → la phase de base
se ré-étalait sur les semaines restantes au lieu d'avancer.

**Date** : le serveur Vercel tourne en UTC. Un lundi 00:30 à Paris était encore dimanche → la
semaine N était décalée.

## 3. Nouvelle architecture IA

| Fichier | Rôle |
|---|---|
| `lib/aiConfig.js` (nouveau) | Modèles par tâche (plan, relecture, chat, léger), réflexion, timeouts, budget global |
| `lib/aiClient.js` (nouveau) | Client unifié Gemini/Groq : instruction système, sortie par schéma JSON, replis, classification d'erreurs |
| `lib/planSchema.js` (nouveau) | Schémas de sortie (plan, semaine, relecture, chat, analyses) |
| `lib/planValidation.js` (nouveau) | Validateurs déterministes, sans mutation, avec score |
| `lib/coachPrompts.js` (nouveau) | Prompts cohérents ; l'arithmétique est faite par le code |
| `lib/gemini.js` (réécrit, 147 → 40 Ko) | Orchestration du pipeline |
| `lib/coGeneration.js` | Comparaison par jour et discipline, compromis cohérent |
| `lib/groq.js` | Adaptateur rétro-compatible |

Pipeline d'une génération :

1. **Prompt** : instruction système stable, puis données de l'athlète.
2. **Génération** avec sortie structurée imposée.
3. **Normalisation** et enrichissement des champs.
4. **Validation déterministe** : liste précise des problèmes.
5. **Relecture + réparation IA** : l'IA reçoit le plan et les problèmes détectés. Ses
   corrections ne sont acceptées que si le score de validation ne se dégrade pas. Elles sont
   évaluées sur leurs valeurs brutes, avant l'enrichissement automatique, qui pourrait masquer
   une mauvaise correction.
6. **Garde-fous déterministes**, en dernier recours.
7. **Validation finale** : seuls les problèmes réellement non résolus deviennent des
   avertissements.

Les garde-fous restent tous en place (nombre de séances, jours doubles, triple journée, écart
max d'une séance entre jours, rampe débutant, affûtage, fatigue/VFC, tests terrain…), mais ils
sont désormais **cohérents** :

- une séance allégée est réécrite entièrement (titre, intensité, zones, description) ;
- une durée réduite est expliquée ;
- le motif est placé dans un champ `autoNote`, affiché discrètement dans le détail de la séance,
  jamais dans la description.

## 4. Décisions de coaching à valider

1. **Compromis de co-génération.** En cas de désaccord persistant, le mode par défaut
   (`best`) garde le plan **entier** de l'IA la mieux validée ; égalité → Gemini.
   `CO_GEN_COMPROMISE=average` restaure la règle de moyenne d'origine, déconseillée car elle
   produit des séances incohérentes. Le 2e round est sauté si le budget temps restant est
   inférieur à 140 s.
2. **Zones course** (`lib/zones.js` PACE_PCTS et `lib/coachPrompts.js`, mêmes valeurs) :
   endurance fondamentale à 62-75 % VMA au lieu de 70-80 %. Nouvelles bornes basses :
   Z1 0 · Z2 62 · Z3 75 · Z4 85 · Z5 92 % VMA. Réversible en une constante. Les zones
   calibrées manuellement restent prioritaires. L'allure de repli EF passe de 75 % à 65 % VMA.
3. **Séances dures consécutives.** Pour un confirmé ou un expert, seules sont corrigées :
   - la même discipline deux jours de suite, hors natation ;
   - la course dure deux jours de suite.

   Débutant → intermédiaire : règle stricte inchangée.
4. **Planchers de volume selon le format.**
   - Natation : minimum par format et par niveau ; jamais appliqué aux séances de
     récupération, de technique ou de test.
   - Sorties longues : plancher complet en L/XL, réduit en M, aucun en XS/S.
5. **Détection des séances dures** : zone déclarée + titre/résumé. Avant, un simple mot dans
   la description suffisait (« sans aller au seuil »). Côtes, VO2max et tests terrain sont
   désormais inclus.
6. **« (densifiée) »** : la séance est réellement densifiée (bloc tempo inséré). Avant, seul le
   titre changeait.

## 5. Autres bugs corrigés

- **Calendrier** : le filtre démarrait sur « RUN » → un triathlète ne voyait que ses séances de
  course après génération. Trouvé en test navigateur.
- **Chat, comparaisons répétées** : chaque réponse réaffichait la comparaison AVANT/APRÈS de
  toutes les séances modifiées depuis le début (`previous` restait stocké).
- **Chat, garde-fous structurels** : appliqués uniquement à la semaine réellement modifiée.
  Avant, les deux semaines étaient re-réparties à chaque ajustement.
- **Chat, nouvelles actions** : suppression de séance (`remove`) ; un ajout remplace l'entrée
  REPOS du jour.
- **Natation, formats multilingues** : en-têtes EN/ES acceptés (« Warm-up », « Main set »,
  « Calentamiento »…). Avant, ces séances étaient remplacées par un modèle générique.
- **Natation, allure** : reconnue même précédée d'une zone (« Z4/CSS 1:32 /100m »).
- **Vélo** : borne haute alignée sur la Z6 envoyée à l'IA (150 % FTP au lieu de 130 %).
- **Tests terrain** : l'IA reçoit la consigne de les programmer ; l'injection automatique ne
  complète que ceux qu'elle a oubliés. Avant, un « Test VMA » de l'IA pouvait être doublé.
- **Résumé du coach** : le résumé de l'IA (`weekSummary`) s'affiche dans le chat après
  génération.
- **Diagnostic IA** (Réglages → IA) : teste tous les modèles configurés et renvoie la
  configuration résolue par tâche.
- **Webhook Strava** : l'analyse IA dispose d'un budget de 50 s (la fonction est limitée à 60 s).
- **Test météo** : il simulait encore l'ancien format de réponse du géocodage inverse (le code
  était correct).

## 6. Configuration Vercel

Variables (toutes optionnelles sauf les clés) :

| Variable | Effet |
|---|---|
| `GEMINI_API_KEY`, `GROQ_API_KEY` | Clés (inchangé) |
| `GG_MODELS_PLAN` / `_REVIEW` / `_CHAT` / `_LIGHT` | Liste de modèles Gemini par tâche, ex. `gemini-3.8-flash,gemini-3.5-flash` |
| `GROQ_MODELS_PLAN` / … | Idem pour Groq |
| `AI_THINKING_PLAN` / … | `MINIMAL`, `LOW`, `MEDIUM`, `HIGH` |
| `CO_GEN_COMPROMISE` | `best` (défaut) ou `average` |
| `GG_PREFERRED_MODELS`, `GROQ_PREFERRED_MODELS` | **Anciennes : à supprimer.** Encore respectées, elles forcent la même liste pour toutes les tâches |

Listes par défaut :
- Gemini : 3.8-flash → 3.7 → 3.6 → 3.5-flash → 3.1-flash-lite pour le plan ; modèles plus
  légers pour les tâches courtes.
- Groq : gpt-oss-120b / 20b.

Le quota gratuit Gemini étant compté par modèle, la chaîne de repli élargit aussi le quota
disponible.

**Durée d'exécution** : le plan Hobby limite une fonction à 300 s (valeur par défaut et
maximum). Une requête dispose d'un budget interne de 280 s ; aucun appel n'est lancé s'il ne
peut pas finir avant.

## 7. Ce qui a été testé, et ce qui ne l'a pas été

**Testé :**
- 63 tests unitaires ;
- build de production (lint + types) ;
- parcours complet dans Chromium avec API simulées : assistant → génération → calendrier (toutes
  disciplines) → détail de séance (note automatique visible) → chat (historique et date locale
  transmis, comparaison affichée une seule fois) → les 5 onglets. Aucune erreur console.

**Non testé, faute de clés API dans l'environnement de test :**
- les appels réels à Gemini et Groq ;
- l'acceptation réelle des schémas par chaque modèle (les replis sans schéma sont en place).

À faire après déploiement : Réglages → IA pour vérifier quels modèles répondent, puis
surveiller les logs Vercel (`[ai:gemini]`, `[ai:groq]`, codes `QUOTA`, `TOO_LARGE`,
`MODEL_NOT_FOUND`).

## 8. Points ouverts, non traités ici

- **Sécurité** : les routes IA sont accessibles sans authentification. La limite de débit est
  gardée en mémoire : elle n'est pas partagée entre instances Vercel et se réinitialise à chaque
  démarrage. Piste : exiger la session Supabase quand elle est configurée, et une limite
  persistante (Upstash, Vercel KV).
- **Route morte** : `/api/regenerate-week` n'est appelée nulle part dans l'interface depuis le
  remplacement du bouton par « Actualiser séance » (mise à jour quand même).
- **Barres d'intervalles** : elles comptent 6 répétitions pour « 5*(…) » quand le retour au
  calme suit sur la ligne suivante du corps de séance (défaut d'affichage mineur).
- **Changement de semaine** : il n'y a pas de bascule automatique N → N+1 au changement de
  semaine. `trainingPlan.weekAnchor` (lundi de la semaine N) est désormais enregistré pour
  pouvoir l'implémenter.

## 9. Banc d'essai « plafond de qualité » (Claude Opus 5.5)

Le prompt exact de l'app a été généré pour le profil réel de l'athlète (données de
`01_Profil_Athlete.md` uniquement ; CSS et FC de repos absentes, donc non inventées ; date
d'objectif fin juin 2027 posée comme hypothèse). Claude Opus 5.5 y a répondu comme le ferait
le modèle de l'app. La réponse est versionnée dans `test/fixtures/opusMarinPlan.json` et
vérifiée par `test/opusBenchmark.test.js`.

**Résultat de la validation brute** : 0 violation. Les huit « Total » natation sont exacts au
mètre. Le plan compte 12 séances par semaine (16h10 puis 16h40), un test CSS en semaine N, et
des séances natation de N+1 calées sur « l'allure de ton 400 m test » — une manière d'exploiter
le test sans inventer de chiffre.

**Deux défauts révélés, corrigés :**
- **RPE converti en allure de footing.** Quand la VMA était connue, tout RPE était converti en
  allure d'endurance : « côtes effort VMA » devenait « 4:50 /km », et la PPG gainage recevait
  une allure de course. Désormais, le RPE est conservé hors footing continu.
- **Plafond de sortie longue en format court.** « Vélo ~2h max » était incompatible avec 18 h
  en 12 séances. Le repère dépend maintenant du volume déclaré.

Après ces corrections, le plan traverse tout le pipeline sans aucune retouche.

**Limites de contexte, qu'aucun modèle ne peut compenser :**
- l'alternance charge/décharge n'existe pas dans l'app : la semaine N+1 est demandée à 18 h
  même quand le cycle prévoit une décharge ;
- les chantiers prioritaires de l'athlète (transitions, drafting, zone grise, VMA courte)
  n'ont pas de champ dédié ;
- les zones calculées depuis la VMA placent la Z2 entre 4:11 et 5:04 /km, alors que la Z2
  confirmée sur le terrain est 4'45-5'10 : il faut calibrer les zones d'allure dans le Profil ;
- les zones FC manuelles n'étaient pas transmises à l'IA. **Corrigé** : elles sont maintenant
  prioritaires sur le calcul Karvonen.

## 10. Deuxième vague : génération, outils, mobile

### Génération de plan

**Cycle charge / décharge** (`lib/trainingCycle.js`)
- Rythme 1:1, 2:1 ou 3:1, et position de la semaine en cours, à saisir dans l'assistant ou
  dans Objectif → Réglages du plan.
- Le cycle est stocké sous forme d'ancre datée (lundi de la 1re semaine de charge).
- Chaque semaine reçoit son propre volume cible : décharge à 70 %, même nombre de séances,
  très peu d'intensité.
- Le validateur juge le volume de chaque semaine sur sa propre cible.
- Le chat connaît la nature de chaque semaine.

**Priorités et consignes pour le coach**
- 9 chantiers au choix (4 au maximum) : transitions, peloton, zone grise, VMA courte…
- Un texte libre de 600 caractères pour les contraintes réelles : créneaux club, matériel,
  lieux.
- Les deux arrivent dans les prompts de génération, de régénération et de chat.

**Bascule automatique de semaine**
- `trainingPlan.weekAnchor` est vérifié à l'ouverture de l'app, puis chaque minute.
- Une semaine plus tard : N+1 devient N, et N+1 est à générer.
- Deux semaines ou plus : les deux semaines sont à générer.
- Un bouton « ✨ Générer cette semaine » réutilise `/api/regenerate-week`, jusque-là non
  appelée par l'interface.
- Les numéros de semaine suivent désormais le changement de jour, y compris quand la PWA
  reste ouverte.

**Assistant** : le décompte « jours de repos / jours doubles » oubliait le jour de repos
obligatoire. Pour 12 séances, il affichait « 0 repos, 5 doubles » au lieu de 1 et 6.

### Vérification des outils

**Barres d'intervalles** (`lib/intervalParser.js`) : le découpage se faisait sur tout « - »,
y compris dans les plages de valeurs.
- Exemple : « 5*(8' @300W 60-65rpm - 4' souple) » affichait une barre d'effort fantôme
  « 65rpm » à chaque répétition.
- « descente trot » n'était pas reconnu comme une récupération.
- 4 tests ajoutés.

**Tests** : 81 tests unitaires, plus deux parcours complets en navigateur mobile (20
vérifications sur les nouveautés, plus le parcours d'origine).

### Nouvel outil : Transitions (Outils → ⏱️ Transitions)

- **Chrono T1/T2** : gros bouton utilisable en tenue, historique, record, moyenne des 5
  derniers essais.
- **Routines T1 et T2 dans l'ordre** : casque attaché avant de décrocher le vélo, dossard
  dans le dos en T1, détaché seulement après avoir raccroché le vélo, dossard devant en T2.
  Ce sont les règles FFTri reprises par la plupart des règlements d'épreuves ; l'outil
  rappelle de vérifier celui de la course.
- **Checklist de course** personnalisable.
- Données synchronisées avec le compte.

### Téléphone

L'audit a été mesuré en viewport 390×844 tactile, sur tous les onglets et sous-onglets.

| | Avant | Après |
|---|---|---|
| Débordement horizontal | aucun | aucun |
| Champs < 16 px (zoom iOS) | aucun | aucun |
| Cibles tactiles < 32 px | 41 | 7 (6 liens d'attribution des cartes, obligatoires ; 1 interrupteur au format standard) |
| Textes < 10 px, calendrier | 40 | 6 |

**Calendrier**
- Date sur chaque jour, jour courant mis en évidence.
- Défilement automatique jusqu'à aujourd'hui (seuls 2 jours sont visibles sur un téléphone).
- Bilan de semaine : total, natation en km, vélo, course, et séances validées.
- Badge charge/décharge.

**Autres écrans**
- Barre d'outils défilante avec icônes (6 outils ne tenaient plus en 5 colonnes à 10 px).
- Textes de 8-9 px relevés d'un cran dans toute l'app.
- Fenêtres du bas en `dvh` au lieu de `vh` : sur iOS, `vh` inclut la barre d'adresse
  rétractable, ce qui pouvait couper le bas des fenêtres.
- Boutons de zoom des cartes et bouton lecture du radar pluie : de 28-30 px à 40 px.
- Non testé ici : météo et radar réels (API externes bloquées par le réseau du bac à sable).

**Dépôt** : ajout d'un `.gitignore`. Il n'y en avait pas, et `node_modules/`, `.next/` ou
`.env.local` pouvaient partir sur GitHub.

## 11. Troisième vague : charge réelle, écran Aujourd'hui, sécurité, duathlon

### Protection des routes IA (`lib/aiGuard.js`, `lib/aiFetch.js`)

Les 7 routes qui consomment l'IA passent désormais par un garde commun. Chaque route garde
son format de réponse (le chat répond toujours par un message du coach). Le garde ajoute trois
protections :

1. **Session Supabase vérifiée côté serveur** : en-tête `Authorization: Bearer`, ajouté
   automatiquement par le client. Elle est exigée par défaut dès que Supabase est configuré.
2. **Limite par minute par compte** : un compte qui change d'IP (4G, Wi-Fi) est compté une
   seule fois. Sans compte, la limite reste par IP.
3. **Quota quotidien persistant** : 80 appels IA par jour et par compte par défaut, dans la
   table `ai_usage`. Contrairement à l'ancien compteur en mémoire, il survit aux redémarrages
   et est partagé entre instances Vercel.

**À faire de ton côté** : exécuter `supabase-migration-ai-usage-2026-09.sql` dans Supabase
(SQL Editor). Tant que la table n'existe pas, seul le quota quotidien est inactif ; les deux
premiers niveaux restent en place.

| Variable | Effet |
|---|---|
| `AI_REQUIRE_AUTH` | `false` pour garder le mode « continuer sans compte » avec l'IA (défaut : session exigée si Supabase est configuré) |
| `AI_DAILY_LIMIT` | Appels IA par jour et par compte (défaut : 80) |
| `SUPABASE_SERVICE_ROLE_KEY` | Déjà utilisée par d'autres routes ; nécessaire au quota quotidien |

### Charge Strava réelle transmise à l'IA (`lib/recentTraining.js`)

Le coach IA ne recevait jusqu'ici que les ressentis déclarés. Il reçoit maintenant un résumé
calculé à partir des activités Strava synchronisées :

- les 3 dernières semaines et la semaine en cours : heures et km par discipline, nombre
  d'activités, activités intenses ;
- la moyenne des semaines complètes ;
- la charge CTL / ATL / TSB, avec le même calcul que le graphique de charge de l'app ;
- le nombre d'activités dont la charge est estimée faute de FC ou de puissance.

Le résumé est calculé sur le téléphone. Le serveur le nettoie avant de l'utiliser : il ne
garde que des nombres et des dates, jamais de nom d'activité ni de texte libre.

**Trois effets concrets :**
- **Pic de charge évité** : si le volume réel des semaines complètes est inférieur à 75 % du
  volume déclaré (sur au moins 2 semaines), la cible de la semaine est plafonnée à +15 % du
  réel. Le validateur utilise la même cible, donc pas de contradiction.
- **Fatigue marquée (TSB ≤ -20)** : allègement automatique d'une séance dure, avec un motif
  explicite.
- **Séances manquées** : listées dans le prompt, avec la consigne de ne pas les réempiler.

### Séances manquées

- Une séance passée est **faite** si elle a été validée (ressenti) ou si une activité Strava
  lui est associée, ou si une activité de la même discipline a eu lieu le même jour.
- Elle est **manquée** si l'athlète l'a déclarée non faite, ou si Strava est actif (activité
  dans les 7 derniers jours) sans aucune activité correspondante.
- Sinon, elle est **à confirmer**. Sans Strava, une séance n'est jamais déclarée manquée
  d'office.
- « Réorganiser avec le coach » envoie au chat une demande précise. Le chat reçoit aussi la
  liste des séances manquées.

### Écran « Aujourd'hui » (onglet ouvert par défaut)

- Séances du jour en grand, ou repos.
- Aperçu de demain.
- Séances passées : à confirmer (✓ Faite / ✗ Pas faite), manquées (réorganiser / ignorer).
- Semaine : séances faites sur prévues, volume prévu contre réalisé sur Strava.
- Forme : CTL / ATL / TSB, ou une invitation à connecter Strava.
- Raccourcis vers le coach, la semaine et l'outil Transitions.
- Navigation du bas à 6 onglets, sans cible tactile trop petite ni débordement.

### Duathlon

Le code confondait « a du vélo » et « a de la natation » sous « n'est pas de la course à
pied ». Les 43 tests concernés ont été relus un par un ; `lib/sport.js` nomme désormais le
sens de chaque test.

**Pris en charge :**
- **Assistant** : bouton Duathlon, formats XS / S / M avec distances modifiables (S = 5 / 20 /
  2,5 km, format par défaut), temps visé global, FTP demandée, CSS non demandée.
- **Génération** : consignes course → vélo → course, zones vélo sans natation, test FTP si
  absente.
- **Validation** : une séance de natation dans un plan de duathlon est une erreur. Les séances
  ajoutées par les garde-fous ne sont que course ou vélo.
- **Écrans** : filtres du calendrier TOUT / BIKE / RUN, profil et records sans natation,
  nutrition (distance = course + vélo + 2e course).

**Pas encore disponibles pour le duathlon** : la prédiction de chrono et le plan
d'exécution de course. Ils affichent « non disponible » plutôt qu'un calcul de course à pied
qui serait faux.

### Vérifications de cette vague

- 99 tests unitaires : +18, dont le garde des routes avec un Supabase simulé (sans jeton,
  jeton falsifié, limite par compte, quota, table absente).
- Build de production.
- Parcours mobile complet : 19/19 vérifications, plus 20/20 sur la vague précédente, plus le
  parcours d'origine, sans erreur console.

Le parcours navigateur a détecté deux défauts que les tests unitaires ne voyaient pas, tous
deux corrigés :
- un import mal placé qui cassait la compilation de `ZoneCharts.js` ;
- des distances de duathlon envoyées avec une clé parasite et au format M au lieu de S.

**Non testé ici** : l'authentification Supabase réelle et le quota avec une vraie base (pas
de projet Supabase dans l'environnement de test), et la charge Strava avec de vraies données
(les calculs sont couverts par les tests unitaires).

## 12. Quatrième vague : cohérence et longévité sur toute la saison

Méthode : simulation de 4 200 combinaisons de réponses au questionnaire, en faisant tourner le
vrai code sur chacune, plus une saison entière simulée semaine par semaine.

| Incohérence (4 200 questionnaires) | Avant | Après |
|---|---|---|
| Objectif passé → affûtage indéfini | 840 | 0 |
| Consigne d'affûtage absente quand un cycle est déclaré | 840 | 0 |
| Décharge + affûtage cumulés | 840 | 0 |
| Configuration impossible acceptée | 560 | 0 (bloquée, raison affichée) |
| Tests ≥ 50 % des séances d'une semaine | 390 | 0 |
| Débutant à 10+ séances sans avertissement | 240 | 0 |
| Volume trop faible / délai trop court non signalés (trail, objectifs longs) | 76 | 0 |
| Plancher natation > 40 % du volume | 200 | 60 * |
| Duathlon sans contrôle de cohérence | 180 | 48 ** |

\* Contrôle volontairement prudent : il suppose 2 natations au plancher dans une semaine de
3 séances.
\*\* Faux positifs du contrôle : 3 séances et 3 h sont une préparation cohérente pour un
duathlon XS ou S.

### Contexte de chaque semaine (`lib/seasonPlan.js`)

Une fonction unique donne, pour n'importe quel lundi de la saison : la phase, la nature de la
semaine, son volume, son nombre de séances et les courses. Le prompt, le validateur, les
garde-fous et l'affichage l'utilisent tous.

| Nature de la semaine | Volume (repères d'entraînement courants, regroupés pour être ajustés) |
|---|---|
| Base | montée de 85 % à 100 % (aucune montée si l'athlète a déjà une base) |
| Charge (cycle 3:1) | paliers 90 / 95 / 100 %, puis décharge à 70 % |
| Affûtage (cycle suspendu) | 85 %, puis 75 %, puis 60 % |
| Semaine de course | 45 %, jour J nommé, veille et lendemain décrits, nombre de séances libre |
| Après la course | récupération 40 %, puis 60 %, puis transition 70 % |

Après la course, l'app n'est plus bloquée en affûtage, et une carte invite à fixer
l'objectif suivant.

### Courses dans le plan

- L'objectif principal et les courses du calendrier (priorités A/B/C) tombant dans les deux
  semaines sont inscrits comme entrées « 🏁 » à leur date. Le validateur signale une course
  absente, et un garde-fou l'inscrit si l'IA l'a oubliée.
- Une course peut tomber un jour de repos obligatoire, cas fréquent le dimanche. Elle n'est
  alors ni déplacée ni supprimée par les garde-fous de structure.
- Une course n'est jamais « allégée » : si la veille est dure, c'est la veille qui est allégée.
- Après la course objectif, dans la même semaine, toute séance dure est une erreur.

### Progression dans la durée

- **Historique.** À chaque bascule de semaine, la semaine écoulée est archivée (6 semaines
  conservées) : séances clés et statut réel, faite ou manquée. Les 4 dernières sont transmises
  au coach, avec la consigne de progresser à partir des séances réellement faites.
- **Date de début conservée.** Refaire le plan pour le même objectif garde la date de début,
  donc la périodisation continue.
- **Phases en direct.** Les statuts de l'onglet Objectif sont recalculés à partir des dates.

### Tests terrain (`computeTestPlan`)

- **Plafond par semaine** : au plus 1 test (5 séances ou moins, ou débutant), 2 tests (6 à 9
  séances) ou 3 tests (10 séances ou plus). Les autres suivent les semaines d'après.
- **Re-test** d'une métrique connue depuis plus de 8 semaines, en phase de base ou de
  développement, sur la 1re semaine de charge après une décharge.
- **Jamais de test** en semaine de décharge, d'affûtage, de course ou de récupération.
- **Régénération de semaine** : elle propose désormais les tests et les mémorise. Avant, la
  route renvoyait l'information mais l'interface l'ignorait.
- **Date de mesure** : une valeur de VMA, FTP ou CSS modifiée à la main dans le Profil est
  datée.

### Questionnaire enrichi

- **Jours de repos** : de 0 à 3 jours obligatoires, avec un décompte exact.
- **Temps disponible par jour** : du lundi au vendredi, et le week-end. Il est donné à l'IA,
  contrôlé par le validateur, respecté par un garde-fou qui raccourcit avec une note, et
  bloquant si le volume ne tient pas dans la semaine.
- **Blocage explicite** des configurations impossibles, avec la raison affichée.
- **Nouveaux avertissements** : débutant avec beaucoup de séances, duathlon (séances, volume,
  délai), trail (volume, délai).
- **Plancher natation** proportionnel au volume : plein à partir de 8 h/semaine, 60 % au
  minimum.
- **Modifiable à tout moment** : cycle, jours de repos, disponibilités, priorités et consignes,
  dans Objectif → Réglages du plan.

### Vérifications de la vague 4

- 127 tests unitaires.
- Build de production.
- Parcours mobile : 13/13 sur cette vague, plus toutes les vagues précédentes (20/20, 19/19
  et le parcours d'origine), sans erreur console.

## 13. Cinquième vague : secours Mistral et bibliothèque de semaines modèles

### Mistral, fournisseur de secours gratuit

- **Quand il intervient.** Si Gemini ou Groq échoue (quota épuisé, panne, modèle retiré),
  Mistral prend sa place et le double contrôle reste un vrai double contrôle. Si les deux
  échouent, Mistral génère seul, et une note le signale.
- **Sans clé Mistral.** Le comportement d'origine est inchangé : l'IA restante continue
  seule, avec une note.
- **Où il s'applique.** Au plan, à la semaine, au chat, à la nutrition, aux zones, au
  parcours et à l'analyse Strava : tout passe par `runBothProviders`.
- **Appel technique.** Même client compatible OpenAI que Groq (`lib/aiClient.js`), avec un
  schéma JSON strict, puis un repli en mode JSON simple accompagné d'une consigne JSON
  explicite, comme l'exige ce mode. Les modèles sont désignés par leurs alias `-latest`
  (medium, puis large, puis small), qui suivent les nouvelles versions sans changer le code.
- **Transparence.** Les notes affichent le nom du modèle réellement utilisé, par exemple
  « Double-check Gemini + Mistral ».
- **Diagnostic** (Réglages → IA) : teste aussi les modèles Mistral quand la clé est définie.

| Variable Vercel | Effet |
|---|---|
| `MISTRAL_API_KEY` | Active le secours. Offre gratuite « Experiment » sur console.mistral.ai ; contrepartie : accepter que les données servent à l'entraînement, et vérifier son numéro de téléphone. |
| `MISTRAL_MODELS_PLAN` / `_REVIEW` / `_CHAT` / `_LIGHT` | Listes de modèles (facultatif) |

### Bibliothèque de 18 semaines modèles (`lib/referenceWeeks.js`)

- **Contenu.** 6 familles (course sur route, trail, triathlon XS/S, triathlon M, triathlon
  L/XL, duathlon) × 3 niveaux, rédigées par Claude Opus 5.5 en phase de développement.
- **Fonctionnement.** À chaque génération, le modèle reçoit UNE semaine : la plus proche du
  profil (discipline, format et niveau), avec la consigne de s'inspirer de sa rigueur sans la
  recopier. Le nombre de séances, le volume, les jours de repos, la phase, les disponibilités
  et les priorités de l'athlète priment.
- **Intensités en repères de zone uniquement** (« @Z4 seuil », « CSS ») : le modèle doit les
  convertir avec les zones réelles de l'athlète. Un test garantit qu'aucune allure ni
  puissance chiffrée n'y figure.
- **Validées par le validateur de l'app** : les 18 semaines passent sans aucune remarque
  (nombre de séances, jour de repos, disciplines par jour, « Total » natation au mètre près,
  volume ±15 %, espacement des séances dures selon le niveau).
- **Coût.** Pour un triathlète S expert, le prompt de génération fait environ 9 300
  caractères (~2 700 tokens), exemple compris.
- **Désactivation** : `AI_REFERENCE_WEEKS=false`.

### Vérifications de la vague 5

- 155 tests unitaires.
- Build de production.
- Parcours navigateur : le diagnostic affiche Mistral, et toutes les vagues précédentes
  repassent (20/20, 19/19, 13/13 et le parcours d'origine), sans erreur.

**Non testé ici** : un appel réel à Mistral, faute de clé dans l'environnement de test.
Après avoir ajouté la clé, lance Réglages → IA pour vérifier quels modèles répondent.

## 14. Sixième vague : aide et tutoriel pour les nouveaux athlètes

Objectif : rendre l'app compréhensible pour un athlète qui découvre l'app sans explication.
Tout le texte d'aide est centralisé dans `lib/helpContent.js`, pour être relu et corrigé sans
toucher aux composants.

- **Visite guidée** (`components/help/GuidedTour.js`) : 10 écrans, un par grande
  fonctionnalité. Chacun montre un aperçu dessiné avec le vrai style de l'app (carte de
  séance, jours du calendrier, bulles de chat…) pour que l'athlète reconnaisse ensuite ce
  qu'il voit. Navigation au doigt (glisser) ou par boutons, points de progression, « Passer »
  toujours visible. Elle se lance **une seule fois**, dès qu'un plan existe (nouvel athlète,
  ou athlète déjà inscrit au premier lancement de cette version).
- **Bouton ❓ dans l'en-tête**, toujours visible (`components/help/HelpCenter.js`). Trois
  onglets :
  - Démarrer : revoir la visite, les 4 gestes essentiels, réafficher les astuces ;
  - Lexique : 25 termes, recherche sans accents ;
  - Questions : 10 questions fréquentes, dont « j'ai raté une séance », « je ne connais pas
    ma VMA » et « qui voit mes données ».
- **Astuce à la première visite de chaque onglet** (6 onglets), fermée par « Compris » et
  mémorisée.
- **Bulles « ? » à côté du jargon** : VMA, FTP, CSS et FC dans l'assistant ; cycle de charge ;
  forme / fatigue / fraîcheur ; lecture d'une feuille de séance ; note ⓘ ; semaines N et N+1 ;
  badge charge/décharge ; rangée « Comprendre » sous les métriques du profil.
- **Justesse du contenu** : les définitions reprennent les règles réelles de l'app (moyennes
  sur 42 et 7 jours, décharge à ~70 %, tests proposés). Les exemples chiffrés sont vérifiés par
  test (CSS : (6'20 − 2'55) ÷ 2 = 1'42 /100 m ; VMA : 1 700 m en 6 min → 17 km/h). La réponse
  sur les données personnelles cite les services d'IA réellement utilisés.
- **Défaut corrigé pendant les tests** : une fenêtre d'aide ouverte depuis un titre en
  majuscules et en police à chasse fixe héritait de ce style. Elle s'affiche désormais à la
  racine de la page (portail React) avec un style remis à zéro.
- **Accessibilité** : fenêtres annoncées comme dialogues, fermeture par Échap, bouton de
  fermeture focalisé, zones tactiles d'au moins 40 px. L'engrenage des réglages passe aussi de
  32 à 40 px.

**Limite** : l'aide est en français. L'interface existe aussi en anglais et en espagnol, mais
l'aide n'est pas encore traduite ; il suffit d'ajouter les traductions dans
`lib/helpContent.js`.

**Vérifications** : 160 tests unitaires, dont la vérification que chaque bulle « ? » pointe
vers un terme du lexique et que chaque onglet a son astuce. Parcours navigateur de l'aide :
19/19. Toutes les vagues précédentes repassent sans erreur. Audit mobile inchangé.

## 15. Septième vague : retours d'usage

**Transitions**
- **Chrono retiré.**
- **Checklist par catégories** : papiers, tenue, natation, vélo, course, nutrition et divers.
  Elle est adaptée au sport : pas de natation en duathlon, pas de vélo en course à pied.
- **Ajouts vérifiés** :
  - licence FFTri ou Pass Compétition et pièce d'identité, demandées au retrait du dossard ;
  - trifonction (tenue du club obligatoire en championnat des clubs) ;
  - chaussettes, coupe-vent ou manchettes, casquette ;
  - tenue sèche pour l'après-course, et autres éléments pratiques.
- **Nouvel encadré repliable « Rappels du règlement »** :
  - même tenue du départ à l'arrivée hors distances L et plus, torse couvert ;
  - combinaison néoprène obligatoire sous 16 °C, autorisée jusqu'à 24,5 °C, interdite au-delà ;
    tenue 100 % textile si elle est interdite ;
  - mains et pieds non couverts en natation ;
  - dossard dans le dos à vélo, devant en course ;
  - casque attaché avant de toucher le vélo ;
  - appareils audio interdits.
- **Ajouts personnels et cases cochées** de l'ancienne liste migrés automatiquement.
- Les données sont dans `lib/raceChecklist.js`.

**Outils** : emojis décoratifs retirés (barre des outils, titres, alertes, marqueurs de
nutrition, bouton de localisation). Le champ de recherche du parcours est passé de 12 à 16 px
(il provoquait le zoom automatique d'iOS).

**Météo : pluie sur 24 h**
- L'imagerie radar gratuite (RainViewer) ne couvre qu'environ la dernière heure. La grille
  Open-Meteo déjà chargée pour le vent contient en revanche la pluie prévue heure par heure en
  25 points, sans être affichée sur la carte.
- La carte montre maintenant une nappe de pluie prévue, lissée entre ces points et colorée
  selon la légende, avec le même curseur de 24 h que le vent.
- Le radar observé reste disponible en second choix.
- Correction d'une affirmation erronée faite en cours de travail : le curseur du vent partait
  déjà de l'heure actuelle (données découpées par `sliceNext24h`). La fenêtre ajoutée n'est
  qu'un garde-fou.

**Réglages du plan**
- **Diagnostic.** L'enregistrement fonctionnait, mais rien ne changeait à l'écran, puisque les
  réglages ne s'appliquent qu'aux semaines générées ensuite.
- **Désormais** :
  - le bouton reste inactif sans modification ;
  - l'enregistrement est confirmé, avec la liste de ce qui a changé ;
  - un bouton « Appliquer à la semaine prochaine » régénère tout de suite la semaine suivante.
- **Nouvelle carte « Mon questionnaire »** : synthèse de l'objectif, de l'épreuve, du temps
  visé, du niveau, du volume, du repos, des disponibilités et des mesures, avec un bouton
  « Refaire ».
- **Bug corrigé.** « Déjà entraîné », l'équipement de test FTP, le poids et le sexe n'étaient
  pas conservés dans les contraintes relues par la régénération et le chat. Un athlète
  entraîné retombait donc en reprise progressive (85 % du volume) à chaque semaine régénérée.
  Les nouveaux champs sont enregistrés, et une case « Je m'entraîne déjà de façon structurée »
  dans les réglages corrige les plans existants sans refaire le questionnaire.

**Journal de la douleur** : repliable par une flèche, replié par défaut sans gêne active,
avec un résumé d'une ligne.

**Calendrier** : le bilan « x validées » et les coches utilisent la même définition qu'Aujourd'hui
(ressenti validé, « ✓ Faite » déclaré, ou activité Strava associée).

**Densité** : texte de base à 15 px au lieu de 16 (tout ce qui est en rem baisse d'environ
6 %, les champs restent à 16 px sur mobile), marges du contenu resserrées, écran Aujourd'hui
et astuces plus compacts.

**Vérifications** : 163 tests unitaires. Parcours navigateur de cette vague : 19/19, avec une
réponse Open-Meteo simulée pour la pluie. Toutes les vagues précédentes repassent.

## 16. Diagnostic IA : Mistral invisible, « plein de modèles non disponibles »

**Mistral invisible.** Sans `MISTRAL_API_KEY` côté serveur, le diagnostic ne testait pas
Mistral et masquait le groupe vide. Il affiche maintenant toujours Mistral, avec « Clé absente »
et l'action à mener : ajouter la clé dans Vercel puis **redéployer**, car une variable ajoutée
ne s'applique qu'au déploiement suivant.

**Modèles « non disponibles ».** C'est attendu avec des clés gratuites. Les identifiants
configurés existent bien dans la documentation officielle de Gemini (3.8, 3.7, 3.6 et 3.5 Flash,
3.5 et 3.1 Flash-Lite), mais l'offre gratuite ne couvre pas tous les modèles (erreur 429
« limit: 0 »), et certains peuvent être réservés à certains comptes (404). Ce n'est pas
bloquant tant qu'un modèle répond par tâche. Trois changements :

- **Causes lisibles** (`lib/aiAvailability.js`) : clé absente, clé refusée, modèle non
  accessible avec ta clé, pas de quota gratuit, quota épuisé pour le moment, délai dépassé.
  Chacune vient avec l'action à mener ; l'erreur brute reste consultable en « Détail technique ».
- **Mise à l'écart en production** : un modèle introuvable ou sans quota gratuit n'est plus
  essayé pendant 6 h, un quota momentanément épuisé pendant 2 min. Mémoire par instance serveur.
- **Tableau « Ce que l'app utilisera »** : pour chaque tâche (plan, relecture, chat, tâches
  légères), le modèle qui répond chez chaque fournisseur, avec un verdict (tout fonctionne /
  sans double vérification / tâche sans modèle). S'y ajoute une **configuration recommandée**
  copiable (`GG_MODELS_PLAN=…`), pour ne plus essayer du tout les modèles indisponibles.

**Tests** : 169 tests unitaires, dont la route du diagnostic sur un scénario « Gemini sans
quota gratuit + modèle introuvable + pas de clé Mistral ». L'affichage est vérifié en
navigateur, et toutes les vagues précédentes repassent.

## Sources

- Limites des fonctions Vercel : https://vercel.com/docs/functions/limitations
- Règles de transition (reprises de la réglementation FFTri) : https://www.toulonvartriathlon.com/en-savoir-plus/le-reglement-fftri-tvt-60324 et https://www.tac44.fr/articles/75497-triathlon-reglement-en-course
- Réglementation FFTri (tenue, combinaison, dossard) : https://www.fftri.com/wp-content/uploads/2021/05/FFTRI-Reglementation-des-Epreuves-Nationales-mise-a-jour-au-05-mai-2021.pdf ; seuils de température : https://univers-triathlon.com/triathlon-sans-combinaison/ ; retrait des dossards : https://www.versaillestriathlonfestival.com/informations-parcours/retrait-des-dossards/
- Distances du duathlon S (5 / 20 / 2,5 km) : https://www.christophellamas-coaching.com/conseils/distances-triathlon-guide-complet/ ; exemple de duathlon XS (2,5 / 11 / 1,25 km) : https://www.greentourtriathlon.eu/fr/reglement-128.html
- API Mistral (chat completions, sorties structurées json_schema) : https://docs.mistral.ai/api et https://docs.mistral.ai/studio-api/conversations/structured-output/custom
- Offres gratuites des API d'IA (Mistral Experiment, Cerebras, OpenRouter) : https://openrouter.ai/blog/tutorials/free-llm-apis-compared/
- Modèles Gemini disponibles et accès restreint aux modèles 2.5 : https://ai.google.dev/gemini-api/docs/models et https://ai.google.dev/gemini-api/docs/deprecations
- Changelog de l'API Gemini (modèles, `thinking_level`) : https://ai.google.dev/gemini-api/docs/changelog
- Sorties structurées Groq : https://console.groq.com/docs/structured-outputs
