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
