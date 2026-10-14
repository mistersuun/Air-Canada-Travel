/**
 * Listing windows. Listing is the traveller's own step (nothing here lists
 * anything): this only says when the window the traveller chose in Settings
 * (hours before departure, default 48) opens for a flight leg that is still
 * Planned. Every flight segment of a leg is its own standby, so each segment
 * has its own window. Facts only: no odds, no deadlines the airline did not publish.
 */
import type { TimeFormat } from '../../state/prefs.service';
import { airportTz } from '../../utils/airports';
import { t } from '../../i18n/t';
import { MINUTE_MS, formatClock, tzOffsetMin, utcToLocal, weekdayIndex, weekdayShort } from '../../utils/time';
import { FlightLeg, FlightRef, Trip } from '../model';
import { ESTIMATED_FLIGHT, refDepUtc } from './legs';

const HOUR_MS = 60 * MINUTE_MS;

/** Hours before departure the listing reminder fires (calendar file, chip, notification). */
export const DEFAULT_LISTING_HOURS = 48;
export const LISTING_HOURS_OPTIONS: readonly number[] = [24, 48, 72, 96];
/** A window that opens within this many hours shows "Listing opens …" ahead of time. */
export const LISTING_SOON_HOURS = 24;

/** When the window opens for a departure, UTC ms. */
export function listingOpensUtc(depUtc: number, hours: number): number {
  return depUtc - hours * HOUR_MS;
}

/** Segments that can be listed for: a real flight number (not the Estimated placeholder). */
const listable = (r: FlightRef) => r.flightNumber !== ESTIMATED_FLIGHT;

export interface ListingChip {
  /** 'Listing open' or 'Listing opens Thu 14:30' (local to the departure airport, with its zone when that differs from the device). */
  label: string;
  open: boolean;
  opensUtc: number;
  refIndex: number;
}

/** True when the airport's clock differs from this device's at `ms` (the label then names the airport's zone). */
function differsFromDevice(origin: string, ms: number): boolean {
  const device = -new Date(ms).getTimezoneOffset();
  return tzOffsetMin(airportTz(origin), ms) !== device;
}

/**
 * The chip for a Planned flight leg: for the earliest segment that has not
 * left, "Listing open" once its window has opened, or "Listing opens …" when
 * it opens within a day. Nothing otherwise.
 */
export function listingChip(leg: FlightLeg, nowMs: number, hours: number, fmt: TimeFormat = '24h'): ListingChip | null {
  if (leg.status !== 'planned') return null;
  let best: { i: number; dep: number } | null = null;
  leg.refs.forEach((r, i) => {
    if (!listable(r)) return;
    const dep = refDepUtc(r);
    if (dep > nowMs && (!best || dep < best.dep)) best = { i, dep };
  });
  if (!best) return null;
  const { i, dep } = best as { i: number; dep: number };
  const ref = leg.refs[i];
  const opensUtc = listingOpensUtc(dep, hours);
  if (nowMs >= opensUtc) return { label: t('trips.listing.open'), open: true, opensUtc, refIndex: i };
  if (opensUtc - nowMs > LISTING_SOON_HOURS * HOUR_MS) return null;
  const at = utcToLocal(opensUtc, airportTz(ref.origin));
  const label = t(differsFromDevice(ref.origin, opensUtc) ? 'trips.listing.opensZone' : 'trips.listing.opens', {
    day: weekdayShort(weekdayIndex(at.dateKey)), time: formatClock(at.hhmm, fmt), code: ref.origin,
  });
  return { label, open: false, opensUtc, refIndex: i };
}

/** Segments of Planned flight legs that have not left, whose window opened after `sinceMs` and by `nowMs`. */
export function listingOpenedSince(trips: readonly Trip[], sinceMs: number, nowMs: number, hours: number): { trip: Trip; leg: FlightLeg; refIndex: number }[] {
  const out: { trip: Trip; leg: FlightLeg; refIndex: number }[] = [];
  for (const trip of trips) {
    if (trip.archived) continue;
    for (const leg of trip.legs) {
      if (leg.kind !== 'flight' || leg.status !== 'planned') continue;
      leg.refs.forEach((r, refIndex) => {
        if (!listable(r)) return;
        const dep = refDepUtc(r);
        const opens = listingOpensUtc(dep, hours);
        if (dep > nowMs && opens > sinceMs && opens <= nowMs) out.push({ trip, leg, refIndex });
      });
    }
  }
  return out;
}
