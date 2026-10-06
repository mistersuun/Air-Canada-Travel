import { afterEach, describe, expect, it } from 'vitest';
import { resetRouteNetworkSource, setRouteNetworkSource } from '../data/route-network';
import type { FlightLeg, FlightRef, LegStatus, Outcome, OutcomeKind, Trip } from '../trips/model';
import { sevilleTrip } from '../trips/testing/seville-fixture';
import { greatCircleKm } from '../utils/geo';
import {
  EARTH_CIRCUMFERENCE_KM, airportInfo, aroundEarthLabel, boardedFlights, logbookStats, recapLine, returnBoarded,
  standbyRecordLine, tripBoardedFlights, tripRecap,
} from './logbook';

afterEach(() => resetRouteNetworkSource());

function ref(flightNumber: string, origin: string, dest: string, dateKey: string, aircraft: string | null = '333'): FlightRef {
  return { flightNumber, origin, dest, dateKey, depLocal: '17:55', arrLocal: '06:50', arrDateKey: dateKey, aircraft };
}

function outcome(r: Pick<FlightRef, 'flightNumber' | 'origin' | 'dest' | 'dateKey'>, kind: OutcomeKind = 'allBoarded', tripId: string | null = null): Outcome {
  return { id: `o-${r.flightNumber}-${r.dateKey}`, ...r, kind, partySize: 1, tripId, note: '', recordedAt: '2026-10-01T00:00:00Z' };
}

function tripWith(legs: { refs: FlightRef[]; status: LegStatus; role?: FlightLeg['role'] }[]): Trip {
  const t = sevilleTrip();
  t.legs = legs.map((l, i) => ({
    kind: 'flight', id: `leg${i}`, role: l.role ?? 'outbound', status: l.status, statusAt: null, note: '',
    provenance: 'scheduled', refs: l.refs, alternates: [],
  }) as FlightLeg);
  return t;
}

const YUL_LIS = ref('AC812', 'YUL', 'LIS', '2026-10-08', '333');
const LIS_YUL = ref('AC813', 'LIS', 'YUL', '2026-10-13', '77W');

describe('airportInfo', () => {
  it('knows hubs, destinations and network airports', () => {
    expect(airportInfo('YUL')).toMatchObject({ city: 'Montreal', iso2: 'CA', region: 'Canada' });
    expect(airportInfo('LIS')).toMatchObject({ city: 'Lisbon', country: 'Portugal', region: 'Europe' });
    setRouteNetworkSource({
      version: 1, license: 'x', attribution: 'x', routes: {},
      airports: { YDF: ['Deer Lake', 'CA', 'America/St_Johns', 49.21, -57.39] },
    });
    expect(airportInfo('YDF')).toMatchObject({ city: 'Deer Lake', iso2: 'CA', lat: 49.21, lng: -57.39, region: 'Other' });
  });
  it('is null for an unknown code', () => {
    expect(airportInfo('ZZZ')).toBeNull();
  });
});

describe('boardedFlights', () => {
  it('is empty with nothing', () => {
    expect(boardedFlights(null, null)).toEqual([]);
    expect(boardedFlights({ outcomes: [] }, [])).toEqual([]);
  });

  it('counts only allBoarded and someBoarded outcomes', () => {
    const kinds: OutcomeKind[] = ['allBoarded', 'someBoarded', 'noneBoarded', 'didntTry'];
    const outcomes = kinds.map((k, i) => outcome(ref(`AC${i}`, 'YUL', 'LIS', '2026-10-08'), k));
    expect(boardedFlights({ outcomes }, []).map(f => f.flightNumber)).toEqual(['AC0', 'AC1']);
  });

  it('counts only boarded flight legs, and every segment of a one-stop leg', () => {
    const t = tripWith([
      { refs: [YUL_LIS], status: 'boarded' },
      { refs: [ref('AC1', 'YUL', 'YYZ', '2026-10-09'), ref('AC2', 'YYZ', 'LHR', '2026-10-09')], status: 'boarded' },
      { refs: [LIS_YUL], status: 'notBoarded' },
      { refs: [ref('AC9', 'YUL', 'MAD', '2026-10-20')], status: 'checkedIn' },
    ]);
    expect(tripBoardedFlights(t).map(f => f.flightNumber)).toEqual(['AC812', 'AC1', 'AC2']);
  });

  it('ignores ground legs', () => {
    const t = sevilleTrip();
    t.legs.forEach(l => { l.status = 'boarded'; });
    expect(tripBoardedFlights(t).map(f => f.flightNumber)).toEqual(['AC834', 'AC813']);
  });

  it('counts a flight once when an outcome and a leg share an instanceKey', () => {
    const t = tripWith([{ refs: [YUL_LIS], status: 'boarded' }]);
    const o = [outcome(YUL_LIS, 'allBoarded', t.id), outcome(YUL_LIS, 'someBoarded', null)];
    const all = boardedFlights({ outcomes: o }, [t]);
    expect(all).toHaveLength(1);
    // The leg's times and equipment win.
    expect(all[0].aircraft).toBe('333');
    expect(all[0].depLocal).toBe('17:55');
  });

  it('counts a flight once across two trips and repeated outcomes', () => {
    const a = tripWith([{ refs: [YUL_LIS], status: 'boarded' }]);
    const b = tripWith([{ refs: [YUL_LIS], status: 'boarded' }]);
    expect(boardedFlights({ outcomes: [outcome(YUL_LIS), outcome(YUL_LIS)] }, [a, b])).toHaveLength(1);
  });

  it('keeps the same flight number on different dates apart', () => {
    const o = [outcome(ref('AC812', 'YUL', 'LIS', '2026-10-08')), outcome(ref('AC812', 'YUL', 'LIS', '2026-10-09'))];
    expect(boardedFlights({ outcomes: o }, [])).toHaveLength(2);
  });

  it('fills outcome times and aircraft from the resolver', () => {
    const f = boardedFlights({ outcomes: [outcome(YUL_LIS)] }, [], () => ({
      aircraft: '789', depLocal: '21:45', arrLocal: '09:20', arrDateKey: '2026-10-09',
    }));
    expect(f[0]).toMatchObject({ aircraft: '789', depLocal: '21:45', arrDateKey: '2026-10-09' });
  });

  it('leaves times empty when nothing resolves', () => {
    const f = boardedFlights({ outcomes: [outcome(YUL_LIS)] }, [], () => null);
    expect(f[0]).toMatchObject({ aircraft: null, depLocal: null, arrDateKey: null });
  });

  it('sorts oldest first', () => {
    const o = [outcome(ref('AC2', 'YUL', 'LIS', '2026-11-01')), outcome(ref('AC1', 'YUL', 'LIS', '2026-10-01'))];
    expect(boardedFlights({ outcomes: o }, []).map(f => f.flightNumber)).toEqual(['AC1', 'AC2']);
  });

  it('has null km for an unknown airport', () => {
    const f = boardedFlights({ outcomes: [outcome(ref('AC1', 'YUL', 'ZZZ', '2026-10-01'))] }, []);
    expect(f[0].km).toBeNull();
  });
});

describe('outcomes versus legs', () => {
  const stop1 = ref('AC1', 'YUL', 'YYZ', '2026-10-09');
  const stop2 = ref('AC2', 'YYZ', 'LHR', '2026-10-09');

  it('skips a boarded outcome the leg contradicts (last segment of a not-boarded leg)', () => {
    const t = tripWith([{ refs: [stop1, stop2], status: 'notBoarded' }]);
    expect(boardedFlights({ outcomes: [outcome(stop2, 'allBoarded', t.id)] }, [t])).toEqual([]);
    expect(boardedFlights({ outcomes: [outcome(stop2, 'allBoarded', null)] }, [t])).toEqual([]);
  });
  it('keeps a boarded first segment of that leg', () => {
    const t = tripWith([{ refs: [stop1, stop2], status: 'notBoarded' }]);
    expect(boardedFlights({ outcomes: [outcome(stop1, 'allBoarded', t.id)] }, [t]).map(f => f.flightNumber)).toEqual(['AC1']);
  });
  it('keeps the outcome when the leg is still open or belongs to another trip', () => {
    const open = tripWith([{ refs: [stop1, stop2], status: 'checkedIn' }]);
    expect(boardedFlights({ outcomes: [outcome(stop2, 'allBoarded', open.id)] }, [open])).toHaveLength(1);
    const t = tripWith([{ refs: [stop1, stop2], status: 'notBoarded' }]);
    expect(boardedFlights({ outcomes: [outcome(stop2, 'allBoarded', 'other')] }, [t])).toHaveLength(1);
  });
  it('the recap folds in the trip own outcomes so it agrees with the logbook', () => {
    const t = tripWith([{ refs: [stop1], status: 'boarded' }]);
    const extra = outcome(stop2, 'allBoarded', t.id);
    expect(tripRecap(t).flights).toBe(1);
    expect(tripRecap(t, [extra]).flights).toBe(2);
    expect(tripRecap(t, [outcome(stop2, 'allBoarded', 'other')]).flights).toBe(1);
    expect(tripRecap(t, [extra]).flights).toBe(logbookStats({ outcomes: [extra] }, [t]).flights);
  });
});

describe('logbookStats', () => {
  it('is all zero for a new traveller', () => {
    const s = logbookStats({ outcomes: [] }, []);
    expect(s).toEqual({
      flights: 0, km: 0, aroundEarth: 0, countries: [], cities: [], longest: null, mostFlownRoute: null, aircraft: [],
    });
  });

  it('counts flights, km and the Earth fraction', () => {
    const t = tripWith([
      { refs: [YUL_LIS], status: 'boarded', role: 'outbound' },
      { refs: [LIS_YUL], status: 'boarded', role: 'return' },
    ]);
    const s = logbookStats({ outcomes: [] }, [t]);
    const one = greatCircleKm(airportInfo('YUL')!, airportInfo('LIS')!);
    expect(s.flights).toBe(2);
    expect(s.km).toBe(Math.round(one * 2));
    expect(s.aroundEarth).toBeCloseTo((one * 2) / EARTH_CIRCUMFERENCE_KM, 10);
    expect(s.km).toBeGreaterThan(10000);
    expect(s.km).toBeLessThan(11000);
  });

  it('counts countries and cities touched, home included', () => {
    const t = tripWith([
      { refs: [YUL_LIS], status: 'boarded' },
      { refs: [ref('AC1', 'LIS', 'MAD', '2026-10-10'), ref('AC2', 'MAD', 'YYZ', '2026-10-12')], status: 'boarded' },
    ]);
    const s = logbookStats({ outcomes: [] }, [t]);
    expect(s.countries.map(c => c.name)).toEqual(['Canada', 'Portugal', 'Spain']);
    expect(s.cities).toEqual(['Lisbon', 'Madrid', 'Montreal', 'Toronto']);
  });

  it('counts two Canadian hubs as one country', () => {
    const s = logbookStats({ outcomes: [outcome(ref('AC1', 'YUL', 'YYZ', '2026-10-01'))] }, []);
    expect(s.countries).toHaveLength(1);
    expect(s.cities).toEqual(['Montreal', 'Toronto']);
  });

  it('finds the longest flight', () => {
    const t = tripWith([
      { refs: [ref('AC1', 'YUL', 'YYZ', '2026-10-01'), YUL_LIS, ref('AC3', 'YYZ', 'YUL', '2026-10-03')], status: 'boarded' },
    ]);
    const s = logbookStats({ outcomes: [] }, [t]);
    expect(s.longest).toMatchObject({ origin: 'YUL', dest: 'LIS', flightNumber: 'AC812', dateKey: '2026-10-08' });
    expect(s.longest!.km).toBeGreaterThan(5000);
  });

  it('most-flown route counts both directions and needs two flights', () => {
    expect(logbookStats({ outcomes: [outcome(YUL_LIS)] }, []).mostFlownRoute).toBeNull();
    const t = tripWith([
      { refs: [YUL_LIS], status: 'boarded' },
      { refs: [LIS_YUL], status: 'boarded' },
      { refs: [ref('AC1', 'YUL', 'YYZ', '2026-11-01')], status: 'boarded' },
    ]);
    expect(logbookStats({ outcomes: [] }, [t]).mostFlownRoute).toEqual({ a: 'LIS', b: 'YUL', count: 2 });
  });

  it('breaks a most-flown tie by the longer route', () => {
    const t = tripWith([{
      refs: [
        ref('AC1', 'YUL', 'YYZ', '2026-11-01'), ref('AC1', 'YUL', 'YYZ', '2026-11-02'),
        ref('AC812', 'YUL', 'LIS', '2026-11-03'), ref('AC812', 'YUL', 'LIS', '2026-11-04'),
      ], status: 'boarded',
    }]);
    expect(logbookStats({ outcomes: [] }, [t]).mostFlownRoute).toMatchObject({ a: 'LIS', b: 'YUL', count: 2 });
  });

  it('lists aircraft types by count with their names, from legs and resolved outcomes', () => {
    const t = tripWith([
      { refs: [YUL_LIS, ref('AC2', 'LIS', 'MAD', '2026-10-09', '333')], status: 'boarded' },
      { refs: [LIS_YUL], status: 'boarded' },
      { refs: [ref('AC4', 'YUL', 'YYZ', '2026-10-20', null)], status: 'boarded' },
    ]);
    const s = logbookStats({ outcomes: [outcome(ref('AC5', 'YYZ', 'YUL', '2026-10-21'))] }, [t], () => ({
      aircraft: '223', depLocal: '10:00', arrLocal: '11:00', arrDateKey: '2026-10-21',
    }));
    expect(s.aircraft).toEqual([
      { code: '333', name: 'Airbus A330-300', count: 2 },
      { code: '223', name: 'Airbus A220-300', count: 1 },
      { code: '77W', name: 'Boeing 777-300ER', count: 1 },
    ]);
  });

  it('ignores flights that were not boarded', () => {
    const t = tripWith([{ refs: [YUL_LIS], status: 'notBoarded' }]);
    const s = logbookStats({ outcomes: [outcome(YUL_LIS, 'noneBoarded')] }, [t]);
    expect(s.flights).toBe(0);
  });

  it('keeps counting a flight with an unknown airport but not its km or places', () => {
    const s = logbookStats({ outcomes: [outcome(ref('AC1', 'ZZZ', 'YYY', '2026-10-01'))] }, []);
    expect(s).toMatchObject({ flights: 1, km: 0, longest: null, countries: [], cities: [] });
  });
});

describe('aroundEarthLabel', () => {
  it('formats to one decimal and hides tiny fractions', () => {
    expect(aroundEarthLabel(0)).toBe('');
    expect(aroundEarthLabel(0.04)).toBe('');
    expect(aroundEarthLabel(0.26)).toBe('0.3 × around the Earth');
    expect(aroundEarthLabel(1)).toBe('1.0 × around the Earth');
    expect(aroundEarthLabel(2.84)).toBe('2.8 × around the Earth');
  });
});

describe('trip recap', () => {
  const roundTrip = (out: LegStatus, back: LegStatus) => tripWith([
    { refs: [YUL_LIS], status: out, role: 'outbound' },
    { refs: [LIS_YUL], status: back, role: 'return' },
  ]);

  it('offers a recap only when a return flight is boarded', () => {
    expect(returnBoarded(roundTrip('boarded', 'boarded'))).toBe(true);
    expect(returnBoarded(roundTrip('boarded', 'planned'))).toBe(false);
    expect(returnBoarded(roundTrip('boarded', 'notBoarded'))).toBe(false);
    expect(returnBoarded(roundTrip('planned', 'boarded'))).toBe(true);
    expect(returnBoarded(sevilleTrip())).toBe(false);
  });

  it('counts flights, km, countries and standby tries', () => {
    const r = tripRecap(roundTrip('boarded', 'boarded'));
    expect(r.flights).toBe(2);
    expect(r.countries).toBe(2);
    expect(r.km).toBeGreaterThan(10000);
    expect(r).toMatchObject({ tries: 2, boarded: 2 });
  });

  it('tries include a leg that did not board, but not one dropped or not tried', () => {
    const t = tripWith([
      { refs: [YUL_LIS], status: 'notBoarded' },
      { refs: [ref('AC1', 'YUL', 'LIS', '2026-10-09')], status: 'boarded' },
      { refs: [ref('AC2', 'YUL', 'LIS', '2026-10-10')], status: 'abandoned' },
      { refs: [ref('AC3', 'YUL', 'LIS', '2026-10-11')], status: 'didntTry' },
      { refs: [LIS_YUL], status: 'boarded', role: 'return' },
    ]);
    expect(tripRecap(t)).toMatchObject({ flights: 2, tries: 3, boarded: 2 });
  });

  it('words the line with singulars and no booking detail', () => {
    expect(recapLine({ flights: 4, km: 11240, countries: 2 })).toBe('4 flights · 11,240 km · 2 countries');
    expect(recapLine({ flights: 1, km: 0, countries: 1 })).toBe('1 flight · 1 country');
    expect(standbyRecordLine({ tries: 4, boarded: 3 })).toBe('Boarded 3 of 4 tries');
    expect(standbyRecordLine({ tries: 1, boarded: 1 })).toBe('Boarded 1 of 1 try');
  });
});
