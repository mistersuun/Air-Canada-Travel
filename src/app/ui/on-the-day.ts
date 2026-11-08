import { EXTRA_AIRPORTS, findDestination, isHub } from '../utils/airports';

export interface DayLink { id: 'ac' | 'weather' | 'faa'; href: string; labelKey: 'flight.onDay.ac' | 'flight.onDay.weather' | 'flight.onDay.faa' }

/** Air Canada's Flight Information page (flight status lookup), checked 2026-11-08: 200 with its own title in both languages. */
export const AC_STATUS = {   // i18n-ignore
  en: 'https://www.aircanada.com/ca/en/aco/home/fly/flight-information.html',
  fr: 'https://www.aircanada.com/ca/fr/aco/home/fly/flight-information.html',
} as const;
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
  const out: DayLink[] = [{ id: 'ac', href: AC_STATUS[lang], labelKey: 'flight.onDay.ac' }];
  if (countries.has('Canada')) out.push({ id: 'weather', href: ECCC_ALERTS[lang], labelKey: 'flight.onDay.weather' });
  if (countries.has('USA')) out.push({ id: 'faa', href: FAA_STATUS, labelKey: 'flight.onDay.faa' });
  return out;
}
