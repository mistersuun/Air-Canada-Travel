/**
 * View-model helpers shared by the flight modal and its sub-components.
 * Pure functions only: the components stay thin and the logic is testable.
 */
import type { Itinerary } from '../../utils/connections';
import type { Coverage } from '../../data/schedule-index';
import { WEEKDAY_LONG, WEEKDAY_SHORT, formatKey, weekdayIndex } from '../../utils/time';

/** One day of the Outbound tab. */
export interface OutboundDay {
  dateKey: string;
  /** Beyond the published window: unknown, never "no flights". */
  outside: boolean;
  /** Direct itineraries (one leg), ranked. */
  direct: Itinerary[];
  /** One-stop itineraries, ranked (empty when connections are off). */
  connections: Itinerary[];
  isToday: boolean;
  isSelected: boolean;
  isPast: boolean;
}

/** Stable identity for an itinerary (tracking, expansion state, DOM ids). */
export function itinKey(it: Itinerary): string {
  return it.legs.map(l => `${l.flightNumber ?? 'EST'}${l.origin}${l.dest}${l.depUtc}`).join('_');
}

/** DOM-safe id fragment. */
export function domId(prefix: string, key: string): string {
  return `${prefix}-${key.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

/** 'Wed, Oct 7'. */
export function shortDay(key: string): string {
  return formatKey(key, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** 'Wednesday, October 7'. */
export function longDay(key: string): string {
  return `${WEEKDAY_LONG[weekdayIndex(key)]}, ${formatKey(key, { month: 'long', day: 'numeric' })}`;
}

/** True when the date is outside the hub's published window (null bounds = open). */
export function isOutside(key: string, coverage: Coverage | null | undefined): boolean {
  if (!coverage) return false;
  return (!!coverage.from && key < coverage.from) || (!!coverage.to && key > coverage.to);
}

/** 'AC 864' for display (the data stores 'AC864'). */
export function prettyFlight(n: string | null): string {
  return n ? n.replace(/^([A-Z]{2})\s*(\d)/, '$1 $2') : '';
}

/** '3d 22h', '22h', '45m': time on the ground at the destination. */
export function formatStay(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return `${h}h`;
  return `${min % 60}m`;
}

/** 'Daily', 'Mon Wed Fri' or '' from the date keys that have a flight. */
export function operatesLabel(keys: readonly string[]): string {
  const idx = [...new Set(keys.map(weekdayIndex))].sort((a, b) => a - b);
  if (idx.length === 7) return 'Daily';
  return idx.map(i => WEEKDAY_SHORT[i]).join(' ');
}

/** 'Direct', '1 stop · YYZ', '2 stops · YYZ YUL'. */
export function stopsLabel(it: Itinerary): string {
  if (!it.hubs.length) return 'Direct';
  return `${it.hubs.length} stop${it.hubs.length > 1 ? 's' : ''} · ${it.hubs.join(' ')}`;
}
