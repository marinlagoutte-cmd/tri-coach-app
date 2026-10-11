import { describe, it, expect, vi, afterEach } from 'vitest';
import { compassFr, weatherLabel, fetchTodayWeather } from '../lib/todayWeather';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

describe('météo du jour', () => {
  it('direction du vent en français', () => {
    expect(compassFr(0)).toBe('N');
    expect(compassFr(225)).toBe('SO');
    expect(compassFr(270)).toBe('O');
    expect(compassFr(350)).toBe('N');
  });
  it('libellés du ciel (codes WMO)', () => {
    expect(weatherLabel(0)).toBe('Ciel dégagé');
    expect(weatherLabel(3)).toBe('Couvert');
    expect(weatherLabel(63)).toBe('Pluie');
    expect(weatherLabel(95)).toBe('Orage');
  });
  it('lecture de la réponse Open-Meteo', async () => {
    let url = '';
    global.fetch = vi.fn(async (u) => { url = u; return { ok: true, json: async () => ({ current: { temperature_2m: 12 }, daily: { weather_code: [3], temperature_2m_max: [18.4], temperature_2m_min: [8.6], precipitation_probability_max: [40], precipitation_sum: [1.2], wind_speed_10m_max: [22.3], wind_gusts_10m_max: [35.1], wind_direction_10m_dominant: [225] } }) }; });
    const d = await fetchTodayWeather(44.84, -0.58);
    expect(url).toContain('forecast_days=1');
    expect(d).toMatchObject({ label: 'Couvert', tMax: 18.4, tMin: 8.6, rainProb: 40, windMax: 22.3, gustMax: 35.1, windDir: 225, tNow: 12 });
  });
});
