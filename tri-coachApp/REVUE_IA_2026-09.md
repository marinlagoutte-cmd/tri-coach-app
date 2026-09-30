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
| Tests unitaires | 23/24 | 193/193 |

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

### Suite : lecture du diagnostic réel (27/09, 17:40)

**Résultat** : tout fonctionne, avec double vérification.
- Plan et relecture : gemini-3.7-flash + gpt-oss-120b.
- Chat : gemini-3.6-flash + gpt-oss-120b.
- Tâches légères : gemini-3.5-flash-lite + gpt-oss-20b.

Seuls 2 modèles sur 8 échouaient, pour des causes passagères : gemini-3.8-flash (5xx,
surcharge) et gemini-3.5-flash (pas de réponse en 15 s). Mistral affichait « Clé absente »
(clé remise et redéployée ensuite).

Deux défauts de la version précédente, corrigés :
- **Mauvaise recommandation.** La « configuration recommandée » conseillait de retirer
  définitivement gemini-3.8-flash et gemini-3.5-flash pour une panne passagère. Elle ne retire
  désormais que les modèles durablement indisponibles (inexistants pour la clé, sans quota
  gratuit).
- **Pannes passagères non mémorisées.** En production, un modèle surchargé (5xx) est
  maintenant mis de côté 10 min. Un modèle qui dépasse son délai l'est aussi, mais seulement
  s'il avait son délai complet, pas un délai raccourci en fin de budget. Ces pannes s'affichent
  en orange, pas en rouge.

Tests : 172 tests unitaires, dont la reproduction exacte du diagnostic réel.

## 17. Profil dans la photo, saisie des chronos, lisibilité en thème sombre

**Profil dans la photo de l'en-tête**
- La barre du bas passe à 5 onglets. Le Profil s'ouvre en touchant la photo de profil, en haut
  à droite (entourée quand le Profil est ouvert).
- Les réglages (⚙️) sont désormais toujours visibles dans l'en-tête. Le menu de compte est
  retiré : l'adresse et la déconnexion figuraient déjà dans les réglages.
- **Photo de profil**, trois sources possibles :
  - envoi depuis le téléphone, recadré en carré de 256 px et compressé (quelques Ko) ;
  - Strava : récupérée à la connexion (nouvelle route `/api/strava/athlete-photo`), utilisée
    automatiquement si l'athlète n'a rien choisi. L'image par défaut « sans photo » de Strava
    est ignorée ;
  - sinon, les initiales.
- La carte d'identité du Profil permet de changer la photo, reprendre celle de Strava, la
  retirer, ou ouvrir les réglages. Une photo retirée volontairement n'est jamais remplacée
  automatiquement par celle de Strava.

**Saisie des chronos au clavier numérique** (`lib/timeMask.js`, `components/TimeInput.js`)
- Le clavier numérique des téléphones n'a pas de touche « : ». On tape seulement des
  chiffres, et les « : » se placent tout seuls en partant de la droite : 3, 0 → 00:30.
- Formats : hh:mm (chronos du triathlon, temps visé du duathlon), hh:mm:ss (chrono récent),
  mm:ss (CSS, dans le questionnaire et dans le Profil). Le collage d'une valeur existante
  fonctionne, et les minutes ou secondes supérieures à 59 sont signalées.
- Le texte produit garde exactement le format lu par le reste de l'app.

**Distances préremplies invisibles en thème sombre**
- Cause : sur mobile, ces champs n'avaient pas de fond, et le navigateur appliquait son blanc
  par défaut sous un texte clair.
- Correction : fond explicite. Un audit de contraste réel en thème sombre (questionnaire,
  Profil, Objectif, tous les outils, réglages) ne trouve plus aucun champ illisible.

**Vérifications** : 178 tests unitaires. Parcours navigateur : 16/16 (saisie au clavier,
données transmises au coach, photo, audit de contraste). Toutes les vagues précédentes
repassent.

## 18. Analyse d'un plan réel (triathlon S, 20 h, 15 séances, dimanche de repos)

Le plan observé :
- Semaine 39 : 15 séances comptées (14 cartes, dont un enchaînement compté 2), 17h45 pour
  ~18 h attendues (charge 1/3).
- Semaine 40 : 12 séances seulement, 18h04 pour ~19 h attendues (charge 2/3).

Trois défauts de l'app, corrigés :
1. **Consigne impossible.** Pour 15 séances sur 6 jours, le prompt disait « il faut 9 jours avec
   2 ou 3 séances ». Il donne désormais la répartition exacte : 3 jours à 3 séances, 3 jours à 2.
2. **Garde-fou plafonné à 12.** `enforceSessionCount` limitait toujours à 2 × jours
   disponibles, héritage d'avant les journées à 3 séances. Une semaine rendue à 12 séances
   n'était donc jamais complétée. Le plafond passe à 3 × jours quand le profil y a droit, et
   l'éligibilité dépend désormais des jours de repos réellement déclarés, et non d'un seuil fixe
   de 12. La semaine 40 réelle est complétée à 15 en test.
3. **Aperçu des semaines suivantes** : il annonçait « ~18 h » pour une charge pleine (20 h) comme
   pour une décharge (14 h). Il repose maintenant sur le calcul de saison.

S'y ajoutent deux changements d'interface :
- le compteur du calendrier indique « x séances · y comptées » quand un enchaînement compte 2 ;
- un bouton « Régénérer la semaine suivante avec les réglages actuels » est disponible sans
  modification préalable.

Observations sur le contenu généré (non corrigées dans le code, signalées à l'athlète) :
- **Allures de course plus rapides que la Z2 confirmée sur le terrain.** Les allures
  correspondent à une VMA d'environ 21 km/h (VMA à 2:51/km) : footing de récupération à 4:30,
  sortie longue à 4:20.
- **Natation uniforme** (2600 m pour chaque séance, récupération comprise). CSS inconnue, donc
  pas de contrôle durée/distance possible.
- **Tempo le vendredi puis enchaînement avec tempo le samedi.** Le tempo (Z3) n'est pas classé
  comme séance dure par le contrôle des jours consécutifs.

Tests : 182 tests unitaires, dont le cas réel ; parcours navigateur au vert.

## 19. Retour de séance fiable, en-tête allégé, écran Aujourd'hui compact, météo du jour

**Retour de séance (activité Strava)** — cas réel : sortie vélo un lundi sans vélo au programme,
comparée au sweet spot du mercredi de la semaine précédente (« 330 W demandés »).

Causes :
1. L'association « approximative » (même discipline, autre jour) servait de référence à
   l'analyse.
2. Le serveur ne connaissait pas la date de début de la semaine en cours, et comparait donc à
   la semaine précédente tant que l'app n'avait pas été rouverte.

Corrections :
- **Bonne semaine** : elle est déduite de la date de l'activité (`weekKeyForDate`), grâce au
  plan désormais chargé côté serveur.
- **Référence** : seule une séance prévue le même jour sert de comparaison. Sinon, la séance est
  « hors plan » (verdict neutre forcé), avec ce qui était prévu ce jour-là, et la mention au
  conditionnel d'une éventuelle séance déplacée.
- **Faits calculés par l'app** (`lib/activityFacts.js`) : durée, distance, % FTP et zone, FC et
  zone, allure et zone, d'après les zones personnalisées de l'athlète si elles existent.
- **Format** : 3 lignes (Réalisé / Par rapport au plan / Pour la suite), 70 mots au maximum,
  factuel, sans formule d'accroche.

**En-tête et Profil**
- L'en-tête ne garde que le logo TC (retour à Aujourd'hui), l'aide et la photo de profil.
- Les notifications et les réglages sont dans la carte du Profil, et l'anneau autour de la photo
  est retiré.
- La gestion de la photo (ajouter, changer, photo Strava, retirer) est déplacée dans les
  réglages.

**Densité**
- Texte de base à 14 px, avec un écran Aujourd'hui fortement compacté : il tient sur une page.
- Les cibles tactiles principales sont fixées en pixels, pour ne pas rapetisser avec la base à
  14 px. L'audit mobile ne signale plus que les liens d'attribution des cartes et l'interrupteur
  standard.

**Météo du jour** (widget d'Aujourd'hui) : températures maximale et minimale, ciel, risque de
pluie, vent maximal avec sa direction et les rafales. La position est demandée une fois puis
mémorisée (arrondie à environ 1 km). Un appui ouvre l'outil Météo.

**Vérifications**
- 189 tests unitaires, dont le cas réel de la sortie du lundi.
- Parcours navigateur de cette vague : 10/10.
- Les parcours plus anciens, écrits avec des dates figées (semaine du 21/09), ont été rejoués
  avec l'horloge du navigateur ramenée à leur date d'écriture : toutes leurs vérifications
  fonctionnelles repassent.

## 20. Natation : volume, densité et séance longue

**Constat** (plan réel, expert en format S, 20 h/semaine, CSS 1:40) : 4 natations de 1500 à
2600 m, soit 8,3 km sur la semaine, dont trois « technique » (1500 m en 45 min).

Trois causes dans l'app :
1. La consigne disait « séances de récupération/technique : plus courtes ».
2. Le plancher de volume ignorait toute séance intitulée « technique » ou « allégée ».
3. Le contrôle distance/durée tolérait une densité très faible.

**Repères de la littérature**
- Triathlète de classe mondiale (préparation olympique) : ~25 km/semaine de natation, ~6
  séances, répartition ~74 % sous le seuil, ~16 % au seuil, ~10 % au-dessus (Mujika, IJSPP
  2014).
- Amateurs de niveau intermédiaire : 8 à 12 km/semaine en 3-4 séances de 2 à 3 km et plus.
- Nageurs d'élite : réduire le volume de moitié au profit de l'intensité n'a ni amélioré ni
  dégradé la performance (Kilen et al., PLoS One 2014). Le volume n'est pas le seul levier.

**Corrections** (`lib/swimPlanning.js`)
- **Densité.** Chaque natation, hors récupération et test, contient au moins 85 % de la
  distance réaliste pour sa durée à la CSS : 60 min à 1:40 ≈ 2900 m, soit ≥ ~2450 m, l'ordre
  de grandeur d'une séance club d'une heure. Des 200 m sont ajoutés sans allonger la séance.
- **Volume hebdomadaire visé** selon le niveau, le format et les heures : un expert en format S
  vise ~13,2 km à 18 h et ~14,3 km à 20 h (plafond). Il suit aussi la nature de la semaine
  (décharge, affûtage…). L et XL ne dépassent pas le M.
- **Séance longue** (4 à 5 km) chez les confirmés et experts, en semaine de charge de la phase
  de base ou de développement. Si le volume est sous la cible, la plus longue natation aérobie
  est allongée, dans la limite de la disponibilité du jour.
- **Fin du contournement « technique ».** Chez un confirmé ou un expert, une séance
  « technique » n'échappe plus au plancher : les éducatifs s'intègrent dans de vraies séances.
- **Consigne réécrite.** Elle donne le volume visé, la densité pour 45/60/75/90 min, la séance
  longue, la répartition d'intensité et les types de séances : seuil CSS ; vitesse et départs ;
  aérobie et force (PULL/PLAQ) ; allures de course mêlées façon club (all HALF / all S / à
  fond) ; palmes ; eau libre en phase spécifique ; respect d'un créneau club fixe.
- **Validateur.** Deux nouveaux avertissements, `SWIM_LOW_DENSITY` et `SWIM_WEEK_VOLUME`, ce
  dernier à partir du niveau intermédiaire.
- **Lecture des séances club.** Les distances seules (« 100 à fond », « 300 allure S ») et les
  séparateurs « + » et « - » sont maintenant reconnus. La séance club du vendredi est lue
  exactement : 2500 m sur 2500.
- **Semaines modèles expert** (S, M, long) : séances denses et séance longue de 4,2 à 4,5 km.
  Le plan de référence « Opus » avait lui aussi une natation trop légère (~9,9 km pour 18 h,
  sans séance longue) : il est mis à jour.

**Résultat sur les 4 natations réelles** : 8,3 km → 11,3 km. La séance de 45 min est
densifiée, une séance longue est créée, et la séance allégée pour cause de fatigue reste
intacte. Le garde-fou n'est qu'un filet de sécurité : c'est la nouvelle consigne qui doit
produire directement ~13-14 km en séances structurées.

Tests : 193 tests unitaires. Parcours navigateur au vert.

## 21. Refonte de l'expérience (inspirée de l'app de lecture montrée, de Strava et de Garmin)

**Principes retenus** : une seule couleur d'accent pour l'action et l'état actif ; des icônes
au trait (lucide-react, licence MIT) à la place des emojis ; une barre de navigation flottante
avec un bouton central d'actions rapides ; des onglets soulignés ; des titres de section en
casse normale ; des listes groupées ; des statistiques « valeur au-dessus du libellé » en
chiffres alignés. Un seul élément fort : la carte « Séance du jour », teintée selon le sport.

**Réalisé**
- **Briques** (`components/ui/`) : `sport.js` (icône, nom et teinte par discipline),
  `SectionTitle`, `Stat`, `UnderlineTabs`, `BottomNav`, `QuickActions`.
- **Navigation** : pilule flottante avec Aujourd'hui, Calendrier, Objectif et Coach. Le bouton
  central ouvre les actions rapides (séance du jour, coach) et les six outils. Les Outils ne
  sont donc plus un onglet de la barre du bas.
- **Aujourd'hui** : carte de séance teintée avec durée, intensité et distance ou zone ; listes
  groupées pour Demain et « À confirmer » ; « Cette semaine » avec fait, prévu et Strava, et des
  barres par jour (prévu en gris, réalisé en accent) ; « Ma forme » en statistiques ; widget
  météo sobre. La taille compacte demandée précédemment est conservée.
- **Calendrier** : onglets soulignés par semaine ; filtres en français (Tout, Natation, Vélo,
  Course) ; bilan en statistiques ; séances avec pastille de sport ; « double » discret.
- **Détail de séance** : pastille et nom du sport, titre en grand, valeurs en chiffres alignés,
  « Valider la séance » en action principale.
- **Outils et Profil** : onglets soulignés, avec icônes pour le Profil.
- **Harmonisation** : 88 lignes dans 20 fichiers passent des titres et étiquettes en capitales
  à chasse fixe vers la casse normale, et les emojis des titres de section sont retirés.

**Défauts trouvés et corrigés pendant la revue visuelle**
- Le Calendrier plantait : une fonction voisine (couleur du trait entre deux séances d'un jour
  double) avait été supprimée par erreur. Aucun test unitaire ne charge ce composant ; la
  capture d'écran l'a révélé.
- Carte météo : la position du téléphone pouvait arriver après la fermeture de l'écran et faire
  échouer Leaflet (« _leaflet_pos »). Elle est ignorée si la carte n'existe plus, et la carte
  est nettoyée proprement à la fermeture.

**Dépendance ajoutée** : `lucide-react` (dans package.json ; Vercel l'installe au déploiement).

**Vérifications** : 193 tests unitaires ; build ; parcours navigateur adaptés à la nouvelle
interface et repassés. Les seuls échecs restants viennent des parcours à date figée (horloge
simulée), et existaient déjà avant cette refonte. L'audit mobile est inchangé.

### Suite de la refonte : Objectif, Coach, visite guidée

- **Objectif** : carte « Objectif en cours » avec pastille drapeau, titre, date, statistiques
  (jours restants, semaines, progression), une fine barre d'avancement de la préparation et les
  temps par discipline avec pastilles de sport. Le temps visé et la prédiction de chrono passent
  au même style : chrono en grand, temps par discipline en valeur/libellé, sans emojis ni chasse
  fixe.
- **Coach** : bulles façon messagerie (texte en 14 px) ; actions en pastilles avec icônes
  (« Ajouter une séance », « Modifier une séance », « Donner un ressenti », dans les trois
  langues) ; suggestions en pastilles d'accent ; saisie en pilule avec bouton d'envoi rond.
- **Visite guidée** : ses aperçus reproduisent la nouvelle interface (carte de séance teintée,
  onglets soulignés, bouton + des outils) ; emojis retirés de ses étiquettes.

**Vérifications** : 193 tests unitaires, build, parcours navigateur (dont le chat) repassés,
audit mobile inchangé.

## 22. Natation variée, méthodes VO2max et double seuil, outil Allures & chronos, radar, thème clair

**Natation** (retours de l'athlète)
- **Une seule natation par jour** (`enforceOneSwimPerDay`) : la natation secondaire
  (récupération d'abord) est déplacée vers un jour sans natation, jamais un jour de repos ni
  d'enchaînement.
- **Distance minimale par séance, récupération comprise** (`swimMinimumMeters`) : 2500 m pour
  un expert à 15 h ou plus, 2200 m pour un confirmé à 12 h ou plus. Elle est réglable dans les
  réglages du plan et dans le questionnaire.
- **Variété.** Les compléments automatiques ne sont plus des « k*200 NC Z2 » ou
  « k*400 PULL Z2 », mais des blocs variés (éducatifs nommés, pyramide, dégressif, jambes,
  respiration, dos, godille). La consigne exige des éducatifs nommés dans chaque séance, au
  moins 3 types de séries, et deux séances de la semaine jamais identiques.
- **Validateur** : trois nouveaux avertissements, `SWIM_MONOTONOUS`, `SWIM_MIN_DISTANCE` et
  `SWIM_SAME_DAY`. Le compteur de mètres lit désormais les pyramides.
- Trois natations monotones de la bibliothèque de semaines modèles ont été réécrites.

**Méthodes d'intensité** (confirmés/experts à 12 h ou plus, en développement et spécifique)
- **4×4** : 4 × 4 min à 90-95 % FCmax, récupération active de 3 min (Helgerud 2007 : +7,2 % de
  VO2max en 8 semaines).
- **Intervalles à départ rapide** : plus de temps au-dessus de 90 % de VO2max qu'à intensité
  constante (Bossi 2020, 410 s contre 286 s), mais pas de bénéfice à long terme démontré ; à
  alterner avec le 4×4.
- **Double seuil norvégien** : deux blocs contrôlés juste sous le seuil 2, 1 jour par semaine,
  comptés comme une journée dure, le reste de la semaine très facile.

**Outil « Allures & chronos »** (`lib/runCalculator.js`, `components/PaceCalculator.js`)
- Chronos du 1500 m au marathon, d'après la VMA (% tenable selon la distance, le même que celui
  du coach ; ajout d'un palier à 103 % jusqu'à 2 km) et d'après une perf de référence (Riegel,
  exposant 1,06).
- Allures et FC par zone, avec les zones réglées par l'athlète si elles existent.
- Temps de passage tous les 100 m jusqu'à 1500 m, pour un % de VMA réglable.

**Radar de pluie**
- RainViewer limite son accès gratuit depuis le 1er janvier 2026 : zoom 7 maximum, un seul jeu
  de couleurs, passé uniquement.
- Trois bugs de l'app corrigés : le calque vide était rendu visible ; la bascule d'image se
  faisait avant le chargement des tuiles ; aucune erreur n'était signalée.
- Vérifié avec des données simulées : tuiles au zoom 7, calque visible.

**Écran de génération** : barre de progression en parcours de triathlon (athlète qui change de
sport), étapes, temps écoulé, avancement marqué « estimation ».

**Bouton +** : neutre (blanc ou noir selon le thème) au lieu de l'orange.

**Thème clair**
- Un audit de contraste de TOUS les textes affichés (14 écrans) relevait 363 textes sous le
  seuil au départ.
- Corrections : gris secondaires assombris ; couleurs vives en texte remplacées par des nuances
  foncées ; fond d'accent plein plus foncé sous le texte blanc ; couleurs posées en ligne
  (valeurs du Profil, zones) corrigées.
- Résultat : plus aucun texte sous le seuil, hors un emoji et un faux positif (logo en dégradé).
- En thème sombre, le gris des petites étiquettes est légèrement éclairci. Le texte blanc sur
  l'orange de marque reste à 3,4:1, choix d'identité conservé.

**Vérifications** : 201 tests unitaires ; build ; parcours navigateur (outil, radar simulé,
écran de progression, et tous les parcours précédents) ; audit mobile inchangé.

## 23. Suivi d'usure : toutes les pièces du vélo, en kilomètres et en mois

**Référentiel** (`lib/bikeParts.js`) : 31 pièces, chacune avec une zone, une durée de vie et un
critère concret de remplacement.

**Usure au kilomètre**
| Pièce | Durée de vie | Repère publié |
|---|---|---|
| Chaîne | 3 500 km | 2 000-5 000 km ; changer à 0,5 % d'allongement en 11-12 vitesses |
| Cassette | 10 000 km | 2 à 3 chaînes, 8 000-16 000 km |
| Plateaux | 15 000 km | 4 à 6 chaînes |
| Galets | 12 000 km | 10 000-16 000 km sur route |
| Cales | 6 000 km | 4 800-8 000 km (Wahoo) ; Look Keo plus tôt |
| Boîtier de pédalier | 10 000 km | 5 000-16 000 km |
| Pneu arrière | 4 500 km | 3 000-6 000 km |
| Pneu avant | 8 000 km | environ 2 fois le pneu arrière |
| Pédales | 12 000 km | pas de chiffre fabricant (valeur conservée) |

**Usure au temps** (comptée depuis le dernier remplacement dans l'historique, sinon depuis la
création de la pièce)
| Pièce | Durée | Repère publié |
|---|---|---|
| Préventif tubeless | 4 mois | 2 à 6 mois |
| Liquide de frein | 12 mois | DOT (SRAM), environ 24 mois pour l'huile minérale |
| Moyeux (roulements et roue libre) | 12 mois | entretien annuel, DT Swiss |
| Jeu de direction | 18 mois | 1 à 2 ans |
| Ruban de cintre | 12 mois | environ 1 an |
| Câbles et gaines (mécanique) | 30 mois | 2 à 3 ans |

**Repères de contrôle** (aucun chiffre en km n'est publié ; la règle est l'épaisseur)
- Plaquettes : contrôle à 3 000 km, changer sous 3 mm (garniture + support, SRAM).
- Disques : contrôle à 10 000 km, changer sous 1,55 mm (disque SRAM de 1,85 mm) ou 1,5 mm
  (Shimano).

**Pièces de référence** (pas d'usure au kilomètre ni au temps : choc, casse) : manivelles,
dérailleurs, batterie AXS, roues, axes, leviers, durites, cintre, selle, tige, serrage, cadre,
fourche. Elles sont listées avec leur critère de contrôle au lieu d'être masquées.

**Pièces déjà suivies**
- Une pièce qui porte encore l'ancienne valeur par défaut reçoit la nouvelle valeur documentée
  à la prochaine synchro Strava.
- Une valeur réglée par l'athlète n'est jamais écrasée.
- Les câbles de dérailleur ne sont pas ajoutés sur l'Aeroad, dont la transmission est
  électronique (SRAM AXS).

**Écran**
- Usure = la plus avancée entre le kilomètre et le temps.
- Affichage « x / y km » et/ou « x mois / y mois ».
- Critère de remplacement sous chaque pièce.
- Bouton « changé / entretenu aujourd'hui », qui remet aussi le compteur de temps à zéro.

**Vérifications**
- Tests unitaires : 210 au total, dont le référentiel et une synchro simulée de l'Aeroad
  (ajouts, mises à jour, réglage conservé).
- Test ponctuel de l'écran avec une base simulée (jsdom), non conservé dans la suite.
- Build OK.

## Sources

- Limites des fonctions Vercel : https://vercel.com/docs/functions/limitations
- Règles de transition (reprises de la réglementation FFTri) : https://www.toulonvartriathlon.com/en-savoir-plus/le-reglement-fftri-tvt-60324 et https://www.tac44.fr/articles/75497-triathlon-reglement-en-course
- Réglementation FFTri (tenue, combinaison, dossard) : https://www.fftri.com/wp-content/uploads/2021/05/FFTRI-Reglementation-des-Epreuves-Nationales-mise-a-jour-au-05-mai-2021.pdf ; seuils de température : https://univers-triathlon.com/triathlon-sans-combinaison/ ; retrait des dossards : https://www.versaillestriathlonfestival.com/informations-parcours/retrait-des-dossards/
- Durées de vie des pièces (synthèse, juillet 2026) : https://watchmy.bike/blog/how-long-do-bike-parts-last
- SRAM, entretien des freins (disques 1,55 mm, plaquettes 3 mm) : https://www.sram.com/en/learn/brake-welcome-guide/brake-service-guide
- Cales (Shimano, Look, Wahoo) : https://www.cyclistshub.com/when-to-replace-cycling-cleats/
- Plateaux et cassettes : https://www.componentry.app/blog/cassette-lifespan
- Helgerud et al., Med Sci Sports Exerc 2007 (4×4) : https://www.semanticscholar.org/paper/Aerobic-high-intensity-intervals-improve-VO2max-Helgerud-H%C3%B8ydal/263bb580cc0f447793be7a49db7cdca326794e19
- Bossi et al., IJSPP 2020 (intervalles à intensité variée) : https://pubmed.ncbi.nlm.nih.gov/32244222/
- Casado et al., IJERPH 2023 (double seuil) : https://doi.org/10.3390/ijerph20053782
- Restrictions RainViewer 2026 : https://www.rainviewer.com/api/transition-faq.html
- Volume natation d'une triathlète de classe mondiale : Mujika I., IJSPP 2014, https://journals.humankinetics.com/view/journals/ijspp/9/4/article-p727.xml
- Réduction de volume et HIT chez des nageurs d'élite : Kilen et al., PLoS One 2014, https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3988165/
- Volumes indicatifs par niveau (amateurs) : https://us.zen8swimtrainer.com/blogs/news/triathlon-swim-training-all-you-need-to-know
- Distances du duathlon S (5 / 20 / 2,5 km) : https://www.christophellamas-coaching.com/conseils/distances-triathlon-guide-complet/ ; exemple de duathlon XS (2,5 / 11 / 1,25 km) : https://www.greentourtriathlon.eu/fr/reglement-128.html
- API Mistral (chat completions, sorties structurées json_schema) : https://docs.mistral.ai/api et https://docs.mistral.ai/studio-api/conversations/structured-output/custom
- Offres gratuites des API d'IA (Mistral Experiment, Cerebras, OpenRouter) : https://openrouter.ai/blog/tutorials/free-llm-apis-compared/
- Modèles Gemini disponibles et accès restreint aux modèles 2.5 : https://ai.google.dev/gemini-api/docs/models et https://ai.google.dev/gemini-api/docs/deprecations
- Changelog de l'API Gemini (modèles, `thinking_level`) : https://ai.google.dev/gemini-api/docs/changelog
- Sorties structurées Groq : https://console.groq.com/docs/structured-outputs
