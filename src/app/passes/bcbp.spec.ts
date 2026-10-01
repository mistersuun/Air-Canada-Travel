import { describe, expect, it } from 'vitest';
import { displayText, julianToDateKey, maskPnr, normalizeFlightNumber, parseBcbp } from './bcbp';
import { BCBP_FULL, BCBP_FULL_SIGNATURE, BCBP_LEAPDAY, BCBP_MINIMAL, BCBP_MULTILEG } from './testing/bcbp-fixtures';

function ok(raw: string) {
  const r = parseBcbp(raw);
  if (!r.ok) throw new Error('expected a parse');
  return r;
}

describe('parseBcbp', () => {
  it('parses the minimal one-leg pass', () => {
    const r = ok(BCBP_MINIMAL);
    expect(r.legCount).toBe(1);
    expect(r.version).toBeNull();
    expect(r.security).toBeNull();
    expect(r.warnings).toEqual([]);
    expect(r.passenger).toMatchObject({ lastName: 'DOE', firstName: 'JOHN', eTicket: true, issueDate: null, issuer: null });
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0]).toMatchObject({
      pnr: 'ABC123', from: 'YUL', to: 'MAD', carrier: 'AC', flightNumber: '834', julian: 281,
      cabin: 'Y', seat: '12A', sequence: '45', paxStatus: '1',
    });
  });

  it('parses the full v6 pass and keeps no security bytes', () => {
    const r = ok(BCBP_FULL);
    expect(r.version).toBe('6');
    expect(r.passenger).toMatchObject({ lastName: 'TREMBLAY', firstName: 'MARIE ANNE', issueDate: '6274', issuer: 'AC' });
    expect(r.security).toEqual({ present: true });
    expect(r.legs[0]).toMatchObject({
      pnr: 'XK7Q2B', from: 'YYZ', to: 'LHR', flightNumber: '856', julian: 5, cabin: 'J', seat: '3K', sequence: '12',
      airlineNumeric: '014', docSerial: '2345678901', marketingCarrier: 'AC', ffAirline: 'AC', ffNumber: '123456789', freeBaggage: '2PC',
    });
    const json = JSON.stringify(r);
    expect(json).not.toContain(BCBP_FULL_SIGNATURE);
    expect(json).not.toContain('MEUCIQ');
    expect(r.warnings).toEqual([]);
  });

  it('parses both legs of an M2 barcode', () => {
    const r = ok(BCBP_MULTILEG);
    expect(r.legCount).toBe(2);
    expect(r.legs.map(l => `${l.from}-${l.to}`)).toEqual(['YVR-YUL', 'YUL-CDG']);
    expect(r.legs.map(l => l.julian)).toEqual([60, 60]);
    expect(r.legs.map(l => l.flightNumber)).toEqual(['310', '870']);
    expect(r.legs[1].docSerial).toBe('2345678902');
    expect(r.passenger.lastName).toBe('SMITH');
    expect(r.passenger.firstName).toBe('ALEX MR');
  });

  it('parses day 366', () => {
    expect(ok(BCBP_LEAPDAY).legs[0].julian).toBe(366);
  });

  it('rejects garbage, S-format and short strings', () => {
    expect(parseBcbp('https://example.com/boarding')).toEqual({ ok: false, error: 'not-bcbp-m' });
    expect(parseBcbp('S' + BCBP_MINIMAL.slice(1)).ok).toBe(false);
    expect(parseBcbp(BCBP_MINIMAL.slice(0, 59)).ok).toBe(false);
    expect(parseBcbp('M5' + BCBP_MINIMAL.slice(2)).ok).toBe(false);
    expect(parseBcbp('').ok).toBe(false);
  });

  it('keeps a leg whose conditional size is not hex, with a warning', () => {
    const r = ok(BCBP_MINIMAL.slice(0, -2) + 'ZZ');
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0].pnr).toBe('ABC123');
    expect(r.warnings).toEqual(['leg1-bad-cond-size']);
  });

  it('warns on a truncated second leg and on trailing data', () => {
    expect(ok('M2' + BCBP_MINIMAL.slice(2)).warnings).toEqual(['leg2-truncated']);
    expect(ok(BCBP_MINIMAL + 'XYZ').warnings).toEqual(['trailing-data']);
  });

  it('tolerates a trailing newline', () => {
    expect(ok(BCBP_MINIMAL + '\n').warnings).toEqual([]);
  });
});

describe('julianToDateKey', () => {
  it.each([
    [281, '2026-10-01', null, '2026-10-08'],
    [5, '2026-12-28', null, '2027-01-05'],
    [360, '2027-01-03', null, '2026-12-26'],
    [5, '2026-10-01', '6274', '2027-01-05'],
    [366, '2026-06-01', null, null],
    [60, '2028-03-01', null, '2028-02-29'],
  ])('day %i near %s (issued %s) → %s', (doy, anchor, issue, want) => {
    expect(julianToDateKey(doy, anchor, issue)).toBe(want);
  });

  it('uses the issue date to pick the year', () => {
    // Nearest to the June anchor would be Jan 5 2026, but a pass issued Oct 1 2026 can't be for a past flight.
    expect(julianToDateKey(5, '2026-06-01')).toBe('2026-01-05');
    expect(julianToDateKey(5, '2026-06-01', '6274')).toBe('2027-01-05');
  });

  it('rejects out-of-range days and bad anchors', () => {
    expect(julianToDateKey(0, '2026-10-01')).toBeNull();
    expect(julianToDateKey(367, '2026-10-01')).toBeNull();
    expect(julianToDateKey(10, 'nope')).toBeNull();
  });
});

describe('helpers', () => {
  it('normalizes flight numbers', () => {
    expect(normalizeFlightNumber('AC ', '0834')).toBe('AC834');
    expect(normalizeFlightNumber('AC', '0834A')).toBe('AC834A');
    expect(normalizeFlightNumber('ac', '0008 ')).toBe('AC8');
  });

  it('masks a booking code', () => {
    expect(maskPnr('XK7Q2B')).toBe('XK7•••');
    expect(maskPnr('ABC')).toBe('•••');
    expect(maskPnr('')).toBe('•••');
  });

  it('cuts the display text before the security block', () => {
    expect(displayText(BCBP_FULL)).toBe(BCBP_FULL.slice(0, BCBP_FULL.indexOf('^')).trim());
    expect(displayText(BCBP_FULL)).not.toContain('MEUCIQ');
    expect(displayText(BCBP_MINIMAL)).toBe(BCBP_MINIMAL);
    expect(displayText('not a pass ^secret')).toBe('not a pass');
  });
});
