import { describe, it, expect } from 'vitest';
import { parseScopes, hasProfileScope } from '../lib/stravaScope';

describe('autorisations Strava', () => {
  it('ton cas réel : séparées par des espaces → profile:read_all bien reconnue', () => {
    expect(hasProfileScope('activity:read_all profile:read_all read')).toBe(true);
  });
  it('séparées par des virgules (adresse de retour Strava)', () => {
    expect(parseScopes('read,activity:read_all,profile:read_all')).toEqual(['read', 'activity:read_all', 'profile:read_all']);
    expect(hasProfileScope('read,activity:read_all')).toBe(false);
    expect(hasProfileScope(null)).toBe(false);
  });
});
