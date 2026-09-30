/**
 * iCalendar (.ics, RFC 5545) export for itineraries.
 *
 * - One VEVENT per published leg, timed in UTC (DTSTART/DTEND with a trailing
 *   Z), so every calendar app shows the right local time wherever it is.
 * - Estimated legs (invented domestic hub legs, critique 35) are never exported
 *   as timed events: they become all-day TENTATIVE, TRANSPARENT events that
 *   say "verify in the Air Canada app".
 * - Optional VALARM 24h before the first published leg of each itinerary
 *   (the check-in / listing reminder).
 * - CRLF line endings, text escaping and 75-octet line folding (UTF-8 safe).
 *
 * This is a schedule reminder, not a booking: every description says so.
 */
import type { Itinerary } from './connections';
import type { FlightInstance } from './week';
import { aircraftName } from './aircraft';
import { airportName } from './airports';
import { formatDayOffset, formatDuration } from './time';

export interface IcsOptions {
  /** Calendar name (X-WR-CALNAME). */
  calendarName?: string;
  /** Add a 24h-before reminder to the first published leg of each itinerary (default true). */
  alarm?: boolean;
  /** DTSTAMP; injectable for deterministic tests (default now). */
  now?: Date | number;
}

const CRLF = '\r\n';
const PRODID = '-//AC Travel Planner//Schedule export//EN';
const UID_DOMAIN = 'ac-travel-planner';

/** Escapes a TEXT value (RFC 5545 §3.3.11). */
export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Folds a content line at 75 octets (UTF-8), continuation lines starting with
 * one space. Never splits a multi-byte character.
 */
export function foldIcsLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(cur);
      cur = '';
      bytes = 0;
      limit = 74; // the leading space counts
    }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join(CRLF + ' ');
}

/** UTC instant → 20261007T021000Z. */
export function icsUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** '2026-10-07' → 20261007. */
function icsDate(key: string): string {
  return key.replace(/-/g, '');
}

function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function flightLabel(f: FlightInstance): string {
  return f.flightNumber ? f.flightNumber.replace(/^([A-Z]{2})\s*/, '$1') : 'Estimated leg';
}

function legSummary(f: FlightInstance): string {
  return f.estimated
    ? `Estimated domestic leg ${f.origin}→${f.dest} (verify)`
    : `${flightLabel(f)} ${f.origin}→${f.dest}`;
}

function legDescription(it: Itinerary, i: number): string {
  const f = it.legs[i];
  const lines: string[] = [];
  if (f.estimated) {
    lines.push(`Estimated leg ${f.origin} → ${f.dest}: not from published schedules.`);
    lines.push(`Around ${f.depLocal} local, about ${formatDuration(f.durationMin)}. Pick a real flight in the Air Canada app.`);
  } else {
    const plane = f.aircraft ? ` · ${aircraftName(f.aircraft)}` : '';
    lines.push(`Air Canada ${flightLabel(f)}${plane}`);
    const off = formatDayOffset(f.arrDayOffset);
    lines.push(`${f.origin} ${f.depLocal} → ${f.dest} ${f.arrLocal}${off ? ` (${off} day)` : ''}, local times · ${formatDuration(f.durationMin)}`);
  }
  if (i > 0) lines.push(`After a ${formatDuration(it.layovers[i - 1])} layover in ${airportName(f.origin)}.`);
  if (i < it.legs.length - 1) lines.push(`Then a ${formatDuration(it.layovers[i])} layover in ${airportName(f.dest)}.`);
  lines.push('Schedule only, not a booking: verify on the Air Canada app.');
  return lines.join('\n');
}

function uid(f: FlightInstance): string {
  return `${(f.flightNumber ?? 'EST').replace(/\s+/g, '')}-${f.origin}${f.dest}-${icsUtc(f.depUtc)}@${UID_DOMAIN}`;
}

function legEvent(it: Itinerary, i: number, stamp: string, alarm: boolean): string[] {
  const f = it.legs[i];
  const out = ['BEGIN:VEVENT', `UID:${uid(f)}`, `DTSTAMP:${stamp}`];
  if (f.estimated) {
    out.push(
      `DTSTART;VALUE=DATE:${icsDate(f.dateKey)}`,
      `DTEND;VALUE=DATE:${icsDate(addDaysKey(f.dateKey, 1))}`,
      'STATUS:TENTATIVE',
      'TRANSP:TRANSPARENT',
    );
  } else {
    out.push(`DTSTART:${icsUtc(f.depUtc)}`, `DTEND:${icsUtc(f.arrUtc)}`, 'STATUS:CONFIRMED', 'TRANSP:OPAQUE');
  }
  out.push(
    `SUMMARY:${escapeIcsText(legSummary(f))}`,
    `LOCATION:${escapeIcsText(`${airportName(f.origin)} (${f.origin})`)}`,
    `DESCRIPTION:${escapeIcsText(legDescription(it, i))}`,
  );
  if (alarm) {
    out.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT24H',
      `DESCRIPTION:${escapeIcsText(`Check in / list for ${flightLabel(f)} ${f.origin}→${f.dest}`)}`,
      'END:VALARM',
    );
  }
  out.push('END:VEVENT');
  return out;
}

/**
 * Builds a VCALENDAR for one itinerary or several (a round trip passes the
 * outbound and the return). Returns the text with CRLF line endings.
 */
export function buildIcs(input: Itinerary | readonly Itinerary[], destName = '', opts: IcsOptions = {}): string {
  const list: readonly Itinerary[] = Array.isArray(input) ? input : [input as Itinerary];
  const stamp = icsUtc(opts.now === undefined ? Date.now() : +opts.now);
  const alarm = opts.alarm ?? true;
  const name = opts.calendarName ?? (destName ? `Air Canada · ${destName}` : 'Air Canada flights');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(name)}`,
  ];
  for (const it of list) {
    const firstTimed = it.legs.findIndex(l => !l.estimated);
    it.legs.forEach((_, i) => lines.push(...legEvent(it, i, stamp, alarm && i === firstTimed)));
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

/** 'ac-YUL-LHR-2026-10-07.ics' (round trips add the return date). */
export function icsFilename(input: Itinerary | readonly Itinerary[]): string {
  const list: readonly Itinerary[] = Array.isArray(input) ? input : [input as Itinerary];
  const first = list[0];
  if (!first) return 'ac-flights.ics';
  const dates = list.map(it => it.dateKey).join('_');
  return `ac-${first.origin}-${first.dest}-${dates}.ics`;
}

/**
 * Hands the file to the browser via a Blob and a temporary <a download>.
 * Returns false when the environment can't (no DOM or no object URLs).
 */
export function downloadIcs(content: string, filename: string, doc: Document | null = typeof document === 'undefined' ? null : document): boolean {
  if (!doc || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
