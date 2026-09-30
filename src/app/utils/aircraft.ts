import { getAircraftCodes } from '../data/schedule-index';

/** IATA equipment families that are twin-aisle (A330/340/350/380, 747/767/777/787). */
const WIDEBODY_RE = /^(33|34|35|38|74|76|77|78)/;

export function isWidebody(code: string | null | undefined): boolean {
  return !!code && WIDEBODY_RE.test(code);
}

/**
 * Widebody codes actually present in the schedules (critique 36: derived from
 * the data, e.g. 77W, 77L, 788, 789, 333), recomputed on each call so it follows
 * the current schedule source.
 */
export function widebodyCodes(): string[] {
  return getAircraftCodes().filter(isWidebody);
}

/** Widebody codes in the generated data at load time. */
export const WIDEBODY: readonly string[] = widebodyCodes();

const NAMES: Record<string, string> = {
  '223': 'Airbus A220-300',
  '319': 'Airbus A319',
  '320': 'Airbus A320',
  '321': 'Airbus A321',
  '32Q': 'Airbus A321neo',
  '333': 'Airbus A330-300',
  '77L': 'Boeing 777-200LR',
  '77W': 'Boeing 777-300ER',
  '788': 'Boeing 787-8',
  '789': 'Boeing 787-9',
  '7M8': 'Boeing 737 MAX 8',
  'CR9': 'Bombardier CRJ900',
  'DH4': 'De Havilland Dash 8-400',
  'E75': 'Embraer E175',
};

/** Human name for an IATA equipment code; the code itself when unknown. */
export function aircraftName(code: string | null | undefined): string {
  if (!code) return '';
  return NAMES[code] ?? code;
}
