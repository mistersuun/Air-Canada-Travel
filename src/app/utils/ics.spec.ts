import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../data/testing/schedule-fixtures';
import { directItineraries, findItineraries, type Itinerary } from './connections';
import { buildIcs, downloadIcs, escapeIcsText, foldIcsLine, icsFilename, icsUtc } from './ics';

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);

/** Unfolds continuation lines and splits on CRLF. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n');
}

function events(ics: string): string[][] {
  const out: string[][] = [];
  let cur: string[] | null = null;
  for (const l of unfold(ics)) {
    if (l === 'BEGIN:VEVENT') cur = [];
    else if (l === 'END:VEVENT') { out.push(cur!); cur = null; }
    else cur?.push(l);
  }
  return out;
}

const field = (ev: string[], name: string) => ev.find(l => l.startsWith(name + ':') || l.startsWith(name + ';'));

describe('ics', () => {
  beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
  afterEach(() => resetScheduleSource());

  const yulLhr = (): Itinerary => directItineraries('YUL', 'LHR', '2026-10-07')[0];

  it('wraps a direct flight in a VCALENDAR with CRLF line endings', () => {
    const ics = buildIcs(yulLhr(), 'London', { now: NOW });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    // No bare LF anywhere.
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
    expect(ics).toContain('PRODID:');
    expect(ics).toContain('X-WR-CALNAME:Air Canada · London');
  });

  it('times published legs in UTC from depUtc/arrUtc (YUL 22:10 EDT → LHR 10:00 BST, +1)', () => {
    const [ev] = events(buildIcs(yulLhr(), 'London', { now: NOW }));
    expect(field(ev, 'DTSTART')).toBe('DTSTART:20261008T021000Z');
    expect(field(ev, 'DTEND')).toBe('DTEND:20261008T090000Z');
    expect(field(ev, 'SUMMARY')).toBe('SUMMARY:AC864 YUL→LHR');
    expect(field(ev, 'DTSTAMP')).toBe('DTSTAMP:20260930T120000Z');
    expect(field(ev, 'UID')).toBe('UID:AC864-YULLHR-20261008T021000Z@ac-travel-planner');
    expect(field(ev, 'STATUS')).toBe('STATUS:CONFIRMED');
    const desc = field(ev, 'DESCRIPTION')!;
    expect(desc).toContain('Airbus A330-300');
    expect(desc).toContain('(+1 day)');
    expect(desc).toContain('verify on the Air Canada app');
    expect(field(ev, 'LOCATION')).toBe('LOCATION:Montreal (YUL)');
  });

  it('adds a 24h check-in alarm by default and can omit it', () => {
    expect(buildIcs(yulLhr(), 'London', { now: NOW })).toContain('TRIGGER:-PT24H');
    expect(buildIcs(yulLhr(), 'London', { now: NOW, alarm: false })).not.toContain('VALARM');
  });

  it('writes one event per leg of a connection with layover notes', () => {
    const it0 = findItineraries('YHZ', 'LHR', '2026-10-05').find(i => !i.estimated)!;
    const evs = events(buildIcs(it0, 'London', { now: NOW }));
    expect(evs).toHaveLength(2);
    expect(field(evs[0], 'SUMMARY')).toBe('SUMMARY:AC603 YHZ→YYZ');
    expect(field(evs[0], 'DESCRIPTION')).toContain('Then a 2h 30m layover in Toronto.');
    expect(field(evs[1], 'DESCRIPTION')).toContain('After a 2h 30m layover in Toronto.');
    // Only the first leg carries the reminder.
    expect(evs[0].join('\n')).toContain('BEGIN:VALARM');
    expect(evs[1].join('\n')).not.toContain('BEGIN:VALARM');
  });

  it('never exports estimated legs as timed events (critique 35)', () => {
    const est = findItineraries('YHZ', 'LHR', '2026-10-05', { viaHubs: ['YUL'] })[0];
    expect(est.estimated).toBe(true);
    const evs = events(buildIcs(est, 'London', { now: NOW }));
    const estEv = evs.find(e => field(e, 'SUMMARY')!.includes('Estimated'))!;
    expect(field(estEv, 'DTSTART')).toBe('DTSTART;VALUE=DATE:20261005');
    expect(field(estEv, 'DTEND')).toBe('DTEND;VALUE=DATE:20261006');
    expect(field(estEv, 'STATUS')).toBe('STATUS:TENTATIVE');
    expect(field(estEv, 'TRANSP')).toBe('TRANSP:TRANSPARENT');
    expect(estEv.join('\n')).not.toContain('VALARM');
    // The published onward leg keeps the reminder.
    const real = evs.find(e => e !== estEv)!;
    expect(real.join('\n')).toContain('VALARM');
    expect(field(real, 'DTSTART')).toMatch(/^DTSTART:\d{8}T\d{6}Z$/);
  });

  it('exports both directions of a round trip', () => {
    const back = directItineraries('LHR', 'YUL', '2026-10-12')[0];
    const ics = buildIcs([yulLhr(), back], 'London', { now: NOW });
    expect(events(ics).map(e => field(e, 'SUMMARY'))).toEqual(['SUMMARY:AC864 YUL→LHR', 'SUMMARY:AC865 LHR→YUL']);
    expect(icsFilename([yulLhr(), back])).toBe('ac-YUL-LHR-2026-10-07_2026-10-12.ics');
    expect(icsFilename(yulLhr())).toBe('ac-YUL-LHR-2026-10-07.ics');
    expect(icsFilename([])).toBe('ac-flights.ics');
  });

  it('defaults the calendar name and the timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const ics = buildIcs(yulLhr());
      expect(ics).toContain('X-WR-CALNAME:Air Canada flights');
      expect(ics).toContain('DTSTAMP:20260930T120000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('escapes text values', () => {
    expect(escapeIcsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });

  it('folds long lines at 75 octets without splitting characters', () => {
    const line = 'DESCRIPTION:' + '→'.repeat(40);
    const folded = foldIcsLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    const enc = new TextEncoder();
    parts.forEach((p, i) => {
      expect(enc.encode(p).length).toBeLessThanOrEqual(75);
      if (i > 0) expect(p.startsWith(' ')).toBe(true);
    });
    expect(folded.replace(/\r\n /g, '')).toBe(line);
    expect(foldIcsLine('SHORT:x')).toBe('SHORT:x');
  });

  it('formats UTC instants', () => {
    expect(icsUtc(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe('20260102T030405Z');
  });

  it('downloads through a Blob and a temporary anchor', () => {
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      expect(downloadIcs('BEGIN:VCALENDAR', 'x.ics')).toBe(true);
      expect(create).toHaveBeenCalledOnce();
      expect(click).toHaveBeenCalledOnce();
      expect(document.querySelector('a[download]')).toBeNull();
      vi.runAllTimers();
      expect(revoke).toHaveBeenCalledWith('blob:x');
      expect(downloadIcs('x', 'x.ics', null)).toBe(false);
    } finally {
      vi.useRealTimers();
      click.mockRestore();
      Object.assign(URL, { createObjectURL: origCreate, revokeObjectURL: origRevoke });
    }
  });
});
