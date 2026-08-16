import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { geocodeCity, reverseGeocode, fetchCurrentWeather } from '../../lib/weather';

// Simple fetch mocking helper
function mockFetch(responseObj) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => responseObj });
}

describe('lib/weather utilities', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetAllMocks();
  });

  it('geocodeCity should parse results', async () => {
    const fake = { results: [{ id: 1, name: 'Paris', country: 'France', admin1: 'Île-de-France', latitude: 48.8566, longitude: 2.3522 }] };
    global.fetch = mockFetch(fake);
    const res = await geocodeCity('Paris');
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe('Paris');
    expect(global.fetch).toHaveBeenCalled();
  });

  it('reverseGeocode should return single place or null', async () => {
    const fake = { results: [{ id: 2, name: 'Local', country: 'FR', admin1: 'X', latitude: 1, longitude: 2 }] };
    global.fetch = mockFetch(fake);
    const res = await reverseGeocode(1, 2);
    expect(res).toBeTruthy();
    expect(res.name).toBe('Local');
  });

  it('fetchCurrentWeather should return data structure', async () => {
    const fake = { current_weather: { temperature: 10, windspeed: 5, winddirection: 120, time: '2026-01-01T12:00' }, daily: { time: ['2026-01-01'], temperature_2m_max: [12], temperature_2m_min: [4] } };
    global.fetch = mockFetch(fake);
    const res = await fetchCurrentWeather(48.8, 2.3, 3);
    expect(res.current_weather).toBeDefined();
    expect(res.daily).toBeDefined();
  });
});
