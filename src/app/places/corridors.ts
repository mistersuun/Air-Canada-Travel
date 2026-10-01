/**
 * Hand-kept ground corridors from an AC gateway airport to a city that AC
 * does not fly to. Times are typical door-free ride times from public
 * timetables (rounded), and every result built from them is still labelled
 * Estimated: they are not live schedules. Re-check them when `reviewed` is
 * over a year old.
 *
 * exitMin covers passport control, leaving the airport and reaching the
 * station or coach stop the ride starts from.
 */
export interface Corridor {
  /** Gateway airport (IATA). */
  code: string;
  /** GeoNames id of the city. */
  geonameId: number;
  city: string;
  /** City centre, for matching legs that carry no GeoNames id. */
  lat: number;
  lng: number;
  mode: 'train' | 'bus';
  /** Shown instead of the mode word ('Eurostar'). */
  modeLabel?: string;
  rideMin: number;
  exitMin: number;
  exitLabel: string;
  /**
   * Station ↔ airport transfer alone (no passport or exit), used in the
   * reverse direction (goal → airport). Default: exitMin − CORRIDOR_EXIT_MIN.
   */
  transferMin?: number;
  frequency: string | null;
  /** Usual last departure, local at the gateway ('21:00'); null when not tracked. */
  lastDepLocal: string | null;
  shortFlightToo?: boolean;
  reviewed: string;
}

const R = '2026-10';

/** The passport-and-exit part of a corridor's exitMin (the rest is the transfer). */
export const CORRIDOR_EXIT_MIN = 45;

/** Minutes from the corridor's station to its airport (reverse direction). */
export function corridorTransferMin(row: Corridor): number {
  return row.transferMin ?? Math.max(0, row.exitMin - CORRIDOR_EXIT_MIN);
}

export const CORRIDORS: readonly Corridor[] = [
  { code: 'MAD', geonameId: 2510911, city: 'Seville', lat: 37.38, lng: -5.97, mode: 'train', rideMin: 160, exitMin: 90,
    exitLabel: 'Passport, exit, get to Atocha', frequency: 'trains roughly hourly', lastDepLocal: '21:00', reviewed: R },
  { code: 'LIS', geonameId: 2510911, city: 'Seville', lat: 37.38, lng: -5.97, mode: 'bus', rideMin: 405, exitMin: 75,
    exitLabel: 'Passport, exit, get to Oriente', frequency: 'a few buses a day', lastDepLocal: '15:00', reviewed: R },
  { code: 'BCN', geonameId: 2510911, city: 'Seville', lat: 37.38, lng: -5.97, mode: 'train', rideMin: 330, exitMin: 75,
    exitLabel: 'Passport, exit, get to Sants', frequency: 'a few direct trains a day', lastDepLocal: null,
    shortFlightToo: true, reviewed: R },
  { code: 'OPO', geonameId: 2510911, city: 'Seville', lat: 37.38, lng: -5.97, mode: 'bus', rideMin: 540, exitMin: 60,
    exitLabel: 'Passport, exit, get to the coach station', frequency: 'one or two buses a day', lastDepLocal: null, reviewed: R },
  { code: 'MAD', geonameId: 2517117, city: 'Granada', lat: 37.19, lng: -3.61, mode: 'train', rideMin: 200, exitMin: 90,
    exitLabel: 'Passport, exit, get to Atocha', frequency: 'a few trains a day', lastDepLocal: null, reviewed: R },
  { code: 'BCN', geonameId: 2509954, city: 'Valencia', lat: 39.47, lng: -0.38, mode: 'train', rideMin: 170, exitMin: 75,
    exitLabel: 'Passport, exit, get to Sants', frequency: 'trains every hour or two', lastDepLocal: null, reviewed: R },
  { code: 'LIS', geonameId: 2735943, city: 'Porto', lat: 41.15, lng: -8.61, mode: 'train', rideMin: 170, exitMin: 60,
    exitLabel: 'Passport, exit, get to Oriente', frequency: 'trains roughly hourly', lastDepLocal: null, reviewed: R },
  { code: 'BRU', geonameId: 2988507, city: 'Paris', lat: 48.85, lng: 2.35, mode: 'train', rideMin: 85, exitMin: 60,
    exitLabel: 'Passport, exit, get to Brussels-Midi', frequency: 'trains roughly hourly', lastDepLocal: null, reviewed: R },
  { code: 'LHR', geonameId: 2988507, city: 'Paris', lat: 48.85, lng: 2.35, mode: 'train', modeLabel: 'Eurostar', rideMin: 140,
    exitMin: 75, exitLabel: 'Passport, exit, get to St Pancras', frequency: 'Eurostar roughly hourly', lastDepLocal: null, reviewed: R },
  { code: 'CDG', geonameId: 2800866, city: 'Brussels', lat: 50.85, lng: 4.35, mode: 'train', rideMin: 85, exitMin: 60,
    exitLabel: 'Passport, exit, get to the airport TGV station', frequency: 'a few trains a day', lastDepLocal: null, reviewed: R },
  { code: 'AMS', geonameId: 2800866, city: 'Brussels', lat: 50.85, lng: 4.35, mode: 'train', rideMin: 110, exitMin: 45,
    exitLabel: 'Passport, exit, Schiphol station', frequency: 'trains roughly hourly', lastDepLocal: null, reviewed: R },
  { code: 'FCO', geonameId: 3172394, city: 'Naples', lat: 40.85, lng: 14.27, mode: 'train', rideMin: 70, exitMin: 90,
    exitLabel: 'Passport, exit, train to Roma Termini', frequency: 'trains several times an hour', lastDepLocal: null, reviewed: R },
  { code: 'MXP', geonameId: 3165524, city: 'Turin', lat: 45.07, lng: 7.69, mode: 'train', rideMin: 60, exitMin: 105, transferMin: 60,
    exitLabel: 'Passport, exit, Malpensa Express to Milano Centrale', frequency: 'trains roughly hourly', lastDepLocal: null, reviewed: R },
  { code: 'NCE', geonameId: 2993458, city: 'Monaco', lat: 43.74, lng: 7.42, mode: 'train', rideMin: 25, exitMin: 45,
    exitLabel: 'Passport, exit, get to Nice-Ville', frequency: 'trains several times an hour', lastDepLocal: null, reviewed: R },
  { code: 'LHR', geonameId: 2650225, city: 'Edinburgh', lat: 55.95, lng: -3.2, mode: 'train', rideMin: 270, exitMin: 75,
    exitLabel: "Passport, exit, get to King's Cross", frequency: 'trains roughly every half hour', lastDepLocal: null,
    shortFlightToo: true, reviewed: R },
  { code: 'DUB', geonameId: 2655984, city: 'Belfast', lat: 54.6, lng: -5.93, mode: 'bus', rideMin: 135, exitMin: 45,
    exitLabel: 'Passport, exit, get to the coach stop', frequency: 'buses roughly hourly', lastDepLocal: null, reviewed: R },
  { code: 'FRA', geonameId: 2886242, city: 'Cologne', lat: 50.93, lng: 6.95, mode: 'train', rideMin: 60, exitMin: 45,
    exitLabel: 'Passport, exit, get to the long-distance station', frequency: 'trains several times an hour', lastDepLocal: null, reviewed: R },
  { code: 'ZRH', geonameId: 2661604, city: 'Basel', lat: 47.56, lng: 7.57, mode: 'train', rideMin: 75, exitMin: 40,
    exitLabel: 'Passport, exit, get to the airport station', frequency: 'trains every half hour', lastDepLocal: null, reviewed: R },
  { code: 'VCE', geonameId: 3176959, city: 'Florence', lat: 43.78, lng: 11.25, mode: 'train', rideMin: 125, exitMin: 60,
    exitLabel: 'Passport, exit, bus to Venezia Mestre', frequency: 'trains roughly hourly', lastDepLocal: null, reviewed: R },
];
