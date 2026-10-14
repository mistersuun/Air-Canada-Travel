/**
 * Listing windows. Listing is the traveller's own step (nothing here lists
 * anything): this only says when the window the traveller chose in Settings
 * (hours before departure, default 48) opens for a flight leg that is still
 * Planned. Facts only: no odds, no deadlines the airline did not publish.
 */
import type { TimeFormat } from '../../state/prefs.service';
import { airportTz } from '../../utils/airports';
import { MINUTE_MS, WEEKDAY_SHORT, formatClock, utcToLocal, weekdayIndex } from '../../utils/time';
import { FlightLeg, Trip } from '../model';
import { refDepUtc } from './legs';

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

export interface ListingChip {
  /** 'Listing open' or 'Listing opens Thu 14:30' (local to the departure airport). */
  label: string;
  open: boolean;
  opensUtc: number;
}

/** The chip for one leg: only a Planned flight that has not left, whose window is open or opens soon. */
export function listingChip(leg: FlightLeg, nowMs: number, hours: number, fmt: TimeFormat = '24h'): ListingChip | null {
  if (leg.status !== 'planned' || !leg.refs.length) return null;
  const ref = leg.refs[0];
  const dep = refDepUtc(ref);
  if (dep <= nowMs) return null;
  const opensUtc = listingOpensUtc(dep, hours);
  if (nowMs >= opensUtc) return { label: 'Listing open', open: true, opensUtc };
  if (opensUtc - nowMs > LISTING_SOON_HOURS * HOUR_MS) return null;
  const at = utcToLocal(opensUtc, airportTz(ref.origin));
  return { label: `Listing opens ${WEEKDAY_SHORT[weekdayIndex(at.dateKey)]} ${formatClock(at.hhmm, fmt)}`, open: false, opensUtc };
}

/** Planned flight legs that have not left, whose window opened after `sinceMs` and by `nowMs`. */
export function listingOpenedSince(trips: readonly Trip[], sinceMs: number, nowMs: number, hours: number): { trip: Trip; leg: FlightLeg }[] {
  const out: { trip: Trip; leg: FlightLeg }[] = [];
  for (const trip of trips) {
    if (trip.archived) continue;
    for (const leg of trip.legs) {
      if (leg.kind !== 'flight' || leg.status !== 'planned' || !leg.refs.length) continue;
      const dep = refDepUtc(leg.refs[0]);
      const opens = listingOpensUtc(dep, hours);
      if (dep > nowMs && opens > sinceMs && opens <= nowMs) out.push({ trip, leg });
    }
  }
  return out;
}
