# Changelog — 8 points demandés (2026-09)

## Priorité 1

### 1. Courbe de puissance / Records personnels
- `lib/powerCurve.js` (nouveau)
- `pages/api/strava/power-curve.js` (nouveau)
- `components/PerformanceRecords.js` (nouveau)
- `pages/index.js` (nouvel onglet Outils > Records)
- `lib/i18n.js` (libellé de l'onglet)

### 2. Prédicteur de temps de course
- `lib/racePredictor.js` (nouveau)
- `components/RaceTimePredictor.js` (nouveau)
- `lib/physiology.js` (export de `runningDistanceFromWizard`)
- `pages/index.js` (affiché dans l'onglet Objectif)

## Priorité 2

### 3. Récupération auto (HRV/sommeil) — Whoop/Oura
- `supabase-schema-wearables.sql`, `WEARABLES_SETUP.md` (nouveaux)
- `lib/wearablesClient.js`, `lib/wearablesServer.js` (nouveaux)
- `pages/api/wearables/{callback,status,disconnect,sync}.js` (nouveaux)
- `lib/defaults.js` (+`sleepHours`), `lib/feedback.js` (+`summarizeSleepTrend`)
- `components/ProfileHealth.js` (UI connexion/sync), `pages/index.js` (prop `session`)
- Garmin volontairement non implémenté (OAuth 1.0a + accord partenaire requis) — voir le
  commentaire d'en-tête de `lib/wearablesServer.js` et `WEARABLES_SETUP.md`.

### 4. Renforcement musculaire / PPG
- `components/WizardModal.js` (case à cocher `ppgEnabled`)
- `pages/index.js` (`constraints.ppgEnabled`)
- `lib/gemini.js` (bloc `ppgBlock` injecté dans les 3 générations IA)

### 5. Journal de douleurs/blessures
- `lib/storage.js` (+`STORAGE_KEYS.injuryLog`)
- `components/InjuryJournal.js` (nouveau)
- `lib/gemini.js` (`buildInjuryBlock`, injecté partout)
- `pages/api/generate-plan.js`, `pages/api/chat.js`, `pages/api/regenerate-week.js`,
  `pages/index.js` (propagation `injuryLog`)

### 6. Coût du matériel dans le suivi d'usure
- `supabase-migration-cost-2026-08.sql` (nouveau, colonne `cost_eur`)
- `lib/equipment.js` (coûts par défaut + backfill)
- `components/EquipmentTracker.js` (champ coût éditable + budget prévisionnel par pièce,
  dérivé du rythme d'usage réel Strava par `gear_id`)

### 7. Calendrier de courses multi-saisons
- `lib/storage.js` (+`STORAGE_KEYS.raceCalendar`)
- `lib/periodization.js` (`computeMultiRacePeriodization`, `summarizeUpcomingRaces`,
  phase `recovery`)
- `components/RaceCalendar.js` (nouveau — CRUD échéances A/B/C + timeline calculée)
- `lib/gemini.js` (`buildRaceCalendarBlock`, injecté partout)
- `pages/index.js`, `pages/api/generate-plan.js`, `pages/api/chat.js`,
  `pages/api/regenerate-week.js` (propagation `raceCalendar`)

### 8. Suivi du cycle menstruel (opt-in)
- `lib/storage.js` (+`STORAGE_KEYS.menstrualCycle`)
- `lib/cycleTracking.js` (nouveau — calcul de phase, jamais actif sans opt-in explicite)
- `components/CycleTracker.js` (nouveau)
- `lib/gemini.js` (`buildCyclePhaseBlock`, injecté partout — vide si non activé)
- `pages/index.js`, `pages/api/generate-plan.js`, `pages/api/chat.js`,
  `pages/api/regenerate-week.js` (propagation `menstrualCycle`)

## Migrations Supabase à exécuter (SQL Editor → New query → Run)
1. `supabase-schema-wearables.sql` (Point 3)
2. `supabase-migration-cost-2026-08.sql` (Point 6)

## Limites connues / suites possibles
- **Point 3** : pas de synchronisation automatique en tâche de fond (bouton manuel) ;
  Garmin non couvert (voir `WEARABLES_SETUP.md`).
- **Point 7** : le calendrier multi-courses influence le prompt IA (info + mini-affûtage
  anticipé) mais ne pilote pas encore *entièrement* la génération du plan complet
  semaine par semaine sur tout l'horizon — c'est une base solide, une intégration plus
  profonde dans `lib/gemini.js` (génération multi-blocs) est un chantier suivant possible.
- **Point 1** : la courbe de puissance ne couvre que les sorties dont les streams sont mis
  en cache (backfill borné à 12 activités par actualisation, pour ménager le quota Strava).
