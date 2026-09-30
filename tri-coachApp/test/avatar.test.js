import { describe, it, expect, vi } from 'vitest';
vi.mock('../lib/strava', () => ({ ensureValidStravaToken: vi.fn() }));
vi.mock('../lib/athleteContext', () => ({ getAdminClient: vi.fn() }));
const { initialsOf } = await import('../lib/avatar');
const { usableStravaPhoto } = await import('../pages/api/strava/athlete-photo');

describe('photo de profil', () => {
  it('initiales de repli', () => {
    expect(initialsOf('Marin')).toBe('M');
    expect(initialsOf('Marin Lagoutte')).toBe('ML');
    expect(initialsOf('marin.lagoutte@mail.fr')).toBe('ML');
    expect(initialsOf('')).toBe('');
  });
  it('photo Strava : URL réelle retenue, image par défaut « sans photo » ignorée', () => {
    expect(usableStravaPhoto({ profile: 'https://dgalywyr863hv.cloudfront.net/pictures/athletes/1/2/large.jpg' })).toMatch(/^https:/);
    expect(usableStravaPhoto({ profile: 'avatar/athlete/large.png' })).toBeNull();
    expect(usableStravaPhoto({})).toBeNull();
  });
});
