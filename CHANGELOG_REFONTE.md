# Refonte — résumé des changements

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
