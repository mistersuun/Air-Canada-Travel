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

import type { MsgKey } from '../i18n/t';

export type EntryRuleId = 'schengen-validity' | 'etias' | 'ees' | 'uk-eta' | 'us-entry' | 'mx-entry' | 'country-advice';

export interface EntryRule {
  id: EntryRuleId;
  /** Which countries on the route trigger it ('other' = any country no other rule covers, except Canada). */
  appliesTo: 'schengen' | 'GB' | 'US' | 'MX' | 'other';
  /** Catalogue keys; {countries} = the matching countries ('Spain and Portugal'); {country} = one country. */
  title: MsgKey;
  detail: MsgKey;
  /** {slug} = travel.gc.ca slug of the (first) matching country. */
  url: string;
  linkLabel: MsgKey;
  /** Travel-critical (shown first); info rows are not. */
  critical: boolean;
  reviewed: string;
}

const R = '2026-10';

export const ENTRY_RULES: readonly EntryRule[] = [
  {
    id: 'schengen-validity', appliesTo: 'schengen', critical: true, reviewed: R,
    title: 'places.entry.schengen.title', detail: 'places.entry.schengen.detail',
    url: 'https://travel.gc.ca/destinations/{slug}', linkLabel: 'places.entry.gcAdvice',
  },
  {
    id: 'etias', appliesTo: 'schengen', critical: true, reviewed: R,
    title: 'places.entry.etias.title', detail: 'places.entry.etias.detail',
    url: 'https://travel-europe.europa.eu/etias_en', linkLabel: 'places.entry.etias.link',
  },
  {
    id: 'ees', appliesTo: 'schengen', critical: false, reviewed: R,
    title: 'places.entry.ees.title', detail: 'places.entry.ees.detail',
    url: 'https://travel-europe.europa.eu/ees_en', linkLabel: 'places.entry.ees.link',
  },
  {
    id: 'uk-eta', appliesTo: 'GB', critical: true, reviewed: R,
    title: 'places.entry.ukEta.title', detail: 'places.entry.ukEta.detail',
    url: 'https://www.gov.uk/eta', linkLabel: 'places.entry.ukEta.link',
  },
  {
    id: 'us-entry', appliesTo: 'US', critical: true, reviewed: R,
    title: 'places.entry.usEntry.title', detail: 'places.entry.usEntry.detail',
    url: 'https://travel.gc.ca/destinations/united-states', linkLabel: 'places.entry.gcAdvice',
  },
  {
    id: 'mx-entry', appliesTo: 'MX', critical: true, reviewed: R,
    title: 'places.entry.mxEntry.title', detail: 'places.entry.mxEntry.detail',
    url: 'https://travel.gc.ca/destinations/mexico', linkLabel: 'places.entry.gcAdvice',
  },
  {
    id: 'country-advice', appliesTo: 'other', critical: true, reviewed: R,
    title: 'places.entry.countryAdvice.title', detail: 'places.entry.countryAdvice.detail',
    url: 'https://travel.gc.ca/destinations/{slug}', linkLabel: 'places.entry.gcAdvice',
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
