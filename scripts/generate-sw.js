// scripts/generate-sw.js
//
// Génère public/sw.js à partir de public/sw-template.js en remplaçant
// __BUILD_ID__ par un identifiant unique de ce build précis.
//
// Pourquoi : le Service Worker versionne son cache avec cet identifiant
// (voir sw-template.js). Tant que l'identifiant ne change pas à chaque
// déploiement, un navigateur peut se retrouver après un déploiement avec une
// page qui référence les fichiers JS/CSS hashés de l'ANCIEN build, alors que
// ces fichiers n'existent plus côté serveur — le CSS ne charge jamais et
// l'app s'affiche sans aucune mise en forme.
//
// Lancé automatiquement avant chaque build/dev (voir "prebuild"/"predev"
// dans package.json), donc à chaque déploiement Vercel.
const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, '..', 'public', 'sw-template.js');
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'sw.js');

// Sur Vercel, VERCEL_GIT_COMMIT_SHA identifie précisément le commit déployé —
// un vrai nouvel identifiant à CHAQUE déploiement. En local (ou si absent),
// on retombe sur un timestamp : suffisant pour le développement, où le SW
// n'est de toute façon jamais enregistré (voir lib/registerServiceWorker.js).
const buildId = process.env.VERCEL_GIT_COMMIT_SHA || `local-${Date.now()}`;

const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
const output = template.replace('__BUILD_ID__', buildId);

fs.writeFileSync(OUTPUT_PATH, output);
console.log(`[generate-sw] public/sw.js généré avec CACHE_VERSION = ${buildId}`);
