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
| Tests unitaires | 23/24 | 63/63 |

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

## Sources

- Limites des fonctions Vercel : https://vercel.com/docs/functions/limitations
- Changelog de l'API Gemini (modèles, `thinking_level`) : https://ai.google.dev/gemini-api/docs/changelog
- Sorties structurées Groq : https://console.groq.com/docs/structured-outputs
