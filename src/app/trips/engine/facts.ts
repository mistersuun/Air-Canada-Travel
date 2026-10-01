/**
 * Schedule facts for one route and day (spec §2.6): departures, the last one,
 * aircraft, the next day and nearby holidays. Facts only, never odds.
 */
import { isCovered } from '../../data/schedule-index';
import { aircraftName } from '../../utils/aircraft';
import { addDays } from '../../utils/time';
import { FlightInstance, coverageHubFor, flightsOn } from '../../utils/week';
import { Holiday, holidaysNear } from './holidays';

export interface ScheduleFacts {
  covered: boolean;
  departures: FlightInstance[];          // direct, sorted
  last: FlightInstance | null;
  aircraft: { code: string; name: string; count: number }[];  // aircraftName() from utils/aircraft
  nextDay: { dateKey: string; count: number; covered: boolean };
  holidays: Holiday[];                   // holidaysNear(dateKey, 3)
}

/** 'A330-300' for '333' (the maker's name dropped, for compact tiles). */
export function shortAircraftName(code: string): string {
  return aircraftName(code).replace(/^(Airbus|Boeing|Bombardier|Embraer|De Havilland)\s+/, '');
}

export function scheduleFacts(origin: string, dest: string, dateKey: string): ScheduleFacts {
  const hub = coverageHubFor(origin, dest) ?? origin;
  const covered = isCovered(dateKey, hub);
  const departures = covered ? [...flightsOn(origin, dest, dateKey)] : [];
  const counts = new Map<string, number>();
  for (const f of departures) if (f.aircraft) counts.set(f.aircraft, (counts.get(f.aircraft) ?? 0) + 1);
  const next = addDays(dateKey, 1);
  const nextCovered = isCovered(next, hub);
  return {
    covered,
    departures,
    last: departures[departures.length - 1] ?? null,
    aircraft: [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code, count]) => ({ code, name: shortAircraftName(code), count })),
    nextDay: { dateKey: next, count: nextCovered ? flightsOn(origin, dest, next).length : 0, covered: nextCovered },
    holidays: holidaysNear(dateKey, 3),
  };
}
