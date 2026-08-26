import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  geocodeCity,
  reverseGeocode,
  fetchCurrentWeather,
  fetchCurrentConditions,
  computeHeatPaceAdjustment,
  applyPaceAdjustment,
  applyPowerAdjustment,
} from '../../lib/weather';

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

  it('fetchCurrentConditions should pick the hourly humidity closest to current_weather.time', async () => {
    const fake = {
      current_weather: { temperature: 28, windspeed: 5, winddirection: 120, time: '2026-07-01T14:00' },
      hourly: {
        time: ['2026-07-01T13:00', '2026-07-01T14:00', '2026-07-01T15:00'],
        relativehumidity_2m: [55, 70, 60],
      },
    };
    global.fetch = mockFetch(fake);
    const res = await fetchCurrentConditions(48.8, 2.3);
    expect(res.tempC).toBe(28);
    expect(res.humidityPct).toBe(70);
  });

  it('fetchCurrentConditions should return nulls gracefully when data is missing', async () => {
    global.fetch = mockFetch({ current_weather: {} });
    const res = await fetchCurrentConditions(48.8, 2.3);
    expect(res.tempC).toBeNull();
    expect(res.humidityPct).toBeNull();
  });
});

describe('lib/weather EnviroNorm-style heat adjustment', () => {
  it('does not adjust below the heat threshold', () => {
    const res = computeHeatPaceAdjustment(14, 80);
    expect(res.active).toBe(false);
    expect(res.pct).toBe(0);
  });

  it('applies a moderate adjustment in mild heat', () => {
    const res = computeHeatPaceAdjustment(22, 50);
    expect(res.active).toBe(true);
    expect(res.level).toBe('moderate');
    expect(res.pct).toBe(0.02);
  });

  it('amplifies the adjustment when humidity is high on top of heat', () => {
    const res = computeHeatPaceAdjustment(27, 80);
    expect(res.active).toBe(true);
    // 0.05 (>=25°C) + 0.02 (>=75% humidity) = 0.07 -> level "high"
    expect(res.pct).toBe(0.07);
    expect(res.level).toBe('high');
  });

  it('caps the adjustment at 10%', () => {
    const res = computeHeatPaceAdjustment(35, 95);
    expect(res.pct).toBeLessThanOrEqual(0.1);
  });

  it('returns inactive for a missing temperature', () => {
    const res = computeHeatPaceAdjustment(null, 80);
    expect(res.active).toBe(false);
  });

  it('applyPaceAdjustment slows down a run pace string', () => {
    // 7:30/mile-equivalent example from the brief: 7:30 -> ~7:55 is a ~5.5% adjustment
    expect(applyPaceAdjustment('4:30 /km', 0.05)).toBe('4:44 /km');
  });

  it('applyPaceAdjustment returns null on an RPE fallback string (no invented number)', () => {
    expect(applyPaceAdjustment('Allure selon ressenti (RPE 6/10) — VMA non renseignée', 0.05)).toBeNull();
  });

  it('applyPowerAdjustment reduces target watts', () => {
    expect(applyPowerAdjustment('200W (75% FTP)', 0.05)).toBe('190W (75% FTP)');
  });

  it('applyPowerAdjustment returns null on an RPE fallback string', () => {
    expect(applyPowerAdjustment('Effort selon ressenti (RPE 6/10) — FTP non renseignée', 0.05)).toBeNull();
  });
});
