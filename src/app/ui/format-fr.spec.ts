import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n/locale';
import {
  countdown, daysLabel, formatStay, greeting, hm, hubDisplayName, operatesLabel, relativeCountdown, relativeDay,
  shortDay, timeRange, weekRangeLabel,
} from './format';
import { formatClock, formatDuration, formatKey, monthShort, weekdayLetters, weekdayLong, weekdayShort } from '../utils/time';
import type { Itinerary } from '../utils/connections';

/** Intl uses no-break spaces in French; compare with plain spaces. */
const plain = (s: string) => s.replace(/[  ]/g, ' ');

describe('formats in Canadian French', () => {
  beforeEach(() => setLocale('fr'));
  afterEach(() => setLocale('en'));

  it('dates: "mer. 14 oct.", "mercredi 14 octobre"', () => {
    expect(plain(shortDay('2026-10-14'))).toBe('mer. 14 oct.');
    expect(plain(formatKey('2026-10-14', { month: 'short', day: 'numeric', year: 'numeric' }))).toBe('14 oct. 2026');
  });

  it('week ranges: "12–18 oct." within a month, "28 sept. – 4 oct." across months', () => {
    expect(plain(weekRangeLabel('2026-10-12'))).toBe('12–18 oct.');
    expect(plain(weekRangeLabel('2026-09-28'))).toBe('28 sept. – 4 oct.');
  });

  it('weekday and month names from Intl, Monday first', () => {
    expect(weekdayShort(0)).toBe('lun.');
    expect(weekdayLong(6)).toBe('dimanche');
    expect(weekdayLetters()).toEqual(['L', 'M', 'M', 'J', 'V', 'S', 'D']);
    expect(monthShort(10)).toBe('nov.');
    expect(operatesLabel(['2026-10-12', '2026-10-14'])).toBe('lun. mer.');
    expect(operatesLabel(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']))
      .toBe('Tous les jours');
  });

  it('clock: 24h keeps "21:05" (timetable form); 12h reads "9:05 p.m."', () => {
    expect(formatClock('21:05', '24h')).toBe('21:05');
    expect(plain(formatClock('21:05', '12h'))).toBe('9:05 p.m.');
    expect(plain(formatClock('00:30', '12h'))).toBe('12:30 a.m.');
    expect(plain(timeRange({ depLocal: '18:15', arrLocal: '07:05', arrDayOffset: 1 }))).toBe('18:15 → 07:05⁺¹');
  });

  it('durations: "6 h 35", "45 min", "7 h 05", "3 j 22 h"', () => {
    expect(plain(hm(395))).toBe('6 h 35');
    expect(plain(hm(45))).toBe('45 min');
    expect(plain(hm(780))).toBe('13 h');
    expect(plain(formatDuration(425))).toBe('7 h 05');
    expect(plain(formatStay((3 * 24 + 22) * 3_600_000))).toBe('3 j 22 h');
    expect(plain(countdown(130 * 60_000))).toBe('dans 2 h 10 min');
    expect(countdown(0)).toBe('maintenant');
  });

  it('words: days, stops, greetings, relative days', () => {
    expect(daysLabel(7)).toBe('Tous les jours');
    expect(daysLabel(6)).toBe('6×/sem.');
    expect(greeting(Date.UTC(2026, 9, 14, 13), 'America/Toronto')).toBe('Bonjour');
    expect(relativeDay('2026-10-14', '2026-10-14')).toBe('Aujourd\'hui');
    expect(relativeDay('2026-10-15', '2026-10-14')).toBe('Demain');
    expect(relativeDay('2026-10-17', '2026-10-14')).toBe('sam.');
    expect(relativeCountdown(0, 0, '2026-10-17', '2026-10-14')).toBe('Dans 3 jours · sam.');
  });

  it('hub names: "Québec" for YQB, accents kept for YUL', () => {
    expect(hubDisplayName('YQB')).toBe('Québec');
    expect(hubDisplayName('YUL')).toBe('Montréal');
    setLocale('en');
    expect(hubDisplayName('YQB')).toBe('Québec City');
  });
});
