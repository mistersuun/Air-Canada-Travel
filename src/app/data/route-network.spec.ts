import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeRouteNetwork,
  installRouteNetwork,
  isRouteOnly,
  loadRouteNetwork,
  networkDestinations,
  resetRouteNetworkSource,
  ROUTE_ONLY_NOTE,
  capitalizeNote,
  networkNoteFor,
  routeFact,
  routeFactDetail,
  routeFactNoteOn,
  routeNetworkCredit,
  routeNetworkLoaded,
  setRouteNetworkSource,
  type RouteNetworkFile,
} from './route-network';
import { resetScheduleSource, setScheduleSource } from './schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from './testing/schedule-fixtures';
import { ROUTE_NETWORK_FIXTURE } from './testing/route-network-fixtures';
import { airportName, airportTz, hasKnownTz } from '../utils/airports';
import { isValidTimeZone } from '../utils/time';
import { DESTINATIONS, HUBS } from './destinations';

afterEach(() => {
  resetRouteNetworkSource();
  resetScheduleSource();
});

describe('decodeRouteNetwork', () => {
  it('rejects files it cannot read', () => {
    expect(() => decodeRouteNetwork(null as unknown as RouteNetworkFile)).toThrow();
    expect(() => decodeRouteNetwork({ ...ROUTE_NETWORK_FIXTURE, version: 2 })).toThrow();
    expect(() => decodeRouteNetwork({ ...ROUTE_NETWORK_FIXTURE, routes: undefined as never })).toThrow();
    expect(() => decodeRouteNetwork({ ...ROUTE_NETWORK_FIXTURE, license: '' })).toThrow(/licence/);
    expect(() => decodeRouteNetwork({ ...ROUTE_NETWORK_FIXTURE, attribution: '' })).toThrow(/attribution/);
  });

  it('skips malformed keys and decodes brands and dates', () => {
    const n = decodeRouteNetwork({
      ...ROUTE_NETWORK_FIXTURE,
      routes: { ...ROUTE_NETWORK_FIXTURE.routes, 'bad': ['A', 0, null, null, null], 'YUL-LHR': ['AR', 1, null, '2027-01-26', null] },
    });
    expect(n.routes.has('bad')).toBe(false);
    expect(n.routes.get('LHR-YUL')).toEqual({ brands: ['mainline', 'rouge'], seasonal: true, begins: null, ends: '2027-01-26', resumes: null });
  });
});

describe('route lookups', () => {
  it('finds a route in either direction', () => {
    setRouteNetworkSource(ROUTE_NETWORK_FIXTURE);
    expect(routeFact('YHZ', 'BOS')?.brands).toEqual(['express']);
    expect(routeFact('BOS', 'YHZ')?.brands).toEqual(['express']);
    expect(routeFact('YHZ', 'LAX')).toBeNull();
    expect(routeFact('YHZ', 'YHZ')).toBeNull();
    expect(routeFact(null, 'YHZ')).toBeNull();
    expect(routeFact('YHZ', 'BGI')).toMatchObject({ seasonal: true, begins: '2026-12-17' });
  });

  it('isRouteOnly is false when the schedules have the pair (either direction)', () => {
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    setRouteNetworkSource(ROUTE_NETWORK_FIXTURE);
    expect(isRouteOnly('YHZ', 'BOS')).toBe(true);
    expect(isRouteOnly('BOS', 'YHZ')).toBe(true);
    expect(isRouteOnly('YHZ', 'YYZ')).toBe(false); // AC603 is scheduled
    expect(isRouteOnly('YYZ', 'YHZ')).toBe(false);
    expect(isRouteOnly('YUL', 'LHR')).toBe(false); // scheduled, not in the network
    expect(isRouteOnly('YHZ', 'LAX')).toBe(false);
  });

  it('lists network destinations of an airport', () => {
    setRouteNetworkSource(ROUTE_NETWORK_FIXTURE);
    expect(networkDestinations('YHZ')).toEqual(['BGI', 'BOS', 'EWR', 'YDF', 'YOW', 'YYZ']);
    expect(networkDestinations('BOS')).toEqual(['YHZ']);
  });

  it('describes a fact briefly, never with times or odds', () => {
    setRouteNetworkSource(ROUTE_NETWORK_FIXTURE);
    expect(routeFactDetail(routeFact('YHZ', 'BGI'))).toBe('Air Canada Rouge · Seasonal · Starts Dec 17');
    expect(routeFactDetail(routeFact('YHZ', 'BOS'))).toBe('Air Canada Express');
    expect(routeFactDetail({ brands: ['mainline', 'rouge'], seasonal: false, begins: null, ends: '2026-11-30', resumes: '2026-12-01' }))
      .toBe('Resumes Dec 1 · Ends Nov 30');
    expect(routeFactDetail(null)).toBe('');
  });
});

describe('source management', () => {
  it('registers the file airports so names and time zones work, and unregisters on reset', () => {
    expect(hasKnownTz('YDF')).toBe(false);
    setRouteNetworkSource(ROUTE_NETWORK_FIXTURE);
    expect(airportName('YDF')).toBe('Deer Lake');
    expect(airportTz('YDF')).toBe('America/St_Johns');
    expect(hasKnownTz('YDF')).toBe(true);
    resetRouteNetworkSource();
    expect(hasKnownTz('YDF')).toBe(false);
    expect(airportName('YDF')).toBe('YDF');
  });

  it('never lets a file airport override a hub or a destination, and ignores bad zones', () => {
    setRouteNetworkSource({
      ...ROUTE_NETWORK_FIXTURE,
      airports: { YHZ: ['Fake', 'CA', 'UTC', 0, 0], XXX: ['Bad zone', 'CA', 'Not/AZone', 0, 0] },
    });
    expect(airportName('YHZ')).toBe('Halifax');
    expect(hasKnownTz('XXX')).toBe(false);
  });

  it('loads over fetch and resolves false on failure', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify(ROUTE_NETWORK_FIXTURE)));
    expect(await loadRouteNetwork('x.json', ok as unknown as typeof fetch)).toBe(true);
    expect(routeNetworkLoaded()).toBe(true);
    expect(routeNetworkCredit()).toMatchObject({ license: 'CC BY-SA 4.0', builtAt: '2026-10-01T06:00:00Z' });

    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bad = vi.fn(async () => new Response('nope', { status: 404 }));
    expect(await loadRouteNetwork('x.json', bad as unknown as typeof fetch)).toBe(false);
    const broken = vi.fn(async () => new Response('{"version":9}'));
    expect(await loadRouteNetwork('x.json', broken as unknown as typeof fetch)).toBe(false);
    err.mockRestore();
    // The earlier good load stays installed.
    expect(routeFact('YHZ', 'BOS')).not.toBeNull();
    installRouteNetwork({ ...ROUTE_NETWORK_FIXTURE, routes: {}, airports: {} });
  });

  it('setRouteNetworkSource(null) empties the network', () => {
    setRouteNetworkSource(ROUTE_NETWORK_FIXTURE);
    setRouteNetworkSource(null);
    expect(routeFact('YHZ', 'BOS')).toBeNull();
  });
});

describe('committed public/data/route-network.json', () => {
  const file = JSON.parse(readFileSync(`${process.cwd()}/public/data/route-network.json`, 'utf8')) as RouteNetworkFile;
  const known = new Set([...HUBS.map(h => h.code), ...DESTINATIONS.map(d => d.code)]);

  it('carries licence, attribution and a build date', () => {
    expect(file.license).toBe('CC BY-SA 4.0');
    expect(file.attribution).toMatch(/Wikipedia/);
    expect(file.attribution).toMatch(/OurAirports/);
    expect(file.meta?.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(file.meta?.sources?.length).toBe(10);
  });

  it('has well-formed keys and facts, and no times', () => {
    for (const [key, v] of Object.entries(file.routes)) {
      expect(key).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
      expect(v[0]).toMatch(/^[AXR]+$/);
      expect([0, 1]).toContain(v[1]);
      for (const d of v.slice(2)) if (d !== null) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(JSON.stringify(file.routes)).not.toMatch(/\d{2}:\d{2}/);
  });

  it('every airport outside HUBS and DESTINATIONS has a name and a valid tz', () => {
    const codes = new Set(Object.keys(file.routes).flatMap(k => k.split('-')));
    for (const code of codes) {
      if (known.has(code)) continue;
      const a = file.airports?.[code];
      expect(a, code).toBeDefined();
      expect(a![0]).toBeTruthy();
      expect(isValidTimeZone(a![2]), `${code} ${a![2]}`).toBe(true);
    }
  });

  it('lists the Express routes the Vacations PDFs leave out', () => {
    const n = decodeRouteNetwork(file);
    for (const [a, b] of [['YHZ', 'BOS'], ['YHZ', 'EWR'], ['YHZ', 'YOW'], ['YHZ', 'YDF']]) {
      expect(n.routes.has(a < b ? `${a}-${b}` : `${b}-${a}`), `${a}-${b}`).toBe(true);
    }
  });
});

describe('routeFactNoteOn / networkNoteFor (dates)', () => {
  const fact = (p: Partial<{ begins: string; ends: string; resumes: string }>) =>
    ({ brands: [], seasonal: false, begins: null, ends: null, resumes: null, ...p });

  it('says when a route starts, is paused, or has ended', () => {
    expect(routeFactNoteOn(fact({}), '2026-10-02')).toBe(ROUTE_ONLY_NOTE);
    expect(routeFactNoteOn(fact({ begins: '2027-06-16' }), '2026-10-02')).toBe('route starts Jun 16, 2027');
    expect(routeFactNoteOn(fact({ begins: '2027-06-16' }), '2027-01-02')).toBe('route starts Jun 16');
    expect(routeFactNoteOn(fact({ begins: '2027-06-16' }), '2027-06-16')).toBe(ROUTE_ONLY_NOTE);
    expect(routeFactNoteOn(fact({ resumes: '2027-05-01' }), '2026-10-02')).toBe('paused until May 1, 2027');
    expect(routeFactNoteOn(fact({ resumes: '2027-05-01' }), '2027-05-02')).toBe(ROUTE_ONLY_NOTE);
    expect(routeFactNoteOn(fact({ ends: '2027-01-26' }), '2027-01-26')).toBe(ROUTE_ONLY_NOTE);
    expect(routeFactNoteOn(fact({ ends: '2027-01-26' }), '2027-01-27')).toBeNull();
    expect(capitalizeNote('route starts Jun 16')).toBe('Route starts Jun 16');
  });

  it('networkNoteFor needs every segment listed and still flying on its date', () => {
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    setRouteNetworkSource(ROUTE_NETWORK_FIXTURE);
    const seg = { origin: 'YHZ', dest: 'BOS', dateKey: '2026-10-02' };
    expect(networkNoteFor([seg])).toBe(ROUTE_ONLY_NOTE);
    expect(networkNoteFor([seg, { origin: 'YHZ', dest: 'LAX', dateKey: '2026-10-02' }])).toBeNull();
    expect(networkNoteFor([])).toBeNull();
    // YHZ-BGI begins 2026-12-17: a leg before then is not "flies this route".
    const bgi = { origin: 'YHZ', dest: 'BGI', dateKey: '2026-10-02' };
    expect(networkNoteFor([bgi])).toBe('route starts Dec 17');
    expect(networkNoteFor([seg, bgi])).toBe('route starts Dec 17');
    expect(networkNoteFor([{ ...bgi, dateKey: '2026-12-20' }])).toBe(ROUTE_ONLY_NOTE);
  });
});
