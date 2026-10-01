import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { existsSync, readFileSync } from 'node:fs';
import { climateFor, decodeClimate, formatTypical, typicalText } from './climate';
import { CLIMATE_FETCH, ClimateService } from './climate.service';
import { ClimateCreditComponent } from './ui/climate-credit.component';
import { CLIMATE_FIXTURE } from './testing/climate-fixture';

describe('climate (pure)', () => {
  it('decodes the fixture and reads LIS in October', () => {
    const idx = decodeClimate(CLIMATE_FIXTURE)!;
    expect(idx.byCode.size).toBe(4);
    const oct = climateFor(idx, 'LIS', 10)!;
    expect(oct).toEqual({ month: 10, tmaxC: 30, tminC: 23, precipMm: 60, wetDays: 8 });
    expect(formatTypical(oct, 'Oct')).toBe('Oct 30° / 23°');
    expect(typicalText(oct)).toBe('Oct 30° / 23°');
    expect(climateFor(idx, 'lis', 1)!.month).toBe(1);
  });

  it('returns null for bad input, unknown codes and bad months', () => {
    for (const bad of [null, 'x', 3, [], { v: 2, codes: {} }, { v: 1 }]) expect(decodeClimate(bad)).toBeNull();
    const idx = decodeClimate(CLIMATE_FIXTURE);
    expect(climateFor(idx, 'XXX', 10)).toBeNull();
    expect(climateFor(idx, 'LIS', 0)).toBeNull();
    expect(climateFor(idx, 'LIS', 13)).toBeNull();
    expect(climateFor(null, 'LIS', 10)).toBeNull();
  });

  it('skips a location with the wrong number of values', () => {
    const idx = decodeClimate({ ...CLIMATE_FIXTURE, codes: { ...CLIMATE_FIXTURE.codes, BAD: { tmax: [1, 2], tmin: [], precip: [], wet: [] } } })!;
    expect(idx.byCode.has('BAD')).toBe(false);
    expect(idx.byCode.has('LIS')).toBe(true);
  });

  it('the committed climate.json (when present) decodes, with 12 months per place', () => {
    const path = `${process.cwd()}/public/data/climate.json`;
    if (!existsSync(path)) return;
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    expect(raw.license).toBe('CC BY 4.0');
    expect(raw.done).toBeLessThanOrEqual(raw.total);
    const idx = decodeClimate(raw)!;
    expect(idx.byCode.size).toBe(raw.done);
    for (const months of idx.byCode.values()) expect(months).toHaveLength(12);
  });
});

describe('ClimateService', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup(fetcher: () => Promise<unknown>): ClimateService {
    TestBed.configureTestingModule({ providers: [{ provide: CLIMATE_FETCH, useValue: fetcher }] });
    return TestBed.inject(ClimateService);
  }

  it('loads once on demand', async () => {
    const fetcher = vi.fn(async () => CLIMATE_FIXTURE);
    const s = setup(fetcher);
    expect(s.status()).toBe('idle');
    expect(fetcher).not.toHaveBeenCalled();
    await Promise.all([s.ensureLoaded(), s.ensureLoaded()]);
    await s.ensureLoaded();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(s.status()).toBe('ready');
    expect(climateFor(s.index(), 'LIS', 10)!.tmaxC).toBe(30);
  });

  it('a network error goes back to idle and a later call retries', async () => {
    let calls = 0;
    const s = setup(async () => {
      calls++;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return CLIMATE_FIXTURE;
    });
    await s.ensureLoaded();
    expect(s.status()).toBe('idle');
    expect(s.index()).toBeNull();
    await s.ensureLoaded();
    expect(calls).toBe(2);
    expect(s.status()).toBe('ready');
  });

  it('maps a 404 (null) or bad JSON to missing, silently', async () => {
    const errors = vi.spyOn(console, 'error');
    for (const fetcher of [async () => null, async () => ({ nope: 1 })]) {
      TestBed.resetTestingModule();
      const s = setup(fetcher);
      await s.ensureLoaded();
      expect(s.status()).toBe('missing');
      expect(s.index()).toBeNull();
    }
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('the default fetcher maps an HTTP 404 to null', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 404 })) as typeof fetch;
    try {
      TestBed.configureTestingModule({});
      const s = TestBed.inject(ClimateService);
      await s.ensureLoaded();
      expect(s.status()).toBe('missing');
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe('ClimateCreditComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('credits Open-Meteo under CC BY 4.0 and says typical, not a forecast', () => {
    TestBed.configureTestingModule({ providers: [{ provide: CLIMATE_FETCH, useValue: async () => CLIMATE_FIXTURE }] });
    const f = TestBed.createComponent(ClimateCreditComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('summary')!.textContent).toContain('Weather credits');
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Open-Meteo.com historical weather (ERA5 reanalysis, Copernicus), CC BY 4.0.');
    expect(text).toContain('Averaged for 2021–2025 from the middle two weeks of each month. Typical, not a forecast.');
    expect([...el.querySelectorAll('a')].every(a => a.target === '_blank' && a.rel.includes('noopener'))).toBe(true);
  });

  it('renders nothing when the climate file is missing', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: CLIMATE_FETCH, useValue: async () => null }] });
    await TestBed.inject(ClimateService).ensureLoaded();
    const f = TestBed.createComponent(ClimateCreditComponent);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('details')).toBeNull();
  });
});
