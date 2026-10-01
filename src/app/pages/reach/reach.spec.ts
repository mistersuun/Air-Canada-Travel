import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { CITIES_FETCH } from '../../places/city-index.service';
import { reachGateways } from '../../places/reach';
import { FIXTURE_CITIES_FILE } from '../../places/testing/cities-fixture';
import { NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { TRIPS_STORAGE } from '../../trips/storage';
import { SEVILLE_META, SEVILLE_PLACE, SEVILLE_ROUTES } from '../../trips/testing/seville-fixture';
import { TripsService } from '../../trips/trips.service';
import { toUtcMs } from '../../utils/time';
import { GatewayPage } from './gateway.page';
import {
  arrivalLine, backupItineraries, dayLabel, gatewayRow, groundDetail, groundTitle, lastTrainWarning, partOfDay, readReachParams,
  reachQueryParams, startTripFromGateway,
} from './reach-model';
import { ReachPage } from './reach.page';

const NOW_MS = toUtcMs('2026-10-01', '09:41', 'America/Toronto');
const CONNECT = Object.freeze({ minConnect: 60 });
const PARAMS = readReachParams({ dep: '2026-10-08', home: '2026-10-13T22:00' }, '2026-10-01', 'YUL');
const reach = (over = {}) => reachGateways({
  place: SEVILLE_PLACE, hub: 'YUL', dateKey: '2026-10-08', includeOtherHubs: false, sort: 'onward', connect: CONNECT, ...over,
});

beforeEach(() => setScheduleSource(SEVILLE_ROUTES, SEVILLE_META));
afterEach(() => resetScheduleSource());

describe('reach model', () => {
  it('reads the URL with defaults: a week out, home 5 days later at 22:00, the global hub', () => {
    expect(readReachParams({}, '2026-10-01', 'YYZ')).toEqual({
      dep: '2026-10-08', home: { dateKey: '2026-10-13', hhmm: '22:00' }, sort: 'onward', hubs: false, hub: 'YYZ',
    });
    const p = readReachParams({ dep: '2026-10-08', home: '2026-10-12T18:30', sort: 'flights', hubs: '1', hub: 'YVR' }, '2026-10-01', 'YUL');
    expect(p).toEqual({ dep: '2026-10-08', home: { dateKey: '2026-10-12', hhmm: '18:30' }, sort: 'flights', hubs: true, hub: 'YVR' });
    // Garbage and a home before the departure fall back.
    const bad = readReachParams({ dep: 'nope', home: '2026-09-01T10:00', hub: 'XXX' }, '2026-10-01', 'YUL');
    expect(bad.dep).toBe('2026-10-08');
    expect(bad.home).toEqual({ dateKey: '2026-10-13', hhmm: '22:00' });
    expect(bad.hub).toBe('YUL');
    expect(reachQueryParams(p)).toEqual({ dep: '2026-10-08', home: '2026-10-12T18:30', sort: 'flights', hubs: '1', hub: 'YVR' });
  });

  it('gateway rows: flights that day, the ground estimate, and a greyed row with the next date', () => {
    const { gateways } = reach();
    const rows = gateways.map(g => gatewayRow(g, '2026-10-08'));
    const mad = rows.find(r => r.code === 'MAD')!;
    expect(mad.flight).toBe('AC834 17:55 · 1 flight that day');
    expect(mad.ground).toBe('Train about 2h40');
    expect(mad.provenance).toBe('estimated');
    expect(mad.standby).toBeNull();
    expect(rows.find(r => r.code === 'LIS')!.flight).toBe('AC812 21:45 · 1 flight that day');
    const opo = rows.find(r => r.code === 'OPO')!;
    expect(opo.flight).toBeNull();
    expect(opo.idle).toBe('Not found in our schedule data Thu Oct 8 · next Fri Oct 9');
    // Never "no flights" or "cancelled".
    expect(rows.map(r => `${r.flight} ${r.idle}`).join(' ')).not.toMatch(/no flights|cancel/i);
  });

  it('via-hub itineraries say how many standby legs they take', () => {
    const lis = reach({ includeOtherHubs: true }).gateways.find(g => g.code === 'LIS')!;
    expect(gatewayRow(lis, '2026-10-08').standby).toMatch(/^\+\d+ via Toronto · 2 standby legs$/);
    // From YYZ, OPO is reached only via Montréal.
    const opo = reachGateways({
      place: SEVILLE_PLACE, hub: 'YYZ', dateKey: '2026-10-09', includeOtherHubs: true, sort: 'onward', connect: { minConnect: 30 },
    }).gateways.find(g => g.code === 'OPO')!;
    const row = gatewayRow(opo, '2026-10-09');
    expect(row.flight).toBe('AC894 + AC928 17:30 · via Montréal');
    expect(row.standby).toBe('2 standby legs');
  });

  it('door-to-door wording', () => {
    const mad = reach().gateways.find(g => g.code === 'MAD')!;
    expect(arrivalLine(SEVILLE_PLACE, mad.arriveGoalUtc, 'Europe/Madrid')).toBe('Seville around midday, Fri Oct 9');
    expect(groundTitle(mad.ground, SEVILLE_PLACE)).toBe('Train to Seville');
    expect(groundDetail(mad.ground)).toBe('about 2h40 · trains roughly hourly');
    expect(lastTrainWarning(mad)).toBeNull();
    expect(lastTrainWarning({ ...mad, lastDepMissed: true, overnightLikely: true })).toMatch(/after the last train .*Plan a night in Madrid/);
    expect(arrivalLine(SEVILLE_PLACE, null, 'Europe/Madrid')).toBe('Seville: arrival time unknown');
    expect(['04:00', '08:00', '11:00', '15:00', '17:20', '22:00'].map(partOfDay))
      .toEqual(['early morning', 'morning', 'midday', 'afternoon', 'evening', 'late evening']);
    expect(dayLabel('2026-10-08')).toBe('Thu Oct 8');
  });

  it('backups are the same-day best itinerary to each other gateway', () => {
    const { gateways } = reach();
    const mad = gateways.find(g => g.code === 'MAD')!;
    const nos = backupItineraries(mad, mad.itineraries[0], gateways).map(i => i.legs[0].flightNumber);
    expect(nos.sort()).toEqual(['AC812', 'AC822']);
  });
});

function configure(store = new MemoryStorage()) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'reach/:place', component: ReachPage },
        { path: 'reach/:place/:code', component: GatewayPage },
        { path: 'trips/:id', children: [] },
        { path: '**', children: [] },
      ], withComponentInputBinding()),
      { provide: NOW, useValue: () => NOW_MS },
      { provide: TRIPS_STORAGE, useValue: store },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: CITIES_FETCH, useValue: async () => FIXTURE_CITIES_FILE },
    ],
  });
}

async function settle(h: RouterTestingHarness) {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    h.detectChanges();
    await h.fixture.whenStable();
  }
}

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ');

describe('ReachPage', () => {
  it('lists the gateways for Seville with Estimated tags, the greyed OPO row and the checkbox', async () => {
    configure();
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/reach/gn-2510911?dep=2026-10-08&home=2026-10-13T22:00');
    await settle(h);
    const el = h.routeNativeElement!;
    expect(text(el)).toContain('Leave Thu Oct 8');
    expect(text(el)).toContain('Home by Tue Oct 13');
    expect(text(el)).toContain('From YUL');
    expect(text(el)).toContain('Ways to reach Seville');
    expect(text(el)).toContain("Not in our schedule data");
    expect([...el.querySelectorAll('.row .c')].map(c => c.textContent)).toEqual(['MAD', 'BCN', 'LIS', 'OPO']);
    expect(el.querySelectorAll('a.row app-provenance-tag').length).toBe(3);
    expect(text(el.querySelector('.row.idle')!)).toContain('Not found in our schedule data Thu Oct 8 · next Fri Oct 9');
    // The idle row is not a dead end: it opens OPO on its next day with a flight.
    expect(el.querySelector('a.row.idle')!.getAttribute('href')).toMatch(/^\/reach\/gn-2510911\/OPO\?.*dep=2026-10-09/);
    expect(text(el)).toContain("Air Canada may still fly there on routes this app doesn't cover");
    expect(text(el)).toContain('Include trips via other Canadian hubs');
    expect(el.querySelector('a.row')!.getAttribute('href')).toMatch(/^\/reach\/gn-2510911\/MAD\?.*dep=2026-10-08/);

    // The checkbox and the seg write the URL.
    (el.querySelector('input[type=checkbox]') as HTMLInputElement).click();
    await settle(h);
    expect(TestBed.inject(Router).url).toContain('hubs=1');
    expect(text(el)).toContain('2 standby legs');
    const more = [...el.querySelectorAll('app-seg button')].find(b => b.textContent!.includes('More flights')) as HTMLElement;
    more.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toContain('sort=flights');
    expect(el.querySelector('.row .c')!.textContent).toBe('LIS');
  });

  it('says so when the city list cannot be loaded', async () => {
    TestBed.overrideProvider(CITIES_FETCH, { useValue: async () => { throw new Error('offline'); } });
    configure();
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/reach/gn-2510911?dep=2026-10-08');
    await settle(h);
    expect(text(h.routeNativeElement!)).toContain("City search isn't available right now");
  });
});

describe('GatewayPage', () => {
  it('shows MAD door to door and starts the trip with the flight, the ground leg and two backups', async () => {
    configure();
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/reach/gn-2510911/MAD?dep=2026-10-08&home=2026-10-13T22:00');
    await settle(h);
    const el = h.routeNativeElement!;
    const t = text(el);
    expect(t).toContain('via Madrid');
    expect(t).toContain('YUL 17:55 → MAD 06:50⁺¹');
    expect(t).toContain('AC834 · A330-300 · Scheduled');
    expect(t).toContain('Passport, exit, get to Atocha');
    expect(t).toContain('allow about 1h30 · Estimated');
    expect(t).toContain('Train to Seville');
    expect(t).toContain('about 2h40 · trains roughly hourly · Estimated');
    expect(t).toContain('Seville around midday, Fri Oct 9');
    expect(t).toContain('Find onward transport');
    expect(t).toMatch(/Rome2Rio · Omio · Skyscanner/);
    expect(el.querySelector<HTMLAnchorElement>('a.find')!.href).toContain('google.com/maps/dir/?api=1');

    const start = [...el.querySelectorAll('button')].find(b => b.textContent!.includes('Start this trip'))!;
    start.click();
    await settle(h);
    const trips = TestBed.inject(TripsService);
    const trip = trips.trips()[0];
    expect(trip.name).toBe('Seville trip');
    expect(trip.homeBy).toEqual({ dateKey: '2026-10-13', hhmm: '22:00' });
    expect(trip.legs.length).toBe(2);
    const [flight, ground] = trip.legs;
    if (flight.kind !== 'flight' || ground.kind !== 'ground') throw new Error('leg order');
    expect(flight.refs[0].flightNumber).toBe('AC834');
    expect(flight.status).toBe('planned');
    expect(flight.alternates.map(a => a.refs[0].flightNumber).sort()).toEqual(['AC812', 'AC822']);
    expect(ground).toMatchObject({ mode: 'train', provenance: 'estimated', dateKey: '2026-10-09', estMinutes: 250 });
    expect(TestBed.inject(Router).url.split('?')[0]).toBe(`/trips/${trip.id}`);
    expect(TestBed.inject(Router).url).not.toContain('leg=');
  });

  it('"I found a train" opens the trip on the ground leg', async () => {
    configure();
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/reach/gn-2510911/MAD?dep=2026-10-08');
    await settle(h);
    [...h.routeNativeElement!.querySelectorAll('button')].find(b => b.textContent!.includes('I found a train'))!.click();
    await settle(h);
    const trip = TestBed.inject(TripsService).trips()[0];
    const ground = trip.legs.find(l => l.kind === 'ground')!;
    expect(TestBed.inject(Router).url).toMatch(new RegExp(`^/trips/${trip.id}\\?leg=${ground.id}(&|$)`));
  });

  it('a gateway without a flight that day offers the next date and cannot start', async () => {
    configure();
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/reach/gn-2510911/OPO?dep=2026-10-08');
    await settle(h);
    const el = h.routeNativeElement!;
    expect(text(el)).toContain('Not found in our schedule data Thu Oct 8 · next Fri Oct 9');
    const start = [...el.querySelectorAll('button')].find(b => b.textContent!.includes('Start this trip')) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });
});

describe('startTripFromGateway', () => {
  it('uses the search hub and dates', () => {
    configure();
    const trips = TestBed.inject(TripsService);
    const { gateways } = reach();
    const lis = gateways.find(g => g.code === 'LIS')!;
    const r = startTripFromGateway(trips, { place: SEVILLE_PLACE, params: PARAMS, gateway: lis, itinerary: lis.itineraries[0], others: gateways });
    const trip = trips.trip(r.tripId)!;
    expect(trip.fromHub).toBe('YUL');
    expect(trip.outboundDate).toBe('2026-10-08');
    const ground = trip.legs.find(l => l.id === r.groundLegId)!;
    expect(ground).toMatchObject({ kind: 'ground', mode: 'bus', provenance: 'estimated' });
  });
});
