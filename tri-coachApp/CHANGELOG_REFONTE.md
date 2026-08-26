# Refonte — résumé des changements

## -1. Retour terrain (26/08/2026) : unités d'allure + contenu natation pas assez lié au format de course

**Contexte :** malgré le point 0 ci-dessous, deux problèmes concrets signalés après usage réel :
1. L'onglet Profil > Zones d'entraînement affichait des valeurs d'allure absurdes ("117", "140"...
   avec l'unité "/km") — en réalité des BPM (zones FC), pas des allures.
2. Le formalisme "feuille de club" (3 blocs, notation N*Dm) était respecté sur la FORME, mais le
   CONTENU des séances natation restait générique : deux athlètes visant un sprint et un Ironman
   pouvaient recevoir des séances quasi identiques, alors qu'un club réel adapte radicalement le
   contenu (dominante vitesse/technique vs endurance longue) selon l'épreuve visée.

**Corrigé :**
- `lib/zones.js` / `components/ZoneCharts.js` : garde-fou `isPlausiblePaceZones` — une valeur
  d'allure stockée doit être une vitesse plausible (~0-26 km/h). Toute donnée déjà en localStorage
  qui ne l'est pas (signature de l'ancien bug : zones "Allure" calculées avec la formule des zones
  FC au lieu de la VMA) est ignorée et remplacée par la bonne valeur par défaut, ré-persistée
  immédiatement — l'athlète n'a rien à faire, la migration est silencieuse.
- `lib/workouts.js` : le formalisme "feuille de club" (point 0 ci-dessous) était jusqu'ici vérifié
  UNIQUEMENT par le prompt, sans aucun garde-fou déterministe après coup — contrairement à tous les
  autres champs de cette app. Ajout de `swimDescFormatIssue` (détecte un "desc" natation non
  conforme : bloc manquant, pas de notation N*Dm, pas de "Total : XXXXm" chiffré) branché sur
  `checkWorkoutCoherence`/`sanitizeWorkout`, et de `buildSwimClubDesc` (génère un repli réaliste
  respectant le format si l'IA a échoué) — même principe de robustesse que `enforceSessionCount`.
- `lib/gemini.js` : nouvelle guidance natation dédiée par format de course (S/M/L/XL) injectée
  directement dans la RÈGLE ABSOLUE N°2 — un format L/XL doit montrer une dominante endurance
  (blocs PULL/NC longs 200-800m, quasi pas de vitesse pure), un format S/XS une dominante
  vitesse/technique (séries courtes 25-100m). Nouveaux exemples travaillés par format, tokens "all
  SPRINT/OLYMPIQUE/HALF/XL" clarifiés, nouveau point d'auto-vérification (n°8) et nouveau critère
  (n°5) dans la passe de relecture IA (`reviewPlanCoherenceWithAI`) qui vérifie explicitement que
  le contenu natation n'est pas interchangeable entre deux formats différents.
- `components/WorkoutDetail.js` / `components/CalendarView.js` : nouveau parseur
  `parseClubSessionDesc` (lib/workouts.js) qui découpe "desc" en blocs Échauffement / Corps de
  séance / Total exploitables. Le détail de séance affiche désormais ces blocs séparément (au lieu
  d'un unique pavé de texte brut), total natation mis en avant en badge ; la vignette du calendrier
  affiche ce total à côté de la durée pour un repère volume en un coup d'œil, comme sur la grille
  hebdo réelle du club.

**Limite de cette passe (comme la précédente) :** toujours pas d'accès réseau dans ce sandbox pour
`npm install`/`next build` — relecture manuelle + vérifications de balance de syntaxe (parenthèses,
accolades, backticks) faites, mais pas de build réel. À valider après déploiement.

## 0. Formalisme des séances façon "feuille de club" (natation notamment)

**Contexte :** les séances réelles du club (exemples PDF fournis) suivent un format très
codifié — beaucoup plus précis qu'une simple phrase du type "nage 2000m en endurance" :
blocs Échauffement / Corps de séance / Total en mètres, notation compacte des séries
("6*100 R : 15''"), abréviations métier (NC, PULL, PLAQ, palmes, all HALF...). L'IA générait
jusqu'ici des séances correctes sur le fond mais beaucoup trop vagues dans la forme.

**Maintenant (`lib/gemini.js`, nouvelle RÈGLE ABSOLUE N°2 du prompt de génération) :**
- Le champ `desc` de chaque séance doit désormais reproduire ce formalisme exact :
  - **Natation** : 3 blocs obligatoires (`Échauffement :` / `Corps de séance :` / retour au
    calme + `Total : XXXXm`), séries notées `N*Dm (contenu) R : XX''`, vocabulaire imposé
    (NC = nage complète, PULL = pull-buoy, PLAQ = plaquettes, palmes, educ = éducatifs,
    `all HALF`/`all XL`/`all sprint` = allure course cible selon le format visé), volume
    total calculé réellement (pas recopié) et calibré selon le niveau (1200-1800m
    débutant → 3000m+ expert).
  - **Course à pied / vélo** : même esprit (blocs Échauffement / Corps de séance / retour au
    calme), notation compacte `N*(effort - récupération)` avec les valeurs chiffrées exactes
    des zones précalculées (ex `4*(3' @85% VMA - 1' @95% VMA - 2' souple)`).
  - Le champ `structure` (affiché sur la vignette du calendrier) reste volontairement un
    résumé en une phrase — c'est `desc` qui porte désormais le détail complet, exploitable
    seul sans repasser par l'app.
- Nouveau point n°7 dans l'auto-vérification obligatoire du prompt : relit et corrige le
  format natation (3 blocs + total en mètres cohérent) avant de renvoyer la réponse.
- `lib/workouts.js` : la détection `isInterval` (utilisée pour exiger un `restTime` et une
  `structure` non vides) reconnaît maintenant aussi la notation `4*100` en plus de `4x100`,
  cohérent avec la notation club (`*`) désormais utilisée par le prompt.


## 1. Fix de fond : la périodisation (le point que tu as signalé)

**Avant :** l'IA ne recevait que la phase de la semaine en cours (base / développement /
affûtage) et improvisait librement le tableau `trainingPlan.cycles` affiché dans l'onglet
Objectif → résultat : elle ne proposait quasiment jamais qu'un seul macrocycle, ce qui
viole le principe même de la périodisation.

**Maintenant :**
- Nouveau fichier `lib/periodization.js` : calcule de façon **déterministe** (jamais
  laissé à l'appréciation de l'IA) la structure complète de la préparation, du jour J
  jusqu'à l'objectif, découpée en plusieurs mésocycles réels :
  - ≤ 2 semaines → Affûtage final uniquement
  - ≤ 4 semaines → Développement spécifique + Affûtage
  - ≤ 8 semaines → Base + Développement spécifique + Affûtage
  - > 8 semaines → Base + Développement spécifique + Spécifique/pré-compétitif + Affûtage
    (modèle de périodisation linéaire classique ACSM/Bompa)
- Chaque mésocycle a des **dates réelles** et un **statut** (Terminé / En cours / À venir).
- `lib/gemini.js` : le prompt reçoit maintenant cette structure complète et doit la
  refléter dans `trainingPlan.cycles` — et surtout, **après** la réponse de l'IA, ce champ
  est systématiquement **écrasé par le calcul déterministe** (même logique de robustesse
  que `enforceSessionCount` ou `sanitizeWorkout` déjà dans ton code). Tu es donc garanti
  d'avoir toujours plusieurs macrocycles cohérents, quoi que renvoie le modèle.
- Onglet **Objectif** : nouvelle timeline verticale des mésocycles (pastilles reliées,
  phase en cours mise en évidence) au lieu d'une simple liste plate.

## 2. Refonte visuelle (carte blanche demandée)

- **Nouvelle couleur de marque** : violet électrique "volt" (`#8358FF`), qui identifie
  tout ce qui vient du **coach IA** (CTA, onglets actifs, timeline) — volontairement
  distinct des 3 couleurs déjà utilisées pour les disciplines (cyan = natation, ambre =
  vélo, émeraude = course), pour ne jamais les confondre. Remplace l'orange générique
  partout dans l'app.
- **Nouvelle échelle de gris** "ink" (légère dominante indigo) à la place du gris neutre
  par défaut — même structure de teintes, donc rien de cassé, juste plus de caractère.
- **Police mono dédiée** (JetBrains Mono) pour toutes les données chiffrées (allures,
  watts, bpm, comptes à rebours) — effet "montre GPS / compteur vélo", plus lisible que
  la police mono système par défaut.
- Fond avec halo radial violet très atténué, glows de marque sur les boutons principaux,
  focus clavier visible, scrollbar affinée.
- Liseré "tri-spectrum" (cyan → ambre → émeraude) sous le header : signature visuelle
  discrète qui rappelle les 3 disciplines.
- `tailwind.config.js`, `styles/globals.css`, `pages/_app.js`, `public/manifest.json`
  et les 8 fichiers pages/composants mis à jour de façon cohérente.

## Limites de cette passe

- **Build non vérifié en local** : le bac à sable où j'ai travaillé n'a pas d'accès
  réseau (`npm install` bloqué), donc je n'ai pas pu lancer `next build` pour une
  validation automatique complète. J'ai en revanche : passé tous les fichiers JS
  "purs" (`lib/*.js`, `pages/api/*.js`) au vérificateur de syntaxe de Node (aucune
  erreur), et vérifié à la main l'équilibre des balises/accolades sur tous les
  fichiers JSX modifiés. Lance `npm install && npm run dev` de ton côté pour un
  premier test — signale-moi la moindre erreur, je corrige immédiatement.
- **Icônes PWA** (`public/icons/*.png`, `favicon.ico`) : toujours à l'ancienne
  couleur orange, je n'ai pas d'outil de génération d'image pour les refaire ici.

## 2026-08-16 — Compte cloud (Supabase) + corrections calendrier/formulaire/vent

1. **Compte + synchronisation cloud (Supabase)** — nouveau, optionnel, rien ne casse tant
   que ce n'est pas configuré (voir `SUPABASE_SETUP.md`).
   - `lib/supabase.js` : client conditionnel (`isSupabaseConfigured` = false sans clés).
   - `lib/cloudSync.js` : synchronise un snapshot complet du localStorage (toutes les
     clés de `STORAGE_KEYS`) dans une seule table `tri_coach_data` (une ligne par
     utilisateur, RLS activée — voir `supabase-schema.sql`).
   - `components/AuthScreen.js` : écran de connexion Google, avec option "continuer
     sans compte".
   - `pages/index.js` : à la connexion, fusion des données cloud dans le navigateur
     (une fois par session) puis push cloud automatique (débounced) à chaque
     sauvegarde locale, y compris celles faites par `NutritionPlanner.js`.

2. **Compteur "jours restants"** — se rafraîchit désormais toutes les 60s au lieu de
   rester figé à la valeur calculée lors de la dernière génération de plan (utile en
   PWA laissée ouverte plusieurs jours).

3. **Bug "12 séances demandées, 6 affichées"** — `enforceSessionCount` (lib/workouts.js)
   savait retirer des séances en trop mais n'avait aucune logique pour EN AJOUTER quand
   l'IA n'atteignait pas le nombre demandé (fréquent au-delà de ~6-7/semaine, ça suppose
   des jours "doubles"). Ajout d'une correction déterministe qui complète avec de
   véritables séances supplémentaires, jamais sur le jour de repos obligatoire, en
   équilibrant les disciplines.

4. **Jauges du formulaire augmentées** : volume horaire 2–20h → 2–30h, séances/semaine
   2–12 → 2–14 (avec message d'info au-delà de 7, ça implique des jours doubles), allure
   course cible 3:00–8:00/km → 2:30–9:00/km pour des objectifs plus ambitieux.

5. **Vent sur la carte interactive** :
   - Vue générale : remplacement de la grille de flèches statiques par un champ de
     particules animées (canvas, interpolation du vecteur vent, traînées façon comète)
     qui suit visuellement le comportement réel du vent.
   - Tracé GPX : toujours des flèches, mais bien plus denses et collées au tracé
     (échantillonnage ~35 points sur tout le parcours au lieu de ~25, jamais plus d'un
     point tous les 300m) — objectif : lire d'un coup d'œil le vent sur SON parcours.

## 2026-08-16 (suite) — Tableau de bord "Performance & progression" (onglet Profil)

Ajouté sous le profil santé, 4 panneaux, **entièrement dérivés de données réelles déjà
présentes dans l'app** (aucune donnée inventée, même principe que `lib/physiology.js`) :

- **Charge & forme ressenties** : courbe difficulté/forme à partir de `feedbackHistory`
  (réel, daté, rempli à chaque validation de séance). L'app n'ayant pas de capteur
  connecté (pas de FC/puissance réelles), on n'affiche PAS un vrai CTL/ATL/TSB
  (ça nécessiterait des données capteur) mais son équivalent honnête basé sur le ressenti.
- **Volume prévu** : heures par discipline pour les 2 seules semaines réellement en
  mémoire (Semaine en cours / N+1) — pas un faux historique de 7 semaines qui n'existe
  pas dans les données de l'app.
- **Distribution des zones** : minutes par zone (Z1-Z5) de la semaine en cours, déduites
  du champ `cardio` de chaque séance du plan.
- **Métriques clés** : FTP, allure seuil (estimée depuis la VMA, comme le fait déjà le
  générateur de plan), VO2max estimé (formule VMA×3,5), CSS natation, FC max, poids —
  avec delta réel vs la mesure précédente quand l'historique (`healthHistory`) le permet.

Nouveau : `lib/analytics.js`, `components/PerformanceDashboard.js`.

## 2026-08-16 (suite 2) — Doublons de séances + lisibilité du tableau de bord

1. **Fix du vrai bug de fond des jours "doubles"** : quand un jour comportait 2
   séances, elles étaient souvent identiques (ex: 2x le même footing). Cause :
   `enforceSessionCount` générait les séances ajoutées avec un template générique
   unique, et rien n'empêchait non plus l'IA de produire deux séances quasi
   identiques sur le même jour.
   - Nouveau catalogue `COMPLEMENTARY_TEMPLATES` (lib/workouts.js) : séances
     variées et structurées par discipline (récupération / endurance / côtes /
     technique / fractionné pour la course, équivalents vélo et natation).
   - `buildComplementaryWorkout` : pour un jour double, privilégie une discipline
     différente de celle déjà présente ce jour-là (vrai enchaînement/brick) ; en
     mono-discipline, choisit un type de séance différent de celui déjà utilisé.
   - `dedupeIdenticalSameDaySessions` (nouveau, exporté) : filet de sécurité final
     qui corrige tout doublon résiduel (même discipline + même titre le même jour),
     quelle que soit son origine (IA ou correction déterministe) — appliqué à la
     fois dans `enforceSessionCount` et juste après la génération IA (lib/gemini.js).
   - Prompt IA (lib/gemini.js, règle absolue n°0) : interdiction explicite des
     doublons sur un jour double, avec consigne de variété.

2. **Tableau de bord "Performance & progression" — lisibilité** :
   - Graphiques (Charge & forme / Volume prévu) : hauteur fixe (`h-56`/`h-64`),
     `maintainAspectRatio: false` (ils étaient écrasés par le layout en grille,
     donc quasi illisibles sur mobile), grille légère mais visible, légende en bas,
     polices agrandies (11-12px au lieu de 10px), et passage en pleine largeur
     (colonne unique) plutôt qu'en grille 2 colonnes trop étroite.
   - Métriques clés : police réduite (label 10px, valeur 12px au lieu de 14px,
     delta 9px) pour un rendu plus compact et cohérent avec le reste de l'app.

## 2026-08-16 (suite 3) — Formalisme "feuille de club" appliqué aux templates de secours

Le formalisme imposé à l'IA (RÈGLE ABSOLUE N°2, section 0 ci-dessus) ne concernait que les
séances générées par le modèle. Les séances de secours déterministes (`COMPLEMENTARY_TEMPLATES`,
lib/workouts.js — utilisées par `buildComplementaryWorkout` pour compléter un jour double et par
`dedupeIdenticalSameDaySessions` pour corriger un doublon) étaient restées en prose générique,
créant un mélange de styles visible dans le calendrier selon qu'une séance vienne de l'IA ou d'un
filet de sécurité.

1. **`COMPLEMENTARY_TEMPLATES` réécrit** : chaque `desc` (course, vélo, natation) suit maintenant
   exactement les mêmes blocs "Échauffement :" / "Corps de séance :" / retour au calme, avec la
   même notation compacte "N*(effort - récupération)" en %VMA/%FTP pour course et vélo, et le
   même format 3 blocs + "Total : XXXXm" pour la natation (mêmes abréviations : NC, educ, R : XX'',
   all HALF...).
2. **Fix du détecteur `isInterval`** (3 occurrences, lib/workouts.js) : la regex ne reconnaissait
   que "4x100"/"6*100" (notation plate), pas "4*(3' @85% VMA..." (notation par bloc avec
   parenthèse juste après l'opérateur) — ce qui est pourtant le format demandé à l'IA elle-même
   pour course/vélo. Sans ce correctif, une séance fractionnée rédigée dans CE format (IA ou
   template) n'aurait pas déclenché l'exigence de `restTime`/`structure` détaillés.
3. **Notes automatiques déplacées sur leur propre ligne** (`buildComplementaryWorkout`,
   `dedupeIdenticalSameDaySessions`) : le texte "(séance ajoutée automatiquement...)" /
   "(ajusté automatiquement...)" était accolé directement après le `desc`, ce qui aurait pollué la
   ligne "Total : XXXXm" ou la ligne de retour au calme. Il est maintenant séparé par une ligne
   vide.
4. **Fix d'affichage** (`components/WorkoutDetail.js`) : le conteneur du `desc` n'avait pas
   `whitespace-pre-line`, donc les retours à la ligne du formalisme (IA comme templates) étaient
   silencieusement collapsés en un seul paragraphe par le navigateur — le formalisme en blocs ne
   se voyait donc jamais réellement à l'écran. Corrigé.

## 2026-08-18 — Bug critique : séances empilées sur un seul jour (semaine incomplète)

Remonté par un test réel : le samedi se retrouvait avec 7 séances de natation quasi identiques
empilées, pendant que plusieurs autres jours de la semaine restaient totalement vides à l'écran.

**Cause racine** : rien dans le code ne garantissait que les 7 jours du calendrier soient tous
représentés dans la réponse JSON de l'IA. Quand l'IA renvoyait une semaine incomplète (ex: 3 jours
sur 7 seulement — un cas de réponse tronquée/malformée, déjà vu ailleurs dans le projet), toute la
chaîne de garde-fous en aval (`checkSessionCountCoherence`, `enforceSessionCount`,
`rebalanceSameDisciplineDoubles`...) travaillait uniquement sur les jours présents. Résultat :
`enforceSessionCount`, chargé de compléter le nombre de séances manquantes pour atteindre le total
déclaré au questionnaire, ne pouvait distribuer ces séances QUE sur les 2-3 jours existants — d'où
l'empilement, plutôt qu'une vraie répartition sur toute la semaine. Reproduit et confirmé par un
script de test isolé avant correction.

**Correctif** :
- Nouvelle fonction exportée `ensureAllDaysPresent` (lib/workouts.js) : complète toute semaine reçue
  avec un REPOS neutre pour chaque jour de `DAYS_OF_WEEK` absent du tableau — ne touche jamais aux
  jours déjà présents, n'invente jamais une vraie séance à la place d'un jour manquant. Idempotente.
- Appelée à la source, dans `lib/gemini.js`, dès la construction de `sanitized` (avant
  `checkSessionCountCoherence`/`enforceSessionCount` et tout le reste de la chaîne de garde-fous),
  pour que toute la logique en aval voie toujours une semaine complète.
- Appelée aussi en défense en profondeur directement au début de `enforceSessionCount` (au cas où
  la fonction serait un jour appelée ailleurs sans être passée par `lib/gemini.js` en amont) et dans
  `ensureCompleteWorkouts`.
- Effet concret : un jour auparavant absent devient un REPOS normal, que la logique existante de
  répartition round-robin (déjà dans `enforceSessionCount`) traite alors comme n'importe quel autre
  jour éligible à recevoir une séance manquante — la distribution redevient uniforme sur les 7 jours
  au lieu de s'empiler sur les quelques jours qui existaient.
