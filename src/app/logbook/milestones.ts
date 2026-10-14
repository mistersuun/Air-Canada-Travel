/**
 * Logbook milestones: plain factual badges ("First transatlantic", "10
 * airports") with the date they were earned. Computed from the boarded
 * flights every time, oldest first (red-eye lives in the logbook's Marks), so they never drift from the log. No
 * points, levels or streaks; an unearned milestone is simply absent.
 */
import { type BoardedFlight, airportInfo } from './logbook';

export type MilestoneId =
  | 'transatlantic' | 'transpacific' | 'airports10' | 'airports25' | 'countries5' | 'countries10'
  | 'km10k' | 'km50k' | 'km100k';

export interface Milestone {
  id: MilestoneId;
  label: string;
  /** A fact about what earned it ('YYZ → LIS', '10 airports'). */
  detail: string;
  /** Date of the flight that earned it (YYYY-MM-DD). */
  dateKey: string;
  /** Instance key of that flight, so a trip can tell which milestones it earned. */
  flightKey: string;
}

const ATLANTIC_W = -30;
const PACIFIC_E = 100;

/** One end in the Americas, the other in Europe, Africa or the Middle East. */
export function isTransatlantic(origin: string, dest: string): boolean {
  const a = airportInfo(origin);
  const b = airportInfo(dest);
  if (!a || !b) return false;
  const west = (x: { lng: number }) => x.lng <= ATLANTIC_W && x.lng >= -125;
  const east = (x: { lng: number }) => x.lng > ATLANTIC_W && x.lng <= 60;
  return (west(a) && east(b)) || (west(b) && east(a));
}

/** One end in the Americas, the other in Asia or Oceania. */
export function isTranspacific(origin: string, dest: string): boolean {
  const a = airportInfo(origin);
  const b = airportInfo(dest);
  if (!a || !b) return false;
  const americas = (x: { lng: number }) => x.lng <= ATLANTIC_W && x.lng >= -170;
  const asia = (x: { lng: number }) => x.lng >= PACIFIC_E;
  return (americas(a) && asia(b)) || (americas(b) && asia(a));
}

const KM_STEPS: [MilestoneId, number, string][] = [
  ['km10k', 10_000, '10,000 km flown'], ['km50k', 50_000, '50,000 km flown'], ['km100k', 100_000, '100,000 km flown'],
];
const AIRPORT_STEPS: [MilestoneId, number][] = [['airports10', 10], ['airports25', 25]];
const COUNTRY_STEPS: [MilestoneId, number][] = [['countries5', 5], ['countries10', 10]];

const LABELS: Record<MilestoneId, string> = {
  transatlantic: 'First transatlantic', transpacific: 'First transpacific',
  airports10: '10 airports', airports25: '25 airports', countries5: '5 countries', countries10: '10 countries',
  km10k: '10,000 km', km50k: '50,000 km', km100k: '100,000 km'
};

/** Label for an id. */
export function milestoneLabel(id: MilestoneId): string {
  return LABELS[id];
}

/** Earned milestones, in the order they were earned. */
export function milestones(flights: readonly BoardedFlight[]): Milestone[] {
  const sorted = [...flights].sort((a, b) => a.dateKey.localeCompare(b.dateKey) || (a.depLocal ?? '').localeCompare(b.depLocal ?? '') || a.key.localeCompare(b.key));
  const out: Milestone[] = [];
  const got = new Set<MilestoneId>();
  const add = (id: MilestoneId, f: BoardedFlight, detail: string): void => {
    if (got.has(id)) return;
    got.add(id);
    out.push({ id, label: LABELS[id], detail, dateKey: f.dateKey, flightKey: f.key });
  };
  const airports = new Set<string>();
  const countries = new Set<string>();
  let km = 0;
  for (const f of sorted) {
    const route = `${f.origin} → ${f.dest}`;
    if (isTransatlantic(f.origin, f.dest)) add('transatlantic', f, route);
    if (isTranspacific(f.origin, f.dest)) add('transpacific', f, route);
    for (const c of [f.origin, f.dest]) {
      const a = airportInfo(c);
      if (!a) continue;
      airports.add(c);
      countries.add(a.iso2);
    }
    for (const [id, n] of AIRPORT_STEPS) if (airports.size >= n) add(id, f, `${n} airports`);
    for (const [id, n] of COUNTRY_STEPS) if (countries.size >= n) add(id, f, `${n} countries`);
    km += f.km ?? 0;
    for (const [id, n, text] of KM_STEPS) if (km >= n) add(id, f, text);
  }
  return out;
}
