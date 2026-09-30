import { isDateKey, weekStartKey } from '../utils/time';
import { isDestinationCode, isHubCode, isRegion } from './prefs.service';

/**
 * View state carried in the URL, e.g.
 *   ?from=YYZ&week=2026-10-05&day=2026-10-07&region=Europe&dest=LHR&q=lis
 *
 * Parsing ignores invalid values field by field, so a bad link degrades to the
 * saved preferences instead of breaking. `week` is normalised to its Monday and
 * always contains `day`.
 */
export interface UrlState {
  from?: string;
  week?: string;
  day?: string;
  region?: string;
  dest?: string;
  q?: string;
}

export const MAX_QUERY_LENGTH = 64;

export function parseUrlState(search: string): UrlState {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const out: UrlState = {};

  const from = p.get('from')?.toUpperCase();
  if (isHubCode(from)) out.from = from;

  const day = p.get('day');
  const week = p.get('week');
  if (isDateKey(day)) {
    out.day = day;
    out.week = weekStartKey(day);
  } else if (isDateKey(week)) {
    out.week = weekStartKey(week);
  }

  const region = p.get('region');
  if (isRegion(region)) out.region = region;

  const dest = p.get('dest')?.toUpperCase();
  if (isDestinationCode(dest)) out.dest = dest;

  const q = p.get('q')?.trim();
  if (q) out.q = q.slice(0, MAX_QUERY_LENGTH);

  return out;
}

/**
 * Serialise in a stable order. The caller decides which values are defaults
 * and leaves them out (e.g. the current week, region 'All').
 */
export function serializeUrlState(s: UrlState): string {
  const p = new URLSearchParams();
  if (s.from) p.set('from', s.from);
  if (s.week) p.set('week', s.week);
  if (s.day) p.set('day', s.day);
  if (s.region) p.set('region', s.region);
  if (s.dest) p.set('dest', s.dest);
  if (s.q) p.set('q', s.q);
  const str = p.toString();
  return str ? `?${str}` : '';
}
