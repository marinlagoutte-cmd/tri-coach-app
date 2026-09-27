# Fond de carte (CARTO) — filigrane "API KEY REQUIRED"

Si les cartes de l'app (onglet Météo > vent/radar pluie, planificateur de
parcours, détail d'activité) affichent un filigrane diagonal
"API KEY REQUIRED — carto.com/basemaps/apikey" par-dessus le fond de carte
sombre : **ce n'est pas un problème avec la météo elle-même** (vent et pluie
viennent d'Open-Meteo et de RainViewer, gratuits et sans clé). C'est CARTO,
le fournisseur du fond de carte (les rues, reliefs, frontières en arrière-plan),
qui exige désormais une clé API gratuite pour ses tuiles — un changement
récent de leur part, pas quelque chose de cassé côté app.

Tant que la clé n'est pas configurée, les cartes restent utilisables mais
avec ce filigrane disgracieux.

## 1. Créer la clé gratuite

1. https://carto.com/basemaps/apikey/ → remplis le formulaire (aucune carte
   bancaire requise).
2. Gratuite jusqu'à 5 millions de requêtes de tuiles par mois — largement
   suffisant pour un usage personnel.

## 2. Ajouter la variable dans Vercel

Vercel → ton projet → **Settings → Environment Variables** :

| Nom | Valeur |
|---|---|
| `NEXT_PUBLIC_CARTO_API_KEY` | la clé reçue à l'étape 1 |

`NEXT_PUBLIC_` est nécessaire ici (pas un choix) : Leaflet charge les tuiles
directement depuis le navigateur, donc la clé doit être présente dans le
bundle client — ce n'est pas une donnée secrète au sens habituel, CARTO la
protège plutôt par quota et par domaine référent.

Redéploie une fois la variable ajoutée. Le filigrane disparaît immédiatement
sur les cartes suivantes (un force-refresh peut être nécessaire si une
ancienne tuile est encore en cache navigateur).

## Bon à savoir

- La logique est centralisée dans `lib/mapTiles.js` (utilisé par
  `RoutePlannerMap.js`, `ActivityDetail.js`, `WeatherRadarMap.js`) : rien
  d'autre à modifier une fois la clé ajoutée.
- Sans clé configurée, l'onglet Météo affiche un petit avertissement au-dessus
  de la carte pour le rappeler.
