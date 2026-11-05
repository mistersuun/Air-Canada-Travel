import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { existsSync, readFileSync } from 'node:fs';
import { buildPrepChecklist } from '../places/prep';
import { PROFILE_KEY } from '../recs/model';
import { PROFILE_STORAGE } from '../recs/profile.service';
import { MemoryStorage } from '../state/testing';
import { sevilleTrip } from '../trips/testing/seville-fixture';
import { DestReferenceComponent } from './dest-reference.component';
import { REFERENCE_FETCH, type ReferenceFile } from './reference.service';
import { bestEntry, decodeVisa, entryLabel, entryListing, passportOptions, visaStale } from './visa';

const VISA = {
  v: 1, source: 'Passport Index data', license: 'MIT', licenseUrl: 'https://github.com/imorte/passport-index-data/blob/main/LICENSE',
  attribution: 'Passport Index data (passportindex.org), compiled by imorte/passport-index-data (MIT licence)',
  asOf: '2026-02-17', generatedAt: '2026-11-05T00:00:00Z',
  cols: ['CA', 'CN', 'ES', 'GB', 'IN', 'PT', 'US'],
  rows: {
    CA: 'O,V,F90,T,E,F90,F180',
    IN: 'T,V,V,V,O,V,V',
    FR: 'T,F30,F,T,E,F,T',
    BAD: 'O,O,O,O,O,O,O',
    XX: 'F90,V',
    YY: 'Q,V,V,V,V,V,V',
  },
};
const ADV = { countries: { ES: { level: 0, text: 'Exercise normal security precautions', url: 'https://travel.gc.ca/destinations/spain' } } };

describe('decodeVisa', () => {
  it('keeps well-formed rows and rejects a bad file', () => {
    const v = decodeVisa(VISA)!;
    expect([...v.rows.keys()]).toEqual(['CA', 'IN', 'FR']); // BAD key, short row, unknown code dropped
    expect(v.asOf).toBe('2026-02-17');
    expect(decodeVisa({ ...VISA, v: 2 })).toBeNull();
    expect(decodeVisa({ ...VISA, asOf: 'Feb' })).toBeNull();
    expect(decodeVisa({ ...VISA, rows: { XX: 'F90,V' } })).toBeNull();
    expect(decodeVisa('x')).toBeNull();
  });

  it('reads a listing per passport and country', () => {
    const v = decodeVisa(VISA)!;
    expect(entryListing(v, 'ca', 'es')).toEqual({ kind: 'F', days: 90 });
    expect(entryListing(v, 'FR', 'ES')).toEqual({ kind: 'F', days: null });
    expect(entryListing(v, 'CA', 'GB')).toEqual({ kind: 'T', days: null });
    expect(entryListing(v, 'CA', 'MX')).toBeNull(); // no column
    expect(entryListing(v, 'ZZ', 'ES')).toBeNull(); // no row
  });

  it('dual nationals get the easiest listing, with the passport it comes from', () => {
    const v = decodeVisa(VISA)!;
    expect(bestEntry(v, ['IN', 'CA'], 'ES')).toEqual({ kind: 'F', days: 90, passport: 'CA' });
    expect(bestEntry(v, ['CA', 'FR'], 'ES')).toEqual({ kind: 'F', days: null, passport: 'FR' }); // no stated limit beats 90 days
    expect(bestEntry(v, ['CA', 'FR'], 'CN')).toEqual({ kind: 'F', days: 30, passport: 'FR' });
    expect(bestEntry(v, ['IN'], 'IN')).toEqual({ kind: 'O', days: null, passport: 'IN' });
    expect(bestEntry(v, [], 'ES')).toBeNull();
  });

  it('labels listings without a verdict and goes stale after 18 months', () => {
    expect(entryLabel({ kind: 'F', days: 90 })).toBe('visa-free, up to 90 days');
    expect(entryLabel({ kind: 'T', days: null })).toBe('electronic travel authorization before you fly');
    expect(entryLabel({ kind: 'V', days: null })).toBe('visa required');
    const v = decodeVisa(VISA)!;
    expect(visaStale(v, '2027-08-01')).toBe(false);
    expect(visaStale(v, '2027-09-01')).toBe(true);
    expect(passportOptions(v).map(o => o.name)).toEqual(['Canada', 'France', 'India']);
  });
});

describe('entry line on the destination page', () => {
  afterEach(() => TestBed.resetTestingModule());
  async function render(iso2: string, passports: string[] | null, files: Partial<Record<ReferenceFile, unknown>> = { visa: VISA, advisories: ADV }) {
    TestBed.resetTestingModule();
    const storage = new MemoryStorage();
    if (passports) storage.setItem(PROFILE_KEY, JSON.stringify({ v: 1, passports, updatedAt: '2026-11-01T00:00:00Z' }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PROFILE_STORAGE, useValue: storage },
        { provide: REFERENCE_FETCH, useValue: async (n: ReferenceFile) => files[n] ?? null },
      ],
    });
    const f = TestBed.createComponent(DestReferenceComponent);
    f.componentRef.setInput('iso2', iso2);
    f.componentRef.setInput('todayKey', '2026-11-05');
    await f.whenStable();
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('Canadian passport to Spain: the listing, its date and the travel.gc.ca entry section', async () => {
    const el = await render('ES', ['CA']);
    const line = el.querySelector('[data-entry]')!;
    expect(line.textContent!.replace(/\s+/g, ' ')).toContain('Canada passport: visa-free, up to 90 days, as listed by Passport Index · Data as of Feb 17, 2026, not official');
    expect(line.querySelector('a')!.getAttribute('href')).toBe('https://travel.gc.ca/destinations/spain#entryexit');
  });

  it('another passport: no Canadian link, a check-the-official-rules line instead', async () => {
    const el = await render('GB', ['IN']);
    const line = el.querySelector('[data-entry]')!;
    expect(line.textContent).toContain('India passport: visa required');
    expect(line.textContent).toContain("Check the destination's official rules before you go.");
    expect(line.querySelector('a')).toBeNull();
  });

  it('no passport set: one link to choose it; no file: nothing', async () => {
    const el = await render('ES', null);
    expect(el.querySelector('[data-entry]')).toBeNull();
    expect(el.querySelector('[data-entry-ask] a')!.getAttribute('href')).toBe('/profile#passport');
    const none = await render('ES', null, {});
    expect(none.querySelector('[data-entry-ask]')).toBeNull();
  });
});

describe('Trip Prep entry items by passport', () => {
  it('a Canadian passport (or none set) keeps the Canadian reminders', () => {
    const ids = (p?: string[]) => buildPrepChecklist(sevilleTrip(), null, { passports: p, visa: decodeVisa(VISA) }).map(i => i.id).filter(id => id.startsWith('entry:'));
    expect(ids()).toContain('entry:schengen-validity');
    expect(ids(['CA'])).toEqual(ids());
    expect(ids(['FR', 'CA'])).toEqual(ids());
  });

  it('another passport: one listed item per route country, with source and date, never the Canadian rows', () => {
    const items = buildPrepChecklist(sevilleTrip(), null, { passports: ['IN'], visa: decodeVisa(VISA) }).filter(i => i.id.startsWith('entry:'));
    expect(items.map(i => i.id)).toEqual(['entry:listed:CA', 'entry:listed:ES', 'entry:listed:PT']);
    expect(items[1]).toMatchObject({ title: 'Spain: visa required for India passport holders, as listed by Passport Index', critical: true, link: null });
    expect(items[1].detail).toContain('Data as of Feb 17, 2026, not official');
    expect(items[0].title).toBe('Canada: electronic travel authorization before you fly for India passport holders, as listed by Passport Index');
    const noData = buildPrepChecklist(sevilleTrip(), null, { passports: ['IN'], visa: null }).filter(i => i.id.startsWith('entry:'));
    expect(noData[1].title).toBe('Check the entry rules for Spain with your passport');
  });
});

describe('committed visa.json (when present)', () => {
  const path = 'public/data/visa.json';
  it.runIf(existsSync(path))('decodes, covers every passport row and lists Canada → Spain', () => {
    const v = decodeVisa(JSON.parse(readFileSync(path, 'utf8')))!;
    expect(v).not.toBeNull();
    expect(v.rows.size).toBeGreaterThan(150);
    expect(entryListing(v, 'CA', 'ES')?.kind).toBe('F');
  });
});
