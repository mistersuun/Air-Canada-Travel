import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { allItineraries, directItineraries, findAlternatives, type Itinerary } from '../../utils/connections';
import {
  backupGroups, choose, frequencyLabel, isPick, optionRow, parseNights, pickOf, placeName, roundTrip, shortAircraft,
  ticketModel, weekFrequency,
} from './flight-model';

/** A fake itinerary for the pick rules (only the fields they read). */
function fake(id: string, hubs: string[], totalMin: number): Itinerary {
  return {
    legs: [{ flightNumber: id, origin: 'YUL', dest: 'LIS', depUtc: totalMin } as never],
    layovers: [], totalMin, departUtc: 0, arriveUtc: totalMin, estimated: false, hubs,
    origin: 'YUL', dest: 'LIS', dateKey: '2026-10-07', arrDateKey: '2026-10-08', arrDayOffset: 1,
  };
}

describe('flight-model', () => {
  beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
  afterEach(() => resetScheduleSource());

  describe('picks', () => {
    const a = fake('AC1', ['YYZ'], 600);
    const b = fake('AC2', [], 500);
    const c = fake('AC3', ['YYZ'], 400);
    const its = [a, b, c];

    it('earliest is the first ranked, nonstop the first direct, fastest the shortest', () => {
      expect(pickOf(its, 'earliest')).toBe(a);
      expect(pickOf(its, 'nonstop')).toBe(b);
      expect(pickOf(its, 'fastest')).toBe(c);
      expect(pickOf([a, c], 'nonstop')).toBeNull();
      expect(pickOf([], 'earliest')).toBeNull();
      expect(isPick('fastest')).toBe(true);
      expect(isPick('cheapest')).toBe(false);
    });

    it('a slug wins over pick; a bad slug falls back to the pick, then the earliest', () => {
      expect(choose(its, 'AC3', 'nonstop')).toEqual({ it: c, pick: 'fastest' });
      expect(choose(its, 'AC9', 'nonstop')).toEqual({ it: b, pick: 'nonstop' });
      expect(choose(its, null, null)).toEqual({ it: a, pick: 'earliest' });
      expect(choose([a, c], null, 'nonstop')).toEqual({ it: a, pick: 'earliest' });
      expect(choose(its, 'ac2', undefined)).toEqual({ it: b, pick: 'nonstop' });
      expect(choose([], 'AC1', 'earliest')).toEqual({ it: null, pick: null });
      // A slug that no pick stands for lights nothing.
      const d = fake('AC4', ['YYZ'], 700);
      expect(choose([a, b, c, d], 'AC4', null)).toEqual({ it: d, pick: null });
    });
  });

  it('ticket for YUL→LHR AC864 (Wed Oct 7): codes, times, cells', () => {
    const [it] = directItineraries('YUL', 'LHR', '2026-10-07');
    const t = ticketModel(it);
    expect(t.origin).toBe('YUL');
    expect(t.originCity).toBe('Montréal');
    expect(t.dest).toBe('LHR');
    expect(t.nonstop).toBe(true);
    expect(t.tag).toBe('NON-STOP');
    expect(t.dep).toBe('22:10');
    expect(t.depDate).toBe('Wed, Oct 7');
    expect(t.arr).toBe('10:00');
    expect(t.arrDate).toBe('Thu, Oct 8 · local');
    expect(t.arrOffset).toBe('⁺¹');
    expect(t.layovers).toEqual([]);
    expect(t.legs).toHaveLength(1);
    expect(Object.fromEntries(t.legs[0].cells.map(c => [c.label, c.value]))).toEqual({
      Date: 'Oct 7',
      Flight: 'AC864',
      Aircraft: 'A330-300',
      Duration: '6h50',
      Frequency: 'Daily',
      'Time diff': '+5h',
    });
    expect(ticketModel(it, '12h').dep).toBe('10:10 PM');
  });

  it('ticket for a connection YHZ→LHR via YYZ: one block per leg and the layover', () => {
    const it = allItineraries('YHZ', 'LHR', '2026-10-07').find(i => i.hubs[0] === 'YYZ' && !i.estimated)!;
    const t = ticketModel(it, '24h', 60);
    expect(t.nonstop).toBe(false);
    expect(t.tag).toBe('1 STOP · YYZ');
    expect(t.legs.map(l => l.route)).toEqual(['YHZ → YYZ', 'YYZ → LHR']);
    expect(t.layovers).toEqual([{ text: '2h 30m in Toronto', alert: false, reason: '' }]);
    // Tight and long layovers are flagged.
    expect(ticketModel(it, '24h', 180).layovers[0]).toMatchObject({ alert: true, reason: 'Tight connection' });
    expect(ticketModel({ ...it, layovers: [400] }).layovers[0]).toMatchObject({ alert: true, reason: 'Long wait' });
  });

  it('frequency counts the flight number across the week', () => {
    const [ath] = directItineraries('YUL', 'ATH', '2026-10-07');
    expect(weekFrequency(ath.legs[0])).toBe(3);
    expect(frequencyLabel(3)).toBe('3× / wk');
    expect(frequencyLabel(7)).toBe('Daily');
    expect(frequencyLabel(0)).toBe('—');
    expect(weekFrequency({ ...ath.legs[0], flightNumber: null })).toBe(0);
  });

  it('names, aircraft, nights and round trips', () => {
    expect(placeName('YUL')).toBe('Montréal');
    expect(placeName('LHR')).toBe('London');
    expect(shortAircraft('77W')).toBe('777-300ER');
    expect(shortAircraft(null)).toBe('');
    expect(parseNights('7')).toBe(7);
    expect(parseNights('0')).toBe(4);
    expect(parseNights('31')).toBe(4);
    expect(parseNights('x')).toBe(4);
    expect(parseNights(undefined)).toBe(4);
    const [out] = directItineraries('YUL', 'LHR', '2026-10-07');
    const [back] = directItineraries('LHR', 'YUL', '2026-10-12');
    expect(roundTrip(out, back)).toEqual([out, back]);
    expect(roundTrip(back, out)).toEqual([out, back]);
    expect(roundTrip(out, null)).toEqual([out]);
  });

  it('option rows: nonstop and via, with the slug', () => {
    const [it] = directItineraries('YUL', 'LHR', '2026-10-07');
    const r = optionRow(it);
    expect(r).toMatchObject({ tile: 'LHR', name: 'Nonstop', small: '6h50', slug: 'AC864', date: '2026-10-07' });
    expect(r.meta).toBe('AC864 · YUL 22:10 → LHR 10:00⁺¹ · A330-300');
    const [ret] = directItineraries('LHR', 'YUL', '2026-10-12');
    expect(optionRow(ret).tile).toBe('LHR');
    const via = allItineraries('YHZ', 'LHR', '2026-10-07').find(i => i.hubs[0] === 'YYZ' && !i.estimated)!;
    expect(optionRow(via)).toMatchObject({ tile: 'YYZ', name: 'Via Toronto', slug: 'AC603+AC848' });
  });

  it('backups: next day for a daily nonstop; later options on a double day', () => {
    const [lhr] = directItineraries('YUL', 'LHR', '2026-10-07');
    const groups = backupGroups(findAlternatives('YUL', 'LHR', lhr), lhr);
    expect(groups.map(g => g.id)).toEqual(['next']);
    expect(groups[0].label).toBe('Next day · Thu, Oct 8');
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0].date).toBe('2026-10-08');

    const [first] = directItineraries('YUL', 'ATH', '2026-10-07');
    const ath = backupGroups(findAlternatives('YUL', 'ATH', first), first);
    expect(ath[0]).toMatchObject({ id: 'later', label: 'Later nonstop' });
    expect(ath[0].rows[0].slug).toBe('AC922');
  });
});
