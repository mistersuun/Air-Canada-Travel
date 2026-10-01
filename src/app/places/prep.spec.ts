import { describe, expect, it } from 'vitest';
import type { FlightLeg, Trip } from '../trips/model';
import { SEVILLE_IDS, sevilleTrip } from '../trips/testing/seville-fixture';
import { toUtcMs } from '../utils/time';
import { ENTRY_RULES } from './prep-rules';
import {
  buildPrepChecklist, entryInfo, joinNames, legPrepItems, routeCountries, travelGcSlug, tripEssentials,
} from './prep';

const titles = (t: Trip) => buildPrepChecklist(t).map(i => i.title);

function flightLeg(id: string, refs: [string, string, string][], role: FlightLeg['role'] = 'positioning'): FlightLeg {
  return {
    kind: 'flight', id, role, status: 'planned', statusAt: null, note: '', provenance: 'scheduled', alternates: [],
    refs: refs.map(([flightNumber, origin, dest]) => ({
      flightNumber, origin, dest, dateKey: '2026-10-08', depLocal: '10:00', arrLocal: '12:00', arrDateKey: '2026-10-08', aircraft: null,
    })),
  };
}

describe('prep rules table', () => {
  it('every row is reviewed, links to an official page and never mentions ESTA/eTA as needed', () => {
    for (const r of ENTRY_RULES) {
      expect(r.reviewed).toBe('2026-10');
      expect(r.url).toMatch(/^https:\/\/(travel\.gc\.ca|travel-europe\.europa\.eu|www\.gov\.uk)\//);
      expect(r.title).not.toMatch(/\beTA\b/);
      expect(`${r.title} ${r.detail}`).not.toMatch(/\bapply\b/i);
    }
    expect(ENTRY_RULES.find(r => r.id === 'etias')!.title).toBe('Check ETIAS status');
  });
});

describe('buildPrepChecklist (Seville trip)', () => {
  it('has the entry, listing and ground items in order', () => {
    const items = buildPrepChecklist(sevilleTrip());
    expect(items.map(i => i.title)).toEqual([
      'Passports valid 3+ months after you leave',
      'Check ETIAS status',
      'Listed for AC834',
      'List for AC813 home',
      'Find the Madrid → Seville train',
      'Find the Seville → Lisbon bus',
    ]);
    const [pass, etias, out, ret, train, bus] = items;
    expect(pass).toMatchObject({
      id: 'entry:schengen-validity', detail: 'Schengen rule · Spain and Portugal', critical: true, source: 'manual', done: false,
      link: { label: 'Government of Canada advice', url: 'https://travel.gc.ca/destinations/spain' },
    });
    expect(etias).toMatchObject({
      id: 'entry:etias', detail: 'Official EU page · not required until it starts',
      link: { url: 'https://travel-europe.europa.eu/etias_en' },
    });
    expect(out).toMatchObject({ id: `list:${SEVILLE_IDS.outbound}:0`, done: true, critical: true, source: 'legStatus', detail: null });
    expect(ret).toMatchObject({ id: `list:${SEVILLE_IDS.ret}:0`, done: false, detail: 'Calendar reminder added' });
    expect(train).toMatchObject({ id: `ground:${SEVILLE_IDS.train}`, done: false, critical: false, detail: 'Only estimated so far' });
    expect(bus).toMatchObject({ id: `ground:${SEVILLE_IDS.bus}`, done: true, detail: 'Saved by you' });
  });

  it('has no ESTA, eTA or UK item for this route', () => {
    const all = titles(sevilleTrip()).join(' | ');
    expect(all).not.toMatch(/ESTA|eTA|UK/);
  });

  it('ticks manual items from trip.prep and lists custom items last', () => {
    const t = sevilleTrip();
    t.prep['entry:etias'] = { done: true, at: '2026-10-01T10:00:00Z' };
    t.customPrep = [{ id: 'c1', text: 'Pack the adapter' }];
    t.prep['custom:c1'] = { done: true, at: '2026-10-01T10:00:00Z' };
    const items = buildPrepChecklist(t);
    expect(items.find(i => i.id === 'entry:etias')!.done).toBe(true);
    expect(items[items.length - 1]).toMatchObject({ id: 'custom:c1', title: 'Pack the adapter', done: true, source: 'manual' });
  });

  it('drops final legs and omits the calendar note before export', () => {
    const t = sevilleTrip();
    t.calendarExportedAt = null;
    t.legs[0].status = 'boarded';
    const items = buildPrepChecklist(t);
    expect(items.map(i => i.title)).not.toContain('Listed for AC834');
    expect(items.find(i => i.title === 'List for AC813 home')!.detail).toBeNull();
  });

  it('only claims a calendar reminder for flights that were in the export, with the same times', () => {
    const t = sevilleTrip();
    const ret = t.legs.find(l => l.kind === 'flight' && l.role === 'return')!;
    if (ret.kind !== 'flight') throw new Error();
    ret.refs = [{ ...ret.refs[0], depLocal: '11:10', arrLocal: '13:35' }];     // retimed after the export
    expect(buildPrepChecklist(t).find(i => i.title === 'List for AC813 home')!.detail).toBe('Not in your calendar yet · export again');
    t.calendarRefs = undefined;                                               // exported before flights were tracked
    expect(buildPrepChecklist(t).find(i => i.title === 'List for AC813 home')!.detail).toBeNull();
  });
});

describe('route countries and entry rules', () => {
  it('collects countries in route order, including ground legs and the goal', () => {
    expect(routeCountries(sevilleTrip())).toEqual(['CA', 'ES', 'PT']);
  });

  it('a connection through LHR adds the UK ETA', () => {
    const t = sevilleTrip();
    t.legs.unshift(flightLeg('lhr', [['AC866', 'YUL', 'LHR'], ['AC000', 'LHR', 'MAD']]));
    expect(routeCountries(t)).toEqual(['CA', 'GB', 'ES', 'PT']);
    const items = buildPrepChecklist(t);
    expect(items.map(i => i.id)).toContain('entry:uk-eta');
    expect(items.find(i => i.id === 'entry:uk-eta')).toMatchObject({ title: 'Check UK ETA', link: { url: 'https://www.gov.uk/eta' } });
    // One listing item per segment.
    expect(items.filter(i => i.id.startsWith('list:lhr:')).map(i => i.title)).toEqual(['List for AC866', 'List for AC000']);
  });

  it('US: no ESTA; MX: entry form; elsewhere: Government of Canada advice per country', () => {
    const t = sevilleTrip();
    t.goal = { ...t.goal, iso2: 'MA', country: 'Morocco', lat: 33.57, lng: -7.59 };
    t.legs = [flightLeg('a', [['AC1', 'YUL', 'LAX']]), flightLeg('b', [['AC2', 'LAX', 'CUN']]), flightLeg('c', [['AC3', 'CUN', 'CMN']])];
    const items = buildPrepChecklist(t);
    expect(items.find(i => i.id === 'entry:us-entry')!.title).toBe('No ESTA for Canadian citizens');
    expect(items.find(i => i.id === 'entry:mx-entry')!.title).toBe('Check Mexico entry rules');
    expect(items.find(i => i.id === 'entry:country-advice:MA')).toMatchObject({
      title: 'Check entry rules for Morocco', link: { url: 'https://travel.gc.ca/destinations/morocco' },
    });
    expect(items.some(i => /Schengen|ETIAS/.test(i.title))).toBe(false);
  });

  it('EES is an info note, not a checklist item', () => {
    expect(entryInfo(sevilleTrip()).map(i => i.id)).toEqual(['entry:ees']);
    expect(entryInfo(sevilleTrip())[0].critical).toBe(false);
  });

  it('helpers', () => {
    expect(joinNames(['Spain'])).toBe('Spain');
    expect(joinNames(['Spain', 'France', 'Italy'])).toBe('Spain, France and Italy');
    expect(joinNames([])).toBe('');
    expect(travelGcSlug('DO')).toBe('dominican-republic');
    expect(travelGcSlug('US')).toBe('united-states');
    expect(travelGcSlug('CW')).toBe('curacao');
  });
});

describe('legPrepItems', () => {
  it("gives Today's left-to-do for the outbound leg", () => {
    const items = legPrepItems(sevilleTrip(), SEVILLE_IDS.outbound);
    expect(items.map(i => [i.title, i.done])).toEqual([['Listed for AC834', true], ['Check in for AC834', false]]);
    expect(items[1]).toMatchObject({ id: `checkin:${SEVILLE_IDS.outbound}`, detail: "Before your pass's cutoff", source: 'legStatus' });
    expect(legPrepItems(sevilleTrip(), SEVILLE_IDS.train).map(i => i.title)).toEqual(['Find the Madrid → Seville train']);
    expect(legPrepItems(sevilleTrip(), 'nope')).toEqual([]);
  });
});

describe('tripEssentials', () => {
  it('Euro and +6h vs Montréal', () => {
    const now = toUtcMs('2026-10-01', '09:41', 'America/Toronto');
    expect(tripEssentials(sevilleTrip(), now)).toEqual({ currency: 'Euro', timeDiff: '+6h vs Montréal' });
    const t = sevilleTrip();
    t.goal = { ...t.goal, tz: null };
    expect(tripEssentials(t, now).timeDiff).toBe('');
  });
});
