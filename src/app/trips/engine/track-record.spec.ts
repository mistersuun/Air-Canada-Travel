import { describe, expect, it } from 'vitest';
import type { Outcome, OutcomeKind } from '../model';
import { historyFor, historyText } from './track-record';

let n = 0;
function o(kind: OutcomeKind, dateKey: string, flightNumber = 'AC834', origin = 'YUL', dest = 'LHR'): Outcome {
  return { id: `o${n++}`, flightNumber, origin, dest, dateKey, kind, partySize: 1, tripId: null, note: '', recordedAt: '' };
}

describe('historyFor', () => {
  // 2026-10-02 and 2026-10-09 are Fridays; 2026-10-03 is a Saturday.
  const log = { outcomes: [
    o('allBoarded', '2026-10-02'), o('allBoarded', '2026-10-09'), o('someBoarded', '2026-10-03'),
    o('noneBoarded', '2026-09-25'), o('didntTry', '2026-10-16'), o('allBoarded', '2026-10-02', 'AC870', 'YYZ', 'LHR'),
  ] };

  it("counts by flight number, skipping didn't try", () => {
    const h = historyFor(log, { flightNumber: 'ac 834', dateKey: '2026-10-23' });
    expect(h.overall).toEqual({ tried: 4, boarded: 2, partial: 1 });
    expect(h.sameWeekday).toEqual({ tried: 3, boarded: 2, partial: 0 });
  });

  it('counts by route', () => {
    expect(historyFor(log, { route: { origin: 'YUL', dest: 'LHR' } }).overall.tried).toBe(4);
    expect(historyFor(log, { route: { origin: 'YYZ', dest: 'LHR' } }).overall).toEqual({ tried: 1, boarded: 1, partial: 0 });
  });

  it('has zero weekday counts without a date and handles an empty log', () => {
    expect(historyFor(log, { flightNumber: 'AC834' }).sameWeekday.tried).toBe(0);
    expect(historyFor({ outcomes: [] }, { flightNumber: 'AC1' }).overall.tried).toBe(0);
  });

  it('words counts only', () => {
    expect(historyText({ tried: 4, boarded: 3, partial: 0 })).toBe('tried 4, boarded 3');
    expect(historyText({ tried: 4, boarded: 2, partial: 1 })).toBe('tried 4, boarded 2, some boarded 1');
  });
});
