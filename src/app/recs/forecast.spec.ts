import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { NOW } from '../state/app-state.service';
import { FORECAST_FETCH, FORECAST_STORAGE, ForecastService, forecastUrl } from './forecast.service';
import { forecastOn, forecastText, parseForecast, weatherText, withinForecast } from './forecast';

const RAW = {
  daily: {
    time: ['2026-10-06', '2026-10-07', 'bad', '2026-10-08'],
    temperature_2m_max: [24.4, 19.6, 1, null],
    temperature_2m_min: [17.2, 12, 1, 3],
    precipitation_probability_max: [80, 10, 0, 0],
    weathercode: [63, 2, 0, 0],
  },
};

describe('parseForecast', () => {
  it('reads the daily block, rounds and skips bad days', () => {
    expect(parseForecast(RAW)).toEqual([
      { dateKey: '2026-10-06', hiC: 24, loC: 17, precipPct: 80, code: 63 },
      { dateKey: '2026-10-07', hiC: 20, loC: 12, precipPct: 10, code: 2 },
    ]);
  });
  it('never throws on junk and accepts weather_code and a missing probability', () => {
    expect(parseForecast(null)).toEqual([]);
    expect(parseForecast({ daily: { time: 'x' } })).toEqual([]);
    const d = parseForecast({ daily: { time: ['2026-10-06'], temperature_2m_max: [5], temperature_2m_min: [1], weather_code: [71] } });
    expect(d[0]).toMatchObject({ precipPct: null, code: 71 });
  });
});

describe('weather text', () => {
  it('maps WMO codes to short phrases', () => {
    expect(weatherText(0)).toBe('clear');
    expect(weatherText(2)).toBe('partly cloudy');
    expect(weatherText(45)).toBe('fog');
    expect(weatherText(95)).toBe('thunderstorms');
    expect(weatherText(73)).toBe('snow');
  });
  it('says likely from 60% and possible below', () => {
    expect(weatherText(61, 60)).toBe('rain likely');
    expect(weatherText(61, 59)).toBe('rain possible');
    expect(weatherText(61, null)).toBe('rain');
  });
  it('formats a day', () => {
    expect(forecastText({ dateKey: '2026-10-06', hiC: 24, loC: 17, precipPct: 80, code: 63 })).toBe('24° / 17° · rain likely');
    expect(forecastOn(parseForecast(RAW), '2026-10-07')?.hiC).toBe(20);
    expect(forecastOn(undefined, '2026-10-07')).toBeNull();
  });
});

describe('withinForecast', () => {
  it('covers today and the next 15 days', () => {
    expect(withinForecast('2026-10-06', '2026-10-06')).toBe(true);
    expect(withinForecast('2026-10-21', '2026-10-06')).toBe(true);
    expect(withinForecast('2026-10-22', '2026-10-06')).toBe(false);
    expect(withinForecast('2026-10-05', '2026-10-06')).toBe(false);
    expect(withinForecast('nope', '2026-10-06')).toBe(false);
  });
});

describe('forecastUrl', () => {
  it('carries only the destination coordinates', () => {
    const u = new URL(forecastUrl([{ lat: 38.774, lng: -9.134 }]));
    expect(u.origin).toBe('https://api.open-meteo.com');
    expect(u.searchParams.get('latitude')).toBe('38.77');
    expect(u.searchParams.get('longitude')).toBe('-9.13');
    expect(u.searchParams.get('timezone')).toBe('auto');
    expect(u.searchParams.get('forecast_days')).toBe('16');
    expect(u.searchParams.get('daily')).toContain('weather_code');
    const two = new URL(forecastUrl([{ lat: 38.774, lng: -9.134 }, { lat: 40.47, lng: -3.57 }]));
    expect(two.searchParams.get('latitude')).toBe('38.77,40.47');
    expect(two.searchParams.get('longitude')).toBe('-9.13,-3.57');
    expect([...u.searchParams.keys()].sort()).toEqual(['daily', 'forecast_days', 'latitude', 'longitude', 'timezone']);
  });
});

describe('ForecastService', () => {
  function setup(fetcher: (url: string) => Promise<unknown>, store: Record<string, string> = {}) {
    let now = Date.parse('2026-10-06T12:00:00Z');
    TestBed.configureTestingModule({
      providers: [
        { provide: FORECAST_FETCH, useValue: fetcher },
        { provide: NOW, useValue: () => now },
        { provide: FORECAST_STORAGE, useValue: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } } },
      ],
    });
    return { svc: TestBed.inject(ForecastService), store, advance: (ms: number) => { now += ms; } };
  }

  it('fetches once, caches in memory and sessionStorage for 3 h, then refreshes', async () => {
    const f = vi.fn(async () => RAW);
    const { svc, store, advance } = setup(f);
    await svc.ensure('LIS');
    await svc.ensure('LIS');
    expect(f).toHaveBeenCalledTimes(1);
    expect(svc.days()['LIS']).toHaveLength(2);
    expect(Object.keys(store)).toEqual(['ac.forecast.v1.LIS']);
    advance(3 * 3600_000 + 1);
    await svc.ensure('LIS');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('batches codes asked in the same tick into one request and splits the array answer', async () => {
    const f = vi.fn(async (_url: string) => [RAW, { daily: { ...RAW.daily, temperature_2m_max: [1, 2, 3, 4] } }]);
    const { svc } = setup(f);
    await svc.ensureMany(['LIS', 'MAD']);
    expect(f).toHaveBeenCalledTimes(1);
    const u = new URL(f.mock.calls[0][0]);
    expect(u.searchParams.get('latitude')).toBe('38.77,40.47');
    expect(svc.days()['LIS'][0].hiC).toBe(24);
    expect(svc.days()['MAD'][0].hiC).toBe(1);
  });

  it('reads a fresh sessionStorage entry without fetching', async () => {
    const f = vi.fn(async () => RAW);
    const at = Date.parse('2026-10-06T11:00:00Z');
    const { svc } = setup(f, { 'ac.forecast.v1.LIS': JSON.stringify({ at, days: parseForecast(RAW) }) });
    await svc.ensure('LIS');
    expect(f).not.toHaveBeenCalled();
    expect(svc.days()['LIS']).toHaveLength(2);
  });

  it('fails silently on a network error and waits before asking again', async () => {
    const f = vi.fn(async () => { throw new Error('offline'); });
    const { svc, advance } = setup(f);
    await expect(svc.ensure('LIS')).resolves.toBeUndefined();
    await svc.ensure('LIS');
    expect(f).toHaveBeenCalledTimes(1);
    expect(svc.days()['LIS']).toBeUndefined();
    advance(61_000);
    await svc.ensure('LIS');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('ignores a final failure (null) and unknown codes', async () => {
    const f = vi.fn(async () => null);
    const { svc } = setup(f);
    await svc.ensure('LIS');
    await svc.ensure('ZZZ');
    expect(f).toHaveBeenCalledTimes(1);
    expect(svc.days()['LIS']).toBeUndefined();
  });
});
