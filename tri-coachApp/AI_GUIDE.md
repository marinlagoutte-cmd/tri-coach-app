# AI_GUIDE.md — guide pour toute IA travaillant sur ce projet

Ce fichier existe pour qu'une IA qui n'a jamais vu ce projet (nouvelle session, nouvel
outil, nouveau modèle) comprenne en quelques minutes l'architecture, les règles
importantes et l'historique récent, sans devoir relire tout le code.

**Règle obligatoire : à chaque intervention sur ce projet, ajoute une ligne dans la
section "Journal des interventions IA" tout en bas de ce fichier** (voir format et
exemple à la fin). Objectif : que l'athlète et les IA suivantes voient qui a fait quoi,
quand, et pourquoi — sans avoir à comparer les diffs Git.

---

## 1. Vue d'ensemble

- App web de coaching triathlon / course à pied, en **Next.js** (pages router, pas
  app router), déployée sur **Vercel**.
- Stockage local : `localStorage` (voir `lib/storage.js` — `STORAGE_KEYS` liste TOUTES
  les clés utilisées). Stockage cloud optionnel : **Supabase** (auth + sync), voir
  `SUPABASE_SETUP.md` et `lib/cloudSync.js`.
- Génération de plan d'entraînement par IA : **Gemini** (`lib/gemini.js`) et **Groq**
  en secours/co-génération (`lib/groq.js`), orchestrés par `lib/coGeneration.js`.
- Intégration **Strava** (OAuth + sync activités/équipement) : `lib/strava.js`,
  `pages/api/strava/*`, voir `STRAVA_SETUP.md`.
- Historique détaillé des refontes et bugs corrigés : voir `CHANGELOG_REFONTE.md`
  (en français, très détaillé — à lire avant de toucher à la génération de plan, aux
  zones ou à la co-génération).

## 2. Structure des dossiers

- `pages/` — routes Next.js. `pages/index.js` est le point d'entrée principal (SPA à
  onglets : Objectif, Calendrier, Profil, Nutrition, Outils...). `pages/api/` — routes
  serveur (génération de plan, chat coach, nutrition, Strava, suppression de compte).
- `components/` — composants React, un fichier par écran/widget majeur (calendrier,
  dashboard perf, zones, équipement, nutrition, météo/radar, etc.).
- `lib/` — toute la logique métier pure (pas de JSX). C'est ici que vivent les règles
  déterministes (garde-fous sur les plans générés, calculs physio, zones, nutrition,
  périodisation, pression de pneu...).
- `public/` — assets statiques, icônes PWA, photos d'équipement perso.
- `test/` — tests Vitest (actuellement `lib/tirePressure.test.js`,
  `lib/weather.test.js`). Lance-les avec `npm test`.
- Fichiers `supabase-*.sql` à la racine — migrations SQL Supabase, à appliquer dans
  l'ordre chronologique de leur nom si une base est recréée de zéro.

## 3. Règles de logique importantes (à ne pas casser)

Ces règles reviennent souvent dans les commentaires du code et sont des décisions
produit explicites de l'athlète — ne pas les "corriger" sans lui demander :

1. **Ne jamais inventer de valeur physiologique** (`lib/physiology.js`) : une donnée
   physio affichée doit venir soit d'une valeur mesurée déclarée, soit d'un calcul sur
   un chrono réel fourni, soit être explicitement `null`/"non renseigné". Jamais de
   valeur plausible mais fictive.
2. **Co-génération à double IA** (`lib/coGeneration.js`) : chaque séance/plan généré
   passe par Gemini ET Groq, comparés de façon 100% déterministe en JS (pas d'appel IA
   pour arbitrer). Désaccord → 1 régénération complète → toujours désaccord →
   compromis déterministe. Convergence garantie en 2 rounds max.
3. **Garde-fous déterministes sur les séances générées** (`lib/workouts.js`,
   `lib/periodization.js`) : la structure macro (nombre de séances, périodisation,
   volumes planchers/plafonds) est calculée en JS, jamais laissée à l'appréciation de
   l'IA. L'IA reste libre sur le CONTENU (type d'exercice), jamais sur la structure.
2. **Priorité des zones d'intensité** (`lib/zones.js`, `components/ZoneCharts.js`) :
   zones calibrées manuellement par l'athlète > estimation depuis activités Strava
   réelles > calcul théorique depuis FC max/FTP/VMA déclarées. Ne jamais écraser une
   valeur d'un niveau supérieur par un niveau inférieur.
3. **i18n** (`lib/i18n.js`) : seul l'AFFICHAGE est traduit (fr/en/es). Les valeurs
   internes stockées (jours, types de séance, clés de storage) ne changent jamais de
   valeur — uniquement leur rendu via `t()`/`translateX()`.
4. **Sync cloud = snapshot complet** (`lib/cloudSync.js`) : au lieu de synchroniser
   chaque morceau d'état séparément, tout `localStorage` (toutes les `STORAGE_KEYS`)
   est sérialisé en une seule ligne JSON par utilisateur côté Supabase. Ne pas
   réintroduire une sync clé-par-clé sans réviser tout le mécanisme de fusion au login.
5. **Pression de pneu** (`lib/tirePressure.js`) : approximation publique (méthode "tire
   drop", sources Berto/Bicycle Quarterly), PAS une reproduction de l'algorithme
   propriétaire SILCA — à mentionner si le sujet revient.
6. **Secrets Strava** : `STRAVA_CLIENT_SECRET` et les tokens ne doivent jamais
   atteindre le navigateur — tout passe par `pages/api/strava/*` côté serveur.

## 4. Bugs connus / pièges déjà rencontrés

- `components/ZoneCharts.js` a déjà été accidentellement écrasé par une copie de
  `components/PerformanceDashboard.js` (récursion infinie au rendu de l'onglet Profil).
  Si l'onglet Profil crash ou boucle, vérifier que ces deux fichiers ne sont pas
  redevenus identiques.
- Toujours lire `CHANGELOG_REFONTE.md` avant de modifier la génération de plan, les
  zones ou la co-génération : il documente déjà plusieurs allers-retours et pourquoi
  certains choix ont été faits (évite de refaire les mêmes erreurs).

## 5. Avant de committer/déployer

- `npm run lint` et `npm test` si tu touches à `lib/tirePressure.js` ou
  `lib/weather.js` (seuls fichiers avec tests actuellement).
- Mets à jour `CHANGELOG_REFONTE.md` pour tout changement de logique métier
  significatif (génération de plan, zones, nutrition, périodisation) — c'est la
  référence détaillée. Ce fichier `AI_GUIDE.md` reste volontairement plus court : vue
  d'ensemble + journal court, pas le détail de chaque décision.
- N'ajoute pas de fichiers macOS (`.DS_Store`) ni de dossiers `__MACOSX` au dépôt —
  ce sont des artefacts de zip/Finder, aucune utilité pour l'app.

---

## 6. Journal des interventions IA

**Format à respecter (ajoute une ligne, ne réécris jamais les lignes existantes) :**

`- AAAA-MM-JJ — [nom du modèle/outil] — résumé en une phrase de ce qui a été fait/pourquoi`

- 2026-08-28 — Claude (Sonnet 5, claude.ai) — Nettoyage des fichiers `.DS_Store`
  parasites (macOS) à la racine, `pages/`, `pages/api/`, `test/` ; création de ce
  fichier `AI_GUIDE.md` pour orienter les futures IA sur le projet.
