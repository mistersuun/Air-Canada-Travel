import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { existsSync, readFileSync } from 'node:fs';
import { sevilleTrip } from '../trips/testing/seville-fixture';
import { buildPrepChecklist, referenceItems } from '../places/prep';
import {
  decodeAdvisories, decodeFx, decodeHolidays, fxLine, holidayName, holidaysBetween, upcomingHolidays,
} from './reference';
import { REFERENCE_FETCH, ReferenceService, type ReferenceFile } from './reference.service';
import { DestReferenceComponent } from './dest-reference.component';

const ADV = {
  generatedAt: '2026-10-05T06:00:00Z', source: 'GC',
  countries: {
    ES: { level: 0, text: 'Take normal security precautions', updated: '2026-09-30', url: 'https://travel.gc.ca/destinations/spain' },
    MX: { level: 1, text: 'Exercise a high degree of caution', updated: '2026-09-30', url: 'https://travel.gc.ca/destinations/mexico' },
    HT: { level: 3, text: 'Avoid all travel', url: 'https://travel.gc.ca/destinations/haiti' },
    BAD: { level: 9, text: 'x', url: 'https://travel.gc.ca/x' },
    EVIL: { level: 2, text: 'x', url: 'javascript:alert(1)' },
  },
};
const FX = { date: '2026-10-02', source: 'ECB', base: 'CAD', rates: { EUR: 0.6612, JPY: 108.24, MXN: 13.1, XYZ: 0.05, BAD: -1 } };
const HOL = {
  generatedAt: 'x', countries: {
    ES: [
      { date: '2027-01-01', name: "New Year's Day", localName: 'Año Nuevo', global: true },
      { date: '2026-10-12', name: 'National Day', localName: 'Fiesta Nacional de España', global: true },
      { date: '2026-11-01', name: 'All Saints', localName: 'Todos los Santos', global: false },
      { date: '2026-12-08', name: 'Immaculate Conception', localName: 'Inmaculada', global: true },
    ],
  },
};

describe('decoders', () => {
  it('keep valid rows and drop bad ones', () => {
    const adv = decodeAdvisories(ADV)!;
    expect([...adv.keys()].sort()).toEqual(['ES', 'HT', 'MX']);
    expect(adv.get('HT')!.updated).toBeNull();
    const fx = decodeFx(FX)!;
    expect(fx.rates.has('BAD')).toBe(false);
    expect(fx.rates.get('EUR')).toBe(0.6612);
    expect(decodeHolidays(HOL)!.get('ES')![0].date).toBe('2026-10-12');
  });
  it('return null for junk', () => {
    for (const bad of [null, 'x', 3, [], {}, { countries: {} }]) {
      expect(decodeAdvisories(bad)).toBeNull();
      expect(decodeHolidays(bad)).toBeNull();
    }
    expect(decodeFx({ ...FX, base: 'USD' })).toBeNull();
    expect(decodeFx({ ...FX, date: 'x' })).toBeNull();
    expect(decodeFx({ ...FX, rates: {} })).toBeNull();
  });
});

describe('fxLine', () => {
  const fx = decodeFx(FX);
  it('formats the rate with source and date', () => {
    expect(fxLine('EUR', fx)).toEqual({ text: '1 CAD = 0.66 EUR', source: 'ECB, Oct 2' });
    expect(fxLine('JPY', fx)!.text).toBe('1 CAD = 108 JPY');
    expect(fxLine('MXN', fx)!.text).toBe('1 CAD = 13.1 MXN');
  });
  it('reads small rates the other way round', () => {
    expect(fxLine('XYZ', fx)!.text).toBe('1 XYZ = 20.0 CAD');
  });
  it('is null for CAD, unknown codes and no file', () => {
    expect(fxLine('CAD', fx)).toBeNull();
    expect(fxLine('GBP', fx)).toBeNull();
    expect(fxLine(null, fx)).toBeNull();
    expect(fxLine('EUR', null)).toBeNull();
  });
});

describe('holidays', () => {
  const idx = decodeHolidays(HOL);
  it('upcoming: within 60 days, soonest first, at most two', () => {
    expect(upcomingHolidays(idx, 'ES', '2026-10-06').map(h => h.date)).toEqual(['2026-10-12', '2026-11-01']);
    expect(upcomingHolidays(idx, 'ES', '2026-10-13').map(h => h.date)).toEqual(['2026-11-01', '2026-12-08']);
    expect(upcomingHolidays(idx, 'ES', '2026-11-02', 60, 5).map(h => h.date)).toEqual(['2026-12-08', '2027-01-01']);
    expect(upcomingHolidays(idx, 'ES', '2026-12-09', 10)).toEqual([]);
    expect(upcomingHolidays(idx, 'FR', '2026-10-06')).toEqual([]);
    expect(upcomingHolidays(null, 'ES', '2026-10-06')).toEqual([]);
  });
  it('between is inclusive; names show the local one', () => {
    expect(holidaysBetween(idx, 'es', '2026-10-12', '2026-10-12')).toHaveLength(1);
    expect(holidayName(idx!.get('ES')![0])).toBe('National Day (Fiesta Nacional de España)');
  });
});

describe('Trip Prep reference items', () => {
  const ref = { advisories: decodeAdvisories(ADV), holidays: decodeHolidays(HOL) };
  it('adds a holiday inside the trip dates, not critical (Seville trip, Oct 8-13)', () => {
    const items = referenceItems(sevilleTrip(), ref);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'holiday:ES:2026-10-12', critical: false, detail: 'Banks and many shops may be closed', link: null,
    });
    expect(items[0].title).toContain('Oct 12');
  });
  it('adds an advisory only at level 2 or 3', () => {
    expect(referenceItems(sevilleTrip(), { advisories: ref.advisories })).toEqual([]); // ES level 0
    const adv = decodeAdvisories({ countries: { ES: { level: 2, text: 'Avoid non-essential travel', updated: '2026-09-30', url: 'https://travel.gc.ca/destinations/spain' } } });
    const [a] = referenceItems(sevilleTrip(), { advisories: adv });
    expect(a).toMatchObject({
      id: 'advisory:gc', critical: false, detail: 'Official travel.gc.ca page · updated Sep 30',
      link: { url: 'https://travel.gc.ca/destinations/spain' },
    });
    expect(a.title).toBe('Government of Canada advice for Spain: Avoid non-essential travel');
  });
  it('adds nothing without data, and the checklist only grows by those items', () => {
    expect(referenceItems(sevilleTrip(), null)).toEqual([]);
    expect(referenceItems(sevilleTrip(), { advisories: null, holidays: null })).toEqual([]);
    const base = buildPrepChecklist(sevilleTrip()).length;
    expect(buildPrepChecklist(sevilleTrip(), null, ref).length).toBe(base + 1);
  });
});

describe('ReferenceService', () => {
  afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); });
  const files: Record<ReferenceFile, unknown> = { advisories: ADV, fx: FX, holidays: HOL };

  it('loads all three once', async () => {
    const fetcher = vi.fn(async (n: ReferenceFile) => files[n]);
    TestBed.configureTestingModule({ providers: [{ provide: REFERENCE_FETCH, useValue: fetcher }] });
    const s = TestBed.inject(ReferenceService);
    await s.ensureLoaded();
    await s.ensureLoaded();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(s.status.fx()).toBe('ready');
    expect(s.holidays()!.get('ES')).toBeTruthy();
  });

  it('a 4xx (null) or bad file is final and hidden; a rejection retries next time', async () => {
    let fail = true;
    const fetcher = vi.fn(async (n: ReferenceFile) => {
      if (n === 'advisories') return null;
      if (n === 'fx') return { junk: 1 };
      if (fail) throw new Error('offline');
      return HOL;
    });
    TestBed.configureTestingModule({ providers: [{ provide: REFERENCE_FETCH, useValue: fetcher }] });
    const s = TestBed.inject(ReferenceService);
    await s.ensureLoaded();
    expect(s.status.advisories()).toBe('missing');
    expect(s.status.fx()).toBe('missing');
    expect(s.status.holidays()).toBe('idle');
    fail = false;
    await s.ensureLoaded();
    expect(s.status.holidays()).toBe('ready');
    expect(fetcher.mock.calls.filter(c => c[0] === 'advisories')).toHaveLength(1);
  });
});

describe('DestReferenceComponent', () => {
  afterEach(() => TestBed.resetTestingModule());
  async function render(iso2: string, files: Partial<Record<ReferenceFile, unknown>>) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: REFERENCE_FETCH, useValue: async (n: ReferenceFile) => files[n] ?? null }] });
    const f = TestBed.createComponent(DestReferenceComponent);
    f.componentRef.setInput('iso2', iso2);
    f.componentRef.setInput('todayKey', '2026-10-06');
    await f.whenStable();
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('shows advisory, fx and holidays as facts with sources', async () => {
    const el = await render('MX', { advisories: ADV, fx: FX, holidays: { countries: { MX: [{ date: '2026-11-02', name: 'Day of the Dead', localName: 'Día de Muertos', global: true }] } } });
    expect(el.querySelector('[data-advisory]')!.textContent).toContain('Exercise a high degree of caution · updated Sep 30 · travel.gc.ca');
    expect(el.querySelector('[data-advisory] a')!.getAttribute('href')).toBe('https://travel.gc.ca/destinations/mexico');
    expect(el.querySelector('[data-fx]')!.textContent).toContain('1 CAD = 13.1 MXN · ECB, Oct 2');
    expect(el.querySelector('[data-holiday]')!.textContent).toContain('Nov 2 · Day of the Dead (Día de Muertos) · Public holiday');
  });

  it('level 0 is quiet; a missing country or file hides the line', async () => {
    const el = await render('ES', { advisories: ADV });
    expect(el.querySelector('[data-advisory]')!.classList.contains('is-quiet')).toBe(true);
    expect(el.querySelector('[data-fx]')).toBeNull();
    const none = await render('ES', {});
    expect(none.textContent!.trim()).toBe('');
  });
});

describe('committed data (when present)', () => {
  it.each(['advisories', 'fx', 'holidays'] as const)('%s.json decodes', name => {
    const path = `${process.cwd()}/public/data/${name}.json`;
    if (!existsSync(path)) return;
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const dec = { advisories: decodeAdvisories, fx: decodeFx, holidays: decodeHolidays }[name](raw);
    expect(dec).not.toBeNull();
  });
});
