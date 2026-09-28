import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { GLOSSARY, TOUR_STEPS, TAB_TIPS, FAQ, glossaryEntry } from '../lib/helpContent';

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

describe('contenu de l\'aide', () => {
  it('chaque bulle « ? » du code pointe vers un terme du lexique', () => {
    const files = [...filesUnder('components'), 'pages/index.js'].filter((f) => f.endsWith('.js'));
    const ids = files.flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/<InfoTip id="([^"]+)"/g)].map((m) => m[1]));
    expect(ids.length).toBeGreaterThan(10);
    ids.forEach((id) => expect(glossaryEntry(id), id).not.toBeNull());
  });
  it('lexique : ids uniques, définitions non vides', () => {
    expect(new Set(GLOSSARY.map((g) => g.id)).size).toBe(GLOSSARY.length);
    GLOSSARY.forEach((g) => expect(g.text.length, g.id).toBeGreaterThan(40));
  });
  it('une astuce pour chaque onglet de la navigation et pour le Profil (ouvert par la photo)', () => {
    const src = fs.readFileSync('pages/index.js', 'utf8');
    const tabs = [...src.slice(src.indexOf('const TABS = ['), src.indexOf('];', src.indexOf('const TABS = ['))).matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
    expect(tabs).toHaveLength(5);
    expect(tabs).not.toContain('profile');
    [...tabs, 'profile'].forEach((t) => expect(TAB_TIPS[t], t).toBeTruthy());
    expect(TAB_TIPS.profile).toContain('ta photo en haut à droite');
  });
  it('visite guidée : étapes uniques, texte court (lisible sur téléphone)', () => {
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
    TOUR_STEPS.forEach((s) => expect(s.text.length, s.id).toBeLessThan(330));
    expect(FAQ.length).toBeGreaterThanOrEqual(8);
  });
  it('les exemples chiffrés du lexique sont justes', () => {
    // CSS : (6'20 − 2'55) ÷ 2 = (380 − 175) ÷ 2 = 102,5 s ≈ 1'42 /100 m
    expect(Math.floor((380 - 175) / 2)).toBe(102);
    expect(glossaryEntry('css').text).toContain("1'42");
    // VMA : 1 700 m en 6 min → 17 km/h
    expect(1700 / 100).toBe(17);
    expect(glossaryEntry('forme').text).toContain('42 derniers jours');
  });
});
