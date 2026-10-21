# Saison 2027 — plan complet + guide dans l'app (21/10/2026)

> Plan v3 (21/10) : montée en charge du bloc ultra lissée (course + marche +1,5 h/sem. au plus, pic ≈ 9,5 h hors stage,
> stage ≈ 15 h de trail), vélo ≥ 3 h et 3 nages gardés chaque semaine, D+ à Bordeaux sur les coteaux de la rive droite
> (Lormont, Cenon, Floirac, Bouliac) ou au tapis — jamais la dune —, week-ends d'hiver plafonnés à ~6 h 15
> (vélo long / trail long en alternance), 3e semaine de charge sous condition (VFC, sommeil, RPE).

## À faire

1. Remplacer le dossier `tri-coachApp/` du repo par celui-ci (repo complet : tous les fichiers, modifiés ou non).
2. `npm test` (237 tests), puis déployer.
3. Dans l'app : **Réglages → Plan de saison → Importer un autre plan** → `plans/plan-marin-saison-2027-v2.json`.
   La semaine en cours (19-25/10) est remplacée elle aussi (`meta.replaceCurrentWeek`).

## Ce qui arrive dans l'app

- **518 séances datées** du 19/10/2026 au 05/09/2027 (DK1 → S41) : créneau (Matin / Midi / Soir…),
  code de bibliothèque (N1, V1, C9, R2…), consigne du jour, feuille Échauffement / Corps / Retour au calme,
  objectif, version tapis, points d'attention, D+, distance de nage. Lundi off, muscu toujours le soir.
- **Renfo** : nouveau type `RENFO` (icône renforcement), jamais classé en course ni en vélo.
- **Guide de la saison** (onglet Objectif + action rapide « Guide saison ») : tout le PDF — l'essentiel,
  calendrier, repères (zones, allures, tapis, tests), organisation de la semaine, volume semaine par semaine
  (graphique + liste, semaine en cours mise en avant), bibliothèque des 41 séances types, fiches courses,
  fiche Échappée Belle, nutrition, matériel, règlement FFTri, pilotage, sources. Recherche plein texte.
- **Calendrier de courses** : les 9 courses du plan y sont ajoutées (priorités A/B/C), chacune avec sa fiche.
- **Bandeau de semaine** (Calendrier) : repère (DK2, S12…), nature, phase, objectif et notes de la semaine.

## Changements de code

| Fichier | Changement |
|---|---|
| `lib/seasonImport.js` | lit `races`, `guide`, `meta.replaceCurrentWeek` et les champs de semaine (`code`, `focus`, `notes`, `dplus`) ; `mergeSeasonRaces` / `removeSeasonRaces` |
| `lib/workouts.js` | `isSeasonPlanSession` : les garde-fous IA ne réécrivent plus une séance du plan non retouchée (intention de nage au RPE, footing au cardio, renfo) ; `scaleSeasonWatts` : « Actualiser les séances » recalcule les watts sur la FTP du profil (référence `refFtp` = 360 W) |
| `lib/planSchema.js` | `RENFO` ajouté aux types (le coach peut conserver ces séances quand il ajuste une semaine) |
| `components/SeasonGuide.js` | nouveau : rendu du guide (sections, tableaux, fiches clé/valeur, cartes de séances, graphique de volume, liste des semaines, recherche) |
| `components/WorkoutDetail.js` | créneau + code dans l'en-tête, objectif, D+ / distance / optionnelle, bloc « Retour au calme », version tapis, « À retenir » |
| `components/CalendarView.js`, `components/TodayView.js` | créneau sur les vignettes (et D+ au calendrier) |
| `components/RaceCalendar.js` | fiche dépliable des courses du plan |
| `components/ui/QuickActions.js` | action « Guide saison » (visible si le plan importé contient un guide) |
| `components/SettingsModal.js` | texte de l'import mis à jour |
| `pages/index.js` | import (courses → calendrier, remplacement de la semaine en cours), retrait du plan, guide dans l'onglet Objectif, bandeau de semaine |
| `test/seasonGuideImport.test.js` | 13 tests : lecture du plan réel, règles (nage ≥ 2 500 m, 1 nage/jour, RPE ; récup vélo ; renfo le soir ; lundi off), garde-fous, watts, courses, guide |
| `plans/plan-marin-saison-2027-v2.json` | le plan (format `tri-coach-season-plan` v1 + `races` + `guide`) |
