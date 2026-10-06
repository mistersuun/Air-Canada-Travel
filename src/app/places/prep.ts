/**
 * The trip's "Before you go" checklist, built from the actual route: entry
 * reminders for every country the route touches (connections included),
 * listing reminders per flight leg, and "find the real train/bus" for each
 * ground leg. Pure.
 */
import { monthsBetween, typicalForMonths } from '../recs/climate';
import type { ClimateIndex } from '../recs/model';
import { currencyName } from '../pages/destination/currency';
import type { FlightLeg, FlightRef, GroundLeg, LegEnd, LegStatus, Trip } from '../trips/model';
import { calendarKey, isFinalStatus } from '../trips/model';
import { hubDisplayName, tzDiffLabel } from '../ui/format';
import { airportTz, findDestination, findHub } from '../utils/airports';
import { greatCircleKm } from '../utils/geo';
import { acAirports, countryName } from './place';
import { ENTRY_RULES, EntryRule, SCHENGEN, TRAVEL_GC_SLUG_OVERRIDES } from './prep-rules';

export interface PrepItem {
  id: string;               // 'entry:etias', 'list:<legId>:<i>', 'checkin:<legId>', 'ground:<legId>', 'custom:<id>'
  title: string; detail: string | null; link: { label: string; url: string } | null;
  critical: boolean;        // entry and listing items: true; info: false
  source: 'manual' | 'legStatus';  // 'legStatus' items are ticked by setting the leg status, not stored in trip.prep
  done: boolean;
}

const HOME = 'CA';
/** A ground-leg end without an airport code this close to the goal is in the goal's country. */
const NEAR_GOAL_KM = 80;
/** Otherwise the country of the nearest AC airport within this distance. */
const NEAR_AIRPORT_KM = 150;

function codeCountry(code: string): string | null {
  return findDestination(code)?.iso2 ?? (findHub(code) ? HOME : null);
}

function endCountry(end: LegEnd, trip: Trip): string | null {
  if (end.code) {
    const c = codeCountry(end.code);
    if (c) return c;
  }
  if (trip.goal.iso2 && greatCircleKm(end, trip.goal) <= NEAR_GOAL_KM) return trip.goal.iso2;
  let best: { iso2: string; km: number } | null = null;
  for (const a of acAirports()) {
    const km = greatCircleKm(end, a);
    if (km <= NEAR_AIRPORT_KM && (!best || km < best.km)) best = { iso2: a.iso2, km };
  }
  return best?.iso2 ?? null;
}

/**
 * Countries (ISO alpha-2) the trip touches, in route order: every flight
 * segment's origin and destination (so a connection through LHR adds GB),
 * every ground leg's ends, then the goal. Abandoned legs are skipped;
 * backups are not part of the route.
 */
export function routeCountries(trip: Trip): string[] {
  const out: string[] = [];
  const add = (c: string | null | undefined) => {
    if (c && !out.includes(c)) out.push(c);
  };
  for (const leg of trip.legs) {
    if (leg.status === 'abandoned') continue;
    if (leg.kind === 'flight') {
      for (const r of leg.refs) {
        add(codeCountry(r.origin));
        add(codeCountry(r.dest));
      }
    } else {
      add(endCountry(leg.from, trip));
      add(endCountry(leg.to, trip));
    }
  }
  add(trip.goal.iso2 || null);
  return out;
}

/** 'Spain', 'Spain and Portugal', 'Spain, France and Italy'. */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** travel.gc.ca slug: 'ES' → 'spain', 'DO' → 'dominican-republic'. */
export function travelGcSlug(iso2: string): string {
  const o = TRAVEL_GC_SLUG_OVERRIDES[iso2];
  if (o) return o;
  return countryName(iso2)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function fill(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

function entryItem(trip: Trip, rule: EntryRule, id: string, vars: Record<string, string>): PrepItem {
  return {
    id,
    title: fill(rule.title, vars),
    detail: fill(rule.detail, vars),
    link: { label: rule.linkLabel, url: fill(rule.url, vars) },
    critical: rule.critical,
    source: 'manual',
    done: !!trip.prep[id]?.done,
  };
}

/** Entry reminders for a Canadian passport, in ENTRY_RULES order (country-advice per country, route order). */
export function entryItems(trip: Trip, opts: { info?: boolean } = {}): PrepItem[] {
  const countries = routeCountries(trip).filter(c => c !== HOME);
  const schengen = countries.filter(c => SCHENGEN.includes(c));
  const out: PrepItem[] = [];
  for (const rule of ENTRY_RULES) {
    if (!rule.critical && !opts.info) continue;
    const id = `entry:${rule.id}`;
    switch (rule.appliesTo) {
      case 'schengen':
        if (schengen.length) {
          out.push(entryItem(trip, rule, id, {
            countries: joinNames(schengen.map(countryName)),
            slug: travelGcSlug(schengen[0]),
          }));
        }
        break;
      case 'GB':
      case 'US':
      case 'MX':
        if (countries.includes(rule.appliesTo)) out.push(entryItem(trip, rule, id, { slug: travelGcSlug(rule.appliesTo) }));
        break;
      case 'other':
        for (const c of countries) {
          if (SCHENGEN.includes(c) || c === 'GB' || c === 'US' || c === 'MX') continue;
          out.push(entryItem(trip, rule, `${id}:${c}`, { country: countryName(c), slug: travelGcSlug(c) }));
        }
        break;
    }
  }
  return out;
}

/** Info-only entry notes (EES), not counted in the checklist. */
export function entryInfo(trip: Trip): PrepItem[] {
  return entryItems(trip, { info: true }).filter(i => !i.critical);
}

const isOpen = (leg: { status: LegStatus }) => !isFinalStatus(leg.status);

/**
 * 'Calendar reminder added' only for a flight that is in the exported file
 * with these times; a flight added, swapped or retimed since says so.
 */
function calendarDetail(trip: Trip, r: FlightRef): string | null {
  if (!trip.calendarExportedAt || !trip.calendarRefs) return null;
  return trip.calendarRefs.includes(calendarKey(r)) ? 'Calendar reminder added' : 'Not in your calendar yet · export again';
}

function listingItems(trip: Trip, leg: FlightLeg): PrepItem[] {
  const done = leg.status !== 'planned';
  return leg.refs.map((r, i) => {
    const home = leg.role === 'return' ? ' home' : '';
    return {
      id: `list:${leg.id}:${i}`,
      title: `${done ? 'Listed' : 'List'} for ${r.flightNumber}${home}`,
      detail: done ? null : calendarDetail(trip, r),
      link: null,
      critical: true,
      source: 'legStatus' as const,
      done,
    };
  });
}

function checkInItem(leg: FlightLeg): PrepItem {
  const first = leg.refs[0];
  return {
    id: `checkin:${leg.id}`,
    title: `Check in${first ? ` for ${first.flightNumber}` : ''}`,
    detail: "Before your pass's cutoff",
    link: null,
    critical: true,
    source: 'legStatus',
    done: leg.status === 'checkedIn' || leg.status === 'boarded',
  };
}

const MODE_WORD: Record<GroundLeg['mode'], string> = {
  train: 'train', bus: 'bus', car: 'ride', ferry: 'ferry', flight: 'flight', other: 'connection',
};

function groundItem(leg: GroundLeg): PrepItem {
  const done = leg.provenance === 'saved';
  return {
    id: `ground:${leg.id}`,
    title: `Find the ${leg.from.name} → ${leg.to.name} ${MODE_WORD[leg.mode] ?? 'connection'}`,
    detail: done ? 'Saved by you' : 'Only estimated so far',
    link: null,
    critical: false,
    source: 'legStatus',
    done,
  };
}

/** The goal's AC code, else where the last flight leg lands. */
function weatherCode(trip: Trip): string | null {
  if (trip.goal.acCode) return trip.goal.acCode;
  for (let i = trip.legs.length - 1; i >= 0; i--) {
    const leg = trip.legs[i];
    if (leg.kind === 'flight' && leg.refs.length) return leg.refs[leg.refs.length - 1].dest;
  }
  return null;
}

/** 'Typical 8° / 2°, 14 wet days — pack a rain layer' for the trip's months; nothing without normals. Not critical. */
export function weatherItems(trip: Trip, climate: ClimateIndex | null | undefined): PrepItem[] {
  const t = typicalForMonths(climate, weatherCode(trip), monthsBetween(trip.outboundDate, trip.homeBy.dateKey));
  if (!t) return [];
  const id = 'weather:typical';
  return [{
    id,
    title: t.advice.length ? `${t.text} — pack ${t.advice.join(' and ')}` : t.text,
    detail: 'Typical for these months, not a forecast',
    link: null,
    critical: false,
    source: 'manual',
    done: !!trip.prep[id]?.done,
  }];
}

/**
 * The checklist: entry items, then listing items (leg order), then ground
 * items (leg order), then the user's own items. Final legs (boarded, not
 * boarded, didn't try, dropped) add nothing. Check-in items are not part of
 * it (see legPrepItems).
 */
export function buildPrepChecklist(trip: Trip, climate?: ClimateIndex | null): PrepItem[] {
  const listing: PrepItem[] = [];
  const ground: PrepItem[] = [];
  for (const leg of trip.legs) {
    if (!isOpen(leg)) continue;
    if (leg.kind === 'flight') listing.push(...listingItems(trip, leg));
    else ground.push(groundItem(leg));
  }
  const custom: PrepItem[] = trip.customPrep.map(c => ({
    id: `custom:${c.id}`, title: c.text, detail: null, link: null, critical: false, source: 'manual',
    done: !!trip.prep[`custom:${c.id}`]?.done,
  }));
  return [...entryItems(trip), ...listing, ...ground, ...weatherItems(trip, climate), ...custom];
}

/** One leg's own to-dos (Today's "Left to do"): listing and check-in for a flight, finding the ride for a ground leg. */
export function legPrepItems(trip: Trip, legId: string): PrepItem[] {
  const leg = trip.legs.find(l => l.id === legId);
  if (!leg || !isOpen(leg)) return [];
  if (leg.kind === 'ground') return [groundItem(leg)];
  return [...listingItems(trip, leg), checkInItem(leg)];
}

/** 'Euro' and '+6h vs Montréal' for the Prep tab tiles ('' when unknown). */
export function tripEssentials(trip: Trip, nowMs: number): { currency: string; timeDiff: string } {
  const currency = currencyName(trip.goal.iso2);
  const tz = trip.goal.tz;
  const timeDiff = tz ? `${tzDiffLabel(tz, airportTz(trip.homeAirport), nowMs)} vs ${hubDisplayName(trip.homeAirport)}` : '';
  return { currency, timeDiff };
}
