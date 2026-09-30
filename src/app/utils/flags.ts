import { DESTINATIONS } from '../data/destinations';

const REGIONAL_INDICATOR_A = 0x1f1e6;

/** 'PT' → '🇵🇹' via regional-indicator code points; '' when not two letters. */
export function flagFromIso2(iso2: string | null | undefined): string {
  const code = (iso2 ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(
    REGIONAL_INDICATOR_A + code.charCodeAt(0) - 65,
    REGIONAL_INDICATOR_A + code.charCodeAt(1) - 65,
  );
}

const ISO_BY_COUNTRY = new Map<string, string>();
for (const d of DESTINATIONS) if (!ISO_BY_COUNTRY.has(d.country)) ISO_BY_COUNTRY.set(d.country, d.iso2);
ISO_BY_COUNTRY.set('Canada', 'CA');

/**
 * Flag emoji for a destination (`{ iso2 }`), an ISO alpha-2 code, or — for
 * legacy callers — a country name as used in DESTINATIONS.
 */
export function getFlag(input: string | { iso2: string } | null | undefined): string {
  if (!input) return '';
  if (typeof input !== 'string') return flagFromIso2(input.iso2);
  if (/^[A-Za-z]{2}$/.test(input)) return flagFromIso2(input);
  return flagFromIso2(ISO_BY_COUNTRY.get(input));
}
