import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { CLIMATE_FETCH } from '../../recs/climate.service';
import { FORECAST_FETCH, FORECAST_STORAGE } from '../../recs/forecast.service';
import { NOW } from '../../state/app-state.service';
import { MemoryStorage } from '../../state/testing';
import { DestWeatherLineComponent, forecastPart, typicalPart } from './dest-weather-line.component';

const NOW_MS = Date.parse('2026-10-06T15:00:00Z');
const DAYS = ['2026-10-06', '2026-10-07', '2026-10-08'];
const RAW = {
  daily: {
    time: DAYS, temperature_2m_max: [24, 23, 15], temperature_2m_min: [17, 16, 9],
    precipitation_probability_max: [80, 10, 30], weather_code: [63, 1, 61],
  },
};
const CLIMATE = {
  v: 1, source: 's', license: 'CC BY 4.0', attribution: 'a', period: '2021–2025', method: 'm', generatedAt: 'g', done: 1, total: 1,
  codes: {
    LIS: {
      tmax: Array.from({ length: 12 }, (_, i) => (i === 9 ? 13 : 20)),
      tmin: Array.from({ length: 12 }, (_, i) => (i === 9 ? 7 : 10)),
      precip: Array(12).fill(50), wet: Array(12).fill(8),
    },
  },
};

function setup(climate: unknown, forecast: (url: string) => Promise<unknown>) {
  TestBed.configureTestingModule({
    providers: [
      { provide: NOW, useValue: () => NOW_MS },
      { provide: CLIMATE_FETCH, useValue: async () => climate },
      { provide: FORECAST_FETCH, useValue: forecast },
      { provide: FORECAST_STORAGE, useValue: new MemoryStorage() },
    ],
  });
}

async function render(dateKey: string, code = 'LIS') {
  const fx = TestBed.createComponent(DestWeatherLineComponent);
  fx.componentRef.setInput('code', code);
  fx.componentRef.setInput('dateKey', dateKey);
  await fx.whenStable();
  await new Promise(r => setTimeout(r, 0));
  await fx.whenStable();
  return fx.nativeElement as HTMLElement;
}

describe('weather line text', () => {
  it('builds the typical and forecast parts', () => {
    expect(typicalPart({ month: 10, tmaxC: 13, tminC: 7, precipMm: 1, wetDays: 1 })).toBe('Oct 13° / 7°');
    expect(typicalPart(null)).toBeNull();
    const d = { dateKey: '2026-10-07', hiC: 15, loC: 9, code: 61, precipPct: 30 };
    expect(forecastPart(d, 'Wed')).toBe('Wed 15° / 9°, rain possible');
    expect(forecastPart(null, 'Wed')).toBeNull();
  });
});

describe('DestWeatherLineComponent', () => {
  it('shows labelled typical and forecast parts within 16 days', async () => {
    const f = vi.fn(async (_url: string) => RAW);
    setup(CLIMATE, f);
    const el = await render('2026-10-08');
    const t = el.textContent ?? '';
    expect(t).toContain('Typical Oct 13° / 7°');
    expect(t).toContain('Forecast Thu 15° / 9°, rain possible');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('shows only the typical part beyond 16 days, with no forecast request', async () => {
    const f = vi.fn(async (_url: string) => RAW);
    setup(CLIMATE, f);
    const el = await render('2026-12-25');
    expect(el.textContent).toContain('Typical Dec');
    expect(el.textContent).not.toContain('Forecast');
    expect(f).not.toHaveBeenCalled();
  });

  it('is empty with no data at all', async () => {
    setup(null, async () => { throw new Error('offline'); });
    const el = await render('2026-10-08');
    expect(el.textContent?.trim()).toBe('');
  });
});
