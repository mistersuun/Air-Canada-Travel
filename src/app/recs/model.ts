/**
 * Travel profile and on-device recommendations (extras spec §1.3).
 *
 * Everything here stays on the phone: the profile lives in localStorage
 * (PROFILE_KEY), is never in share links or backups, and the engine reads only
 * published schedules, the user's stars and the user's own outcome log.
 * Recommendations show counts and labelled facts, never odds; `rank` is an
 * internal sort key and is never rendered.
 */
import type { DestinationType } from '../data/destinations';
import type { FlightRef, Provenance } from '../trips/model';

export const PROFILE_KEY = 'ac.profile.v1';
export type TripStyle = Exclude<DestinationType, 'Hub'>;     // 'Sun' | 'City' | 'Adventure'
export type TripLength = 'day' | 'weekend' | 'week';

export interface TravelProfile {
  v: 1;
  styles: TripStyle[];           // [] = any
  length: TripLength | null;     // null = not set (engine uses 'weekend')
  maxFlightHours: number | null; // 1..12; null = any
  party: number;                 // 1..9, default 1
  days: number[];                // ISO weekdays 1..7 (Mon..Sun) you can usually leave or come back; [] = any
  onwardBudget: 'low' | 'any';   // default 'any'
  dismissed: string[];           // Recommendation ids, newest last, capped at 200
  updatedAt: string | null;      // null = never set up ("empty profile")
}

export type RecKind = 'holiday' | 'seasonEnding' | 'style' | 'yourLog' | 'onward' | 'weather';
export type ReasonKind = 'holiday' | 'profile' | 'starred' | 'log' | 'schedule';
export interface Reason { kind: ReasonKind; text: string }   // 'Holiday Monday', 'You travel Thu to Mon'
export type LineLabel = Provenance | 'typical';
export interface RecLine { text: string; label: LineLabel | null }

export interface ClimateMonth { month: number; tmaxC: number; tminC: number; precipMm: number; wetDays: number }

export interface Recommendation {
  id: string;                    // `${kind}:${code ?? placeId}:${out?.dateKey ?? ''}`, stable (used to dismiss)
  kind: RecKind;
  code: string | null;           // AC destination IATA
  placeId: string | null;        // 'gn-…' for 'onward'
  title: string;                 // 'Fort Lauderdale'
  out: { dateKey: string; flights: FlightRef[] } | null;   // Scheduled
  back: { dateKey: string; flights: FlightRef[] } | null;  // Scheduled
  lines: RecLine[];              // the fact lines, in display order
  weather: ClimateMonth | null;  // rendered '[Oct] 30° / 23°' + 'Typical' tag
  reason: Reason[];              // ≥ 1. Rendered as "Why this" + texts joined with '. ' + '.'
  link: { path: string[]; query: Record<string, string> };
  /** 'weather' only: destination typical high minus the hub's, in °C (shown as '+26° vs home'). */
  deltaC?: number;
  rank: number;                  // internal sort key; NEVER rendered
}

export interface RecGroup {
  id: string;                    // 'lw:2026-10-12', 'season', 'ideas'
  title: string;                 // 'Thanksgiving long weekend in 8 days' | 'Season ends soon' | 'Ideas for later'
  aside: string | null;          // 'Fri Oct 9 → Mon Oct 12'
  items: Recommendation[];
}

export interface ClimateFile {
  v: 1; source: string; license: 'CC BY 4.0'; attribution: string;
  period: string;                // '2021–2025'
  method: string;                // 'Mean of days 8–21 of each month'
  generatedAt: string;
  done: number; total: number;   // locations built / attempted (a partial build is allowed)
  codes: Record<string, { tmax: number[]; tmin: number[]; precip: number[]; wet: number[] }>; // 12 values each
}

/** Decoded climate.json: code → 12 months (index 0 = January). */
export interface ClimateIndex {
  attribution: string;
  period: string;
  byCode: ReadonlyMap<string, readonly ClimateMonth[]>;
}
