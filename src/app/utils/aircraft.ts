import { t } from '../i18n/t';
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
  '32Q': 'Airbus A321XLR',
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

/**
 * Typical seat counts for Air Canada, Air Canada Rouge and Jazz / Air Canada
 * Express equipment, from published fleet configurations. These are typical
 * configurations, not a specific flight's: cabins vary by tail number. A code
 * with no entry shows no seat count.
 */
const SEATS: Record<string, number> = {
  '223': 137,
  '319': 136,
  '320': 168,
  '321': 196,
  '333': 297,
  '32Q': 182,
  '77L': 300,
  '77W': 400,
  '788': 255,
  '789': 298,
  '7M8': 169,
  'CR9': 76,
  'DH4': 78,
  'E75': 76,
};

/** Typical seat count for an equipment code, or null when not known. */
export function aircraftSeats(code: string | null | undefined): number | null {
  return (code && SEATS[code]) || null;
}

/** 'about 298 seats' for a known type, else ''. */
export function seatsLabel(code: string | null | undefined): string {
  const n = aircraftSeats(code);
  return n ? t('flight.seatsAbout', { n }) : '';
}

const MAKER_RE = /^(Airbus|Boeing|Bombardier|De Havilland|Embraer)\s+/;

/** 'Boeing 777-300ER' → '777-300ER', 'Airbus A330-300' → 'A330-300'. */
export function shortAircraft(code: string | null | undefined): string {
  return aircraftName(code).replace(MAKER_RE, '');
}

/** '787-9 · about 298 seats': the maker-less name plus the typical seat count (the ticket). */
export function aircraftWithSeats(code: string | null | undefined): string {
  return [shortAircraft(code), seatsLabel(code)].filter(Boolean).join(' · ');
}

/** 'A220-300 · 137 seats': the compact form for list rows. */
export function aircraftCompact(code: string | null | undefined): string {
  const n = aircraftSeats(code);
  return [shortAircraft(code), n ? t('flight.seats', { n }) : ''].filter(Boolean).join(' · ');
}

/** Human name for an IATA equipment code; the code itself when unknown. */
export function aircraftName(code: string | null | undefined): string {
  if (!code) return '';
  return NAMES[code] ?? code;
}
