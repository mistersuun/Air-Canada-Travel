import { afterEach, describe, expect, it } from 'vitest';
import { clearDismissedFacts, destinationFact, dismissFact, dismissedFacts } from './fun-fact';

describe('flight page fun fact', () => {
  afterEach(() => localStorage.clear());

  it('gives a fact for a known destination and none for an unknown one', () => {
    const now = Date.UTC(2026, 9, 14, 12);
    expect(destinationFact('LIS', 'YUL', now)).toMatch(/\S/);
    expect(destinationFact('ZZZ', 'YUL', now)).toBeNull();
    expect(destinationFact('LIS', 'ZZZ', now)).toBeNull();
  });
  it('is stable within a day and may change on the next', () => {
    const d1 = Date.UTC(2026, 9, 14, 12);
    expect(destinationFact('LIS', 'YUL', d1)).toBe(destinationFact('LIS', 'YUL', d1 + 3600_000));
  });
  it('remembers dismissals per destination', () => {
    expect(dismissedFacts().size).toBe(0);
    dismissFact('lis');
    expect(dismissedFacts().has('LIS')).toBe(true);
    expect(dismissedFacts().has('CDG')).toBe(false);
  });
  it('can show them all again', () => {
    dismissFact('LIS');
    clearDismissedFacts();
    expect(dismissedFacts().size).toBe(0);
  });
});
