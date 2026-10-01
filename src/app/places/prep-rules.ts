/**
 * Entry reminders for a Canadian passport, hand-kept. Every row is a
 * reminder to check an official page, never a verdict ("you need" / "you
 * don't need"). Re-check the rows and links when `reviewed` is over six
 * months old.
 *
 * Deliberately absent: ESTA (US) and eTA (Canada) do not apply to Canadian
 * citizens. ETIAS is always "check status" (not "apply") until it is in force.
 */

/** Schengen area members (2026), ISO 3166-1 alpha-2. */
export const SCHENGEN: readonly string[] = [
  'AT', 'BE', 'CH', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IS', 'IT', 'LI', 'LT', 'LU',
  'LV', 'MT', 'NL', 'NO', 'PL', 'PT', 'SE', 'SI', 'SK', 'BG', 'RO',
];

export type EntryRuleId = 'schengen-validity' | 'etias' | 'ees' | 'uk-eta' | 'us-entry' | 'mx-entry' | 'country-advice';

export interface EntryRule {
  id: EntryRuleId;
  /** Which countries on the route trigger it ('other' = any country no other rule covers, except Canada). */
  appliesTo: 'schengen' | 'GB' | 'US' | 'MX' | 'other';
  /** {countries} = the matching countries ('Spain and Portugal'); {country} = one country. */
  title: string;
  detail: string;
  /** {slug} = travel.gc.ca slug of the (first) matching country. */
  url: string;
  linkLabel: string;
  /** Travel-critical (shown first); info rows are not. */
  critical: boolean;
  reviewed: string;
}

const R = '2026-10';

export const ENTRY_RULES: readonly EntryRule[] = [
  {
    id: 'schengen-validity', appliesTo: 'schengen', critical: true, reviewed: R,
    title: 'Passports valid 3+ months after you leave', detail: 'Schengen rule · {countries}',
    url: 'https://travel.gc.ca/destinations/{slug}', linkLabel: 'Government of Canada advice',
  },
  {
    id: 'etias', appliesTo: 'schengen', critical: true, reviewed: R,
    title: 'Check ETIAS status', detail: 'Official EU page · not required until it starts',
    url: 'https://travel-europe.europa.eu/etias_en', linkLabel: 'ETIAS (official EU page)',
  },
  {
    id: 'ees', appliesTo: 'schengen', critical: false, reviewed: R,
    title: 'Fingerprints and photo at the border (EES)', detail: 'First entry to the Schengen area',
    url: 'https://travel-europe.europa.eu/ees_en', linkLabel: 'EES (official EU page)',
  },
  {
    id: 'uk-eta', appliesTo: 'GB', critical: true, reviewed: R,
    title: 'Check UK ETA', detail: 'Needed for Canadians visiting or connecting landside',
    url: 'https://www.gov.uk/eta', linkLabel: 'UK ETA (GOV.UK)',
  },
  {
    id: 'us-entry', appliesTo: 'US', critical: true, reviewed: R,
    title: 'No ESTA for Canadian citizens', detail: 'Bring your passport; check entry rules',
    url: 'https://travel.gc.ca/destinations/united-states', linkLabel: 'Government of Canada advice',
  },
  {
    id: 'mx-entry', appliesTo: 'MX', critical: true, reviewed: R,
    title: 'Check Mexico entry rules', detail: 'Visa / electronic authorization rules changed in 2024 · check before you go',
    url: 'https://travel.gc.ca/destinations/mexico', linkLabel: 'Government of Canada advice',
  },
  {
    id: 'country-advice', appliesTo: 'other', critical: true, reviewed: R,
    title: 'Check entry rules for {country}', detail: 'Government of Canada travel advice',
    url: 'https://travel.gc.ca/destinations/{slug}', linkLabel: 'Government of Canada advice',
  },
];

/** travel.gc.ca slugs that do not follow from the English country name. */
export const TRAVEL_GC_SLUG_OVERRIDES: Readonly<Record<string, string>> = {
  US: 'united-states',
  GB: 'united-kingdom',
  HK: 'hong-kong',
  MO: 'macao',
  CZ: 'czechia',
  KR: 'south-korea',
  CI: 'cote-d-ivoire',
  TC: 'turks-and-caicos-islands',
  KN: 'saint-kitts-and-nevis',
  VC: 'saint-vincent-and-the-grenadines',
  AG: 'antigua-and-barbuda',
  TT: 'trinidad-and-tobago',
  SX: 'sint-maarten',
  AE: 'united-arab-emirates',
};
