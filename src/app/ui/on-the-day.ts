import { EXTRA_AIRPORTS, findDestination, isHub } from '../utils/airports';

export interface DayLink { id: 'ac' | 'weather' | 'faa'; href: string; labelKey: 'flight.onDay.ac' | 'flight.onDay.weather' | 'flight.onDay.faa' }

export const AC_HOME = 'https://www.aircanada.com/';   // i18n-ignore
export const ECCC_ALERTS = { en: 'https://weather.gc.ca/warnings/index_e.html', fr: 'https://weather.gc.ca/warnings/index_f.html' } as const;   // i18n-ignore
export const FAA_STATUS = 'https://nasstatus.faa.gov/';   // i18n-ignore

function countryOf(code: string): string | null {
  if (isHub(code)) return 'Canada';
  return findDestination(code)?.country ?? EXTRA_AIRPORTS[code]?.country ?? null;
}

/**
 * Outbound links for the day of travel. Air Canada's own site always; weather
 * alerts when an airport is in Canada; FAA status when one is in the US.
 */
export function onDayLinks(codes: readonly string[], lang: 'en' | 'fr'): DayLink[] {
  const countries = new Set(codes.map(countryOf));
  const out: DayLink[] = [{ id: 'ac', href: AC_HOME, labelKey: 'flight.onDay.ac' }];
  if (countries.has('Canada')) out.push({ id: 'weather', href: ECCC_ALERTS[lang], labelKey: 'flight.onDay.weather' });
  if (countries.has('USA')) out.push({ id: 'faa', href: FAA_STATUS, labelKey: 'flight.onDay.faa' });
  return out;
}
