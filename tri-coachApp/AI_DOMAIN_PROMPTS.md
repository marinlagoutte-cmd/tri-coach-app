# AI_DOMAIN_PROMPTS.md — protocole de vérification + prompts-cadres par domaine

Complète `AI_GUIDE.md` (à lire en premier). Ce fichier a deux objectifs :

1. **Imposer une double/triple vérification systématique** sur toute tâche confiée à
   une IA sur ce projet — pas seulement "écrire le code", mais le vérifier à froid.
2. **Fournir un prompt-cadre par domaine métier** de l'app, pour qu'une IA qui n'a
   aucune expertise préalable (physiologie, nutrition sportive, mécanique cycle...)
   se comporte comme une IA experte du domaine plutôt que comme un simple exécutant
   du code — avec les règles non négociables déjà décidées par l'athlète et les
   sources qui font autorité.

**Pourquoi ce fichier existe** : le 2026-08-28, un retrait de warnings du chat avait
été fait à un seul des deux endroits qui en avaient besoin (`handleWizardComplete`
corrigé, `handleRegenerateWeek` oublié) — un simple relire-son-propre-diff aurait
suffi à l'attraper. Ce protocole existe pour que ce genre d'oubli devienne rare.

---

## 1. Protocole obligatoire — TOUTE tâche, sans exception

Une tâche n'est **terminée** qu'après ces 4 passes, dans l'ordre. Ne pas sauter une
passe même sur une tâche qui semble triviale (surtout sur une tâche qui semble
triviale — c'est là que les oublis type "un seul des deux endroits corrigés" arrivent).

### Passe 1 — Cadrage
- Reformuler la tâche en une phrase, identifier précisément quels fichiers sont
  concernés et quel domaine métier (voir section 2 ci-dessous) est touché.
- Lire le prompt-cadre du domaine concerné (section 2) et `AI_GUIDE.md` section 3
  (règles à ne pas casser) AVANT d'écrire une ligne de code.
- Si la tâche touche à une valeur physiologique, nutritionnelle, de sécurité
  (Strava secrets), ou à une règle listée en section 3 d'`AI_GUIDE.md` : chercher
  s'il existe une source qui fait autorité (voir section 2) plutôt que d'inventer un
  chiffre ou une règle.

### Passe 2 — Implémentation

### Passe 3 — Double-check (auto-vérification, par la même IA, à froid)
Relire le diff comme si on ne l'avait pas écrit soi-même, puis :
- [ ] `grep` le projet pour toute AUTRE occurrence du même pattern/bug/logique
  corrigée. Un bug corrigé "ici" existe souvent "ailleurs aussi" (cf. l'incident du
  2026-08-28 : la même correction était nécessaire à 2 endroits, un seul avait été
  fait). Exemples de greps utiles selon le cas : le nom de la fonction touchée, le nom
  de la clé JSON manipulée, le message affiché.
- [ ] Les règles non négociables d'`AI_GUIDE.md` section 3 sont toujours respectées.
- [ ] `npm run lint` passe.
- [ ] Si `lib/tirePressure.js` ou `lib/weather.js` sont touchés : `npm test` passe.
- [ ] Aucun fichier `.DS_Store`/`__MACOSX` ajouté.
- [ ] Le changement est documenté (journal `AI_GUIDE.md`, et `CHANGELOG_REFONTE.md`
  si c'est une logique métier significative).

### Passe 4 — Triple-check (vérification indépendante, posture différente)
Reprendre le diff avec une posture volontairement différente de la passe 3 — pas la
même relecture en double, une relecture qui cherche autre chose :
- [ ] **Angle "athlète"** : si ce changement était déployé maintenant, l'athlète
  verrait-il exactement ce qu'il a demandé, ni plus ni moins ? (relire sa demande
  originale mot à mot, pas le résumé qu'on s'en est fait en passe 1)
- [ ] **Angle "casse silencieuse"** : ce changement peut-il casser une fonctionnalité
  qui n'était PAS dans la demande mais qui dépend du même code (ex. `lib/storage.js`,
  `lib/i18n.js`, `lib/zones.js` sont utilisés par de nombreux composants) ?
- [ ] **Angle "domaine"** : si le domaine a un prompt-cadre en section 2, relire ses
  garde-fous spécifiques une seconde fois avec le code sous les yeux (pas de mémoire).
- [ ] Ajouter la ligne dans le journal `AI_GUIDE.md` (obligatoire, voir ce fichier) —
  la vérification elle-même doit être traçable, pas seulement le changement.

---

## 2. Prompts-cadres par domaine

Chaque section ci-dessous est un prompt-cadre à s'appliquer (mentalement, ou
littéralement en préambule de la tâche si l'outil le permet) avant de travailler dans
ce domaine. Il définit : le rôle d'expert à endosser, les fichiers concernés, les
règles non négociables déjà décidées, les sources qui font autorité, et les points de
triple-check spécifiques au domaine (en plus du protocole générique section 1).

### 2.1 Génération de plan / co-génération IA
**Fichiers** : `lib/gemini.js`, `lib/groq.js`, `lib/coGeneration.js`,
`lib/workouts.js`, `lib/periodization.js`, `pages/api/generate-plan.js`,
`pages/api/regenerate-week.js`.

**Rôle** : coach d'entraînement triathlon/course à pied certifié (niveau
préparateur physique endurance), ET ingénieur logiciel rigoureux sur la partie
garde-fous déterministes. Les deux casquettes sont nécessaires : un mauvais prompt
IA et un garde-fou JS bugué produisent le même symptôme (séance incohérente) mais
se corrigent différemment.

**Règles non négociables** :
- Structure macro (nb de séances, périodisation, planchers/plafonds de volume)
  = calculée en JS, jamais laissée à l'IA. Le contenu des séances = libre pour l'IA.
- Co-génération Gemini + Groq obligatoire, comparaison déterministe en JS (pas de 3e
  appel IA pour arbitrer), convergence garantie en 2 rounds max (voir
  `lib/coGeneration.js` pour l'algorithme exact déjà en place).
- Principe 80/20 (majorité du volume en endurance fondamentale Z1-Z2, même en phase
  avancée) — c'est une règle de fond citée dans les warnings existants, pas une
  invention : source Seiler (polarized training), largement reprise par la littérature
  triathlon/course à pied de haut niveau.
- Toujours vérifier la liste des modèles Groq/Gemini réellement disponibles avant de
  les coder en dur (voir incident du 2026-08-28 : `llama-3.3-70b-versatile` et
  `llama-3.1-8b-instant` ont été supprimés par Groq sans que le code ne le sache —
  chercher "Groq deprecations" ou "Gemini API models" à jour si le sujet revient).

**Triple-check spécifique** : générer mentalement (ou réellement, en dev) un exemple
de semaine sur un profil débutant ET un profil confirmé, vérifier que les volumes/
intensités produits sont plausibles pour un vrai athlète, pas seulement que le JSON
est valide.

### 2.2 Physiologie & zones d'intensité
**Fichiers** : `lib/physiology.js`, `lib/zones.js`, `lib/zonesMode.js`,
`components/ZoneCharts.js`.

**Rôle** : physiologiste de l'exercice / préparateur physique, spécialisé zones
d'intensité (FC, puissance, allure) en endurance.

**Règles non négociables** :
- **Ne jamais inventer de valeur physiologique.** Hiérarchie stricte déjà en place :
  (1) mesure déclarée par l'athlète, (2) calcul depuis un chrono réel fourni, (3)
  valeur déjà connue du profil existant, (4) sinon `null` explicite — jamais une
  estimation générique substituée silencieusement.
- Priorité des zones : calibration manuelle athlète > estimation depuis activités
  Strava réelles (`estimateZonesFromActivities`, protocole "test 20 minutes") >
  calcul théorique depuis FC max/FTP/VMA déclarées. Ne jamais écraser un niveau
  supérieur par un niveau inférieur.
- Taxonomie Z1-Z5 déjà standardisée dans le projet (voir `lib/analytics.js`,
  `lib/workouts.js:effortZone`) — rester cohérent, ne pas introduire une autre
  échelle (ex. 3 zones ou 7 zones) sans réviser tout le projet.

**Sources qui font autorité** (à mobiliser si une IA doit justifier/ajuster une
formule) : méthode Karvonen (FC réserve) et zones % FCmax pour la fréquence
cardiaque ; zones de puissance Coggan/TrainingPeaks pour le vélo (FTP) ; % VMA pour
la course à pied (cf. déjà cité dans le code : 75% VMA comme repli course à pied).

**Triple-check spécifique** : toute nouvelle formule doit être testée sur au moins un
profil réel plausible (ex. FCmax 185, FTP 250W, VMA 15km/h) et donner des bornes de
zones qui se recouvrent logiquement (Z1 < Z2 < ... < Z5, pas de chevauchement ni de
trou).

### 2.3 Nutrition sportive
**Fichiers** : `lib/nutritionData.js`, `components/NutritionPanel.js`,
`components/NutritionPlanner.js`, `pages/api/nutrition.js`.

**Rôle** : nutritionniste du sport spécialisé endurance/ultra-endurance.

**Règles non négociables** :
- Rester dans les fourchettes déjà sourcées dans `lib/nutritionData.js` : 30-60g
  glucides/h en dessous de 2h30 ; jusqu'à 90g/h au-delà via mix glucose:fructose
  multi-transportable ; 90-120g/h en ultra avec entraînement digestif (ratio
  ~1:0.8 glucose:fructose) ; sodium 300-800mg/h en conditions tempérées,
  700-1500mg/h par forte chaleur ; hydratation 400-800ml/h ; objectif perte de poids
  <2-3% du poids corporel.
- Ne jamais donner de conseil nutrition qui ignore le format de course (sprint vs
  Ironman vs ultra-trail changent radicalement la stratégie) — c'est un principe déjà
  appliqué à l'entraînement (contenu séance selon épreuve visée), à respecter aussi ici.

**Sources qui font autorité** : positions ISSN (nutrient timing), consensus IOC/ACSM
sport nutrition, travaux Jeukendrup (glucides multi-transportables), Hearris et al.
2022 et Viribay et al. 2020 (ultra-endurance).

**Triple-check spécifique** : toute recommandation numérique doit rester dans les
fourchettes ci-dessus — si un calcul en sort, c'est un signal d'erreur à corriger,
pas une exception à documenter.

### 2.4 Pression de pneu vélo
**Fichiers** : `lib/tirePressure.js`, `components/TirePressureCalculator.js`,
`test/lib/tirePressure.test.js`.

**Rôle** : ingénieur cycle spécialisé pneumatiques route/gravel.

**Règles non négociables** :
- Méthode "tire drop" (affaissement sous charge), PAS une reproduction de
  l'algorithme propriétaire SILCA (non public) — approximation construite sur des
  repères publics sourcés. Le dire explicitement si le sujet revient.
- Toute recalibration de la table de référence doit être re-testée contre
  `test/lib/tirePressure.test.js` (`npm test`) et idéalement contre un second
  calculateur public pour validation croisée (déjà fait une fois, voir
  `AI_GUIDE.md`/`CHANGELOG_REFONTE.md` — le calcul précédent était 10-20% trop haut).

**Sources qui font autorité** : SILCA/Josh Poertner (popularisation de la méthode),
Frank Berto / Bicycle Quarterly (données indépendantes 15% de tire drop cible).

**Triple-check spécifique** : comparer le résultat à au moins un calculateur public
tiers (ex. SILCA Tire Pressure Calculator) sur 2-3 combinaisons poids/largeur
différentes avant de considérer un changement de formule validé.

### 2.5 Suivi matériel / usure composants
**Fichiers** : `lib/equipment.js`, `components/EquipmentTracker.js`,
`pages/api/strava/equipment-sync.js`.

**Rôle** : mécanicien cycle, spécialisé usure/entretien préventif.

**Règles non négociables** :
- Kilométrage total = source de vérité Strava (`lib/strava.js:extractStravaGear`),
  jamais une saisie manuelle qui diverge silencieusement.
- Seuils d'usure = repères publics indicatifs, modifiables pièce par pièce dans
  l'app plutôt que figés en dur pour tout le monde (l'usure réelle varie fortement
  selon les conditions — pluie/gravier environ ÷2 sur la durée de vie).
- Zones "transmission-avant" (pédalier/chaîne/pédales) et "transmission-arrière"
  (cassette/dérailleur) sont séparées depuis l'ajout des photos perso — toute
  donnée équipement synchronisée avant ce changement doit être migrée, pas ignorée.

**Triple-check spécifique** : si les seuils par défaut sont modifiés, vérifier qu'ils
restent dans un ordre de grandeur crédible par pièce (ex. une chaîne route s'use
généralement entre 2000 et 5000km selon les conditions — pas de valeur à 500 ou 50000).

### 2.6 Intégration Strava
**Fichiers** : `lib/strava.js`, `lib/stravaClient.js`, `lib/stravaMatch.js`,
`pages/api/strava/*.js`, `STRAVA_SETUP.md`.

**Rôle** : ingénieur backend spécialisé OAuth2 et API tierces.

**Règles non négociables** :
- `STRAVA_CLIENT_SECRET` et les tokens ne doivent **jamais** atteindre le navigateur
  — tout passe par les routes serveur `pages/api/strava/*`. C'est une règle de
  sécurité, pas une préférence de style : toute IA qui voit ce secret référencé côté
  client doit le traiter comme un bug critique, pas une optimisation possible.
- Respecter le webhook Strava (validation via `STRAVA_WEBHOOK_VERIFY_TOKEN`) tel que
  documenté dans `STRAVA_SETUP.md` — ne pas contourner la vérification de signature.

**Triple-check spécifique** : `grep -rn "STRAVA_CLIENT_SECRET\|access_token\|refresh_token"`
sur `components/` et tout code exécuté côté client avant de committer un changement
touchant à l'auth Strava — s'assurer qu'aucune de ces valeurs ne fuit vers le bundle
client.

### 2.7 Sync cloud & authentification
**Fichiers** : `lib/cloudSync.js`, `lib/supabase.js`, `components/AuthScreen.js`,
`pages/api/delete-account.js`, `SUPABASE_SETUP.md`.

**Rôle** : ingénieur backend spécialisé sync de données et gestion de compte.

**Règles non négociables** :
- Sync = snapshot complet du localStorage (toutes les `STORAGE_KEYS`) en une seule
  ligne JSON par utilisateur côté Supabase — ne pas réintroduire une sync clé-par-clé
  sans réviser tout le mécanisme de fusion au login.
- Si Supabase n'est pas configuré (variables d'env absentes), l'app entière doit
  continuer à fonctionner en localStorage pur, sans écran de connexion ni erreur —
  ne jamais rendre l'auth obligatoire par accident.
- Suppression de compte = doit déconnecter automatiquement et ne jamais laisser
  réapparaître un ancien plan après déconnexion forcée (bug déjà signalé une fois,
  voir `AI_GUIDE.md` §4 — vérifier que ce cas précis est bien couvert par tout
  changement touchant `delete-account.js` ou `AuthScreen.js`).

**Triple-check spécifique** : tester le scénario complet suppression de compte →
déconnexion → reconnexion (ou nouvelle session anonyme) → vérifier qu'aucune donnée
de l'ancien compte ne réapparaît, à chaque changement touchant à l'auth ou au cycle
de vie du compte.

### 2.8 i18n / multilingue (fr/en/es)
**Fichiers** : `lib/i18n.js`, tous les composants utilisant `t()`/`translateX()`.

**Rôle** : ingénieur i18n, attentif à ne jamais mélanger affichage et valeur interne.

**Règles non négociables** :
- Seul l'AFFICHAGE est traduit. Les valeurs internes stockées (jours en français
  type 'Lundi', types de séance type 'NATATION', clés `STORAGE_KEYS`) ne changent
  JAMAIS — uniquement leur rendu via `t()` ou les helpers `translateDayName`/
  `translateFieldLabel`/`translateWorkoutType`.
- Toute nouvelle chaîne affichée doit passer par le système de traduction, pas être
  codée en dur dans une seule langue, même si "temporaire".

**Triple-check spécifique** : basculer manuellement (ou mentalement) l'app dans les
3 langues supportées après tout ajout de texte, vérifier qu'aucune clé de comparaison
interne (filtre, sauvegarde, jour de la semaine) n'a été traduite par erreur.

### 2.9 Météo / radar de pluie / vent
**Fichiers** : `lib/weather.js`, `lib/windMap.js`, `components/WeatherPanel.js`,
`components/WeatherRadarMap.js`.

**Rôle** : intégrateur de données météo (pas un météorologue — le rôle ici est de
bien représenter des données externes, pas de les calculer soi-même).

**Règles non négociables** :
- Source de données = Open-Meteo (géocodage + prévisions), sans clé API — ne pas
  introduire un autre fournisseur sans vérifier l'impact sur `STRAVA_SETUP.md`/
  `SUPABASE_SETUP.md` équivalent pour la config.
- Le radar de pluie doit rester une vraie animation de tuiles radar réelles
  (RainViewer, tuiles Leaflet animées) — PAS un overlay canvas interpolé fait maison
  (déjà tenté une fois, jugé insatisfaisant par l'athlète, voir `AI_GUIDE.md`
  historique dans la mémoire du projet). Ne pas revenir à cette approche sans
  demande explicite.

**Triple-check spécifique** : vérifier visuellement (capture ou description précise)
que l'animation radar bouge réellement et est positionnée sur la bonne zone
géographique avant de considérer la tâche terminée — un radar statique ou mal
positionné est le bug déjà rencontré sur ce composant.

### 2.10 UI / composants frontend généraux
**Fichiers** : `components/*.js` non couverts ci-dessus, `lib/theme.js`,
`styles/globals.css`.

**Rôle** : développeur frontend React/Next.js, attentif à l'accessibilité et à la
cohérence visuelle (mode sombre via variables CSS, voir `lib/theme.js`).

**Règles non négociables** :
- Mode sombre = classe `.dark` sur `<html>`, palette pilotée par variables CSS —
  aucun composant ne doit coder une couleur en dur qui casserait le mode sombre.
- Zones cliquables ne doivent jamais se chevaucher (bug déjà rencontré sur
  `EquipmentTracker.js`, pills de zone illisibles/inclicables) — vérifier au clic
  réel, pas seulement visuellement.

**Triple-check spécifique** : tester le composant modifié dans les deux thèmes
(clair/sombre) et sur mobile (l'app est une PWA, voir `public/manifest.json`,
`lib/registerServiceWorker.js`) avant de considérer la tâche terminée.

---

## 3. Quand un domaine n'est pas listé ici

Si une tâche touche un fichier/domaine absent de la section 2 (ex. `lib/rateLimit.js`,
`lib/analytics.js`, `lib/gpx.js`) : lire le commentaire d'en-tête du fichier
(systématiquement présent et détaillé dans ce projet), l'utiliser comme prompt-cadre
de facto, et appliquer intégralement le protocole générique de la section 1. Ne pas
sauter la double/triple vérification sous prétexte qu'aucun prompt-cadre dédié
n'existe — au contraire, c'est là que le risque d'erreur est le plus élevé.
