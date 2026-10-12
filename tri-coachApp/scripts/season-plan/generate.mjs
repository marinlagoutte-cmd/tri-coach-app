// Génère plans/plan-marin-2026-2027.json : node scripts/season-plan/generate.mjs
import { writeFileSync } from 'fs';
import { generateSeasonPlan } from './generator.js';
import { MARIN_2026_2027 } from './config-marin-2026-2027.js';

const plan = generateSeasonPlan(MARIN_2026_2027);
writeFileSync('plans/plan-marin-2026-2027.json', `${JSON.stringify(plan, null, 2)}\n`);
console.log(`${plan.weeks.length} semaines, ${plan.weeks.reduce((n, w) => n + w.sessions.length, 0)} séances.`);
