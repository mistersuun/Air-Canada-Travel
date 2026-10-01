/**
 * BCBP test fixtures: the four sample strings from the barcode research
 * (scratchpad/bcbp/samples.mjs), built with exact IATA Resolution 792 field
 * widths. None of them is a real pass; the security block is a fake signature.
 */
export const BCBP_MINIMAL = 'M1DOE/JOHN            EABC123 YULMADAC 0834 281Y012A0045 100';

/** Version 6, one leg, unique and repeated conditional items, frequent flyer, and a fake security block. */
export const BCBP_FULL =
  'M1TREMBLAY/MARIE ANNE EXK7Q2B YYZLHRAC 0856 005J003K0012 148>6180WW6274BAC              2A0142345678901  AC AC 123456789        2PCN'
  + '^138MEUCIQDexampleSignatureDataOnlyNotReal0123456789abcdefgh';

/** The fake signature inside BCBP_FULL (must never appear in a parse result). */
export const BCBP_FULL_SIGNATURE = 'MEUCIQDexampleSignatureDataOnlyNotReal0123456789abcdefgh';

/** Two legs YVR→YUL→CDG on day 60. */
export const BCBP_MULTILEG =
  'M2SMITH/ALEX MR       EP9LM3Z YVRYULAC 0310 060Y027C0101 148>6180WW6274BAC              2A0142345678901  AC AC 123456789        2PCN'
  + 'P9LM3Z YULCDGAC 0870 060Y041D0088 12C2A0142345678902  AC AC 123456789        2PCN';

/** Day 366 (only valid in a leap year). */
export const BCBP_LEAPDAY = 'M1NGUYEN/LINH         EZZ9QX1 YULFLLAC 1606 366Y019F0007 100';

export const BCBP_SAMPLES = { minimal: BCBP_MINIMAL, full: BCBP_FULL, multileg: BCBP_MULTILEG, leapday: BCBP_LEAPDAY } as const;

/** BCBP_MINIMAL with a different day of year (281 = Thu Oct 8, 2026). */
export function minimalOnDay(julian: number): string {
  return BCBP_MINIMAL.replace(' 281Y', ` ${String(julian).padStart(3, '0')}Y`);
}

/** A one-leg minimal pass with other route and flight fields (same widths as BCBP_MINIMAL). */
export function minimalPass(o: { from: string; to: string; flight: string; julian: number; pnr?: string }): string {
  const pnr = (o.pnr ?? 'ABC123').padEnd(7, ' ').slice(0, 7);
  return `M1DOE/JOHN            E${pnr}${o.from}${o.to}AC ${o.flight.padEnd(5, ' ').slice(0, 5)}${String(o.julian).padStart(3, '0')}Y012A0045 100`;
}
