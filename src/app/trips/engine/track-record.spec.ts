import { describe, expect, it } from 'vitest';
import type { Outcome, OutcomeKind } from '../model';
import { historyFor, historyText, recordAria, recordLine, recordTag } from './track-record';

let n = 0;
function o(kind: OutcomeKind, dateKey: string, flightNumber = 'AC834', origin = 'YUL', dest = 'LHR', recordedAt = ''): Outcome {
  return { id: `o${n++}`, flightNumber, origin, dest, dateKey, kind, partySize: 1, tripId: null, note: '', recordedAt };
}

describe('historyFor', () => {
  // 2026-10-02 and 2026-10-09 are Fridays; 2026-10-03 is a Saturday.
  const log = { outcomes: [
    o('allBoarded', '2026-10-02'), o('allBoarded', '2026-10-09'), o('someBoarded', '2026-10-03'),
    o('noneBoarded', '2026-09-25'), o('didntTry', '2026-10-16'), o('allBoarded', '2026-10-02', 'AC870', 'YYZ', 'LHR'),
  ] };

  it("counts by flight number: boarded includes some of us, didn't try is skipped", () => {
    const h = historyFor(log, { flightNumber: 'ac 834', dateKey: '2026-10-23' });
    expect(h.overall).toEqual({ tried: 4, boarded: 3, partial: 1 });
    expect(h.sameWeekday).toEqual({ tried: 3, boarded: 2, partial: 0 });
  });

  it('counts by route', () => {
    expect(historyFor(log, { route: { origin: 'YUL', dest: 'LHR' } }).overall.tried).toBe(4);
    expect(historyFor(log, { route: { origin: 'YYZ', dest: 'LHR' } }).overall).toEqual({ tried: 1, boarded: 1, partial: 0 });
    expect(historyFor(log, { flightNumber: 'AC834', route: { origin: 'YUL', dest: 'CDG' } }).overall.tried).toBe(0);
  });

  it('keeps one outcome per flight instance, the latest saved', () => {
    const l = { outcomes: [
      o('noneBoarded', '2026-10-02', 'AC834', 'YUL', 'LHR', '2026-10-02T10:00:00Z'),
      o('allBoarded', '2026-10-02', 'AC834', 'YUL', 'LHR', '2026-10-02T12:00:00Z'),
    ] };
    expect(historyFor(l, { flightNumber: 'AC834' }).overall).toEqual({ tried: 1, boarded: 1, partial: 0 });
  });

  it('has zero weekday counts without a date and handles an empty log', () => {
    expect(historyFor(log, { flightNumber: 'AC834' }).sameWeekday.tried).toBe(0);
    expect(historyFor({ outcomes: [] }, { flightNumber: 'AC1' }).overall.tried).toBe(0);
  });

  it('words counts only', () => {
    expect(historyText({ tried: 4, boarded: 3, partial: 0 })).toBe('tried 4, boarded 3');
    expect(historyText({ tried: 4, boarded: 3, partial: 1 })).toBe('tried 4, boarded 3 (1 some of us)');
    const h = historyFor({ outcomes: [o('allBoarded', '2026-10-02'), o('allBoarded', '2026-10-09')] }, { flightNumber: 'AC834', dateKey: '2026-10-16' });
    expect(recordLine(h, 'AC834', '2026-10-16')).toBe('AC834: tried 2, boarded 2 (Fridays 2 of 2)');
    expect(recordTag(h.overall)).toBe('you: 2/2');
    expect(recordAria({ tried: 4, boarded: 3, partial: 0 })).toBe('Your record: boarded 3 of 4');
    expect(recordTag({ tried: 0, boarded: 0, partial: 0 })).toBeNull();
  });
});
