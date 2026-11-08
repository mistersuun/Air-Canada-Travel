import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { setLocale } from '../../i18n/locale';
import { toUtcMs } from '../../utils/time';
import { routeFacts } from './route-facts';

beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
afterEach(() => { resetScheduleSource(); setLocale('en'); });

// Thu Oct 1 2026, noon in Montréal.
const NOON = toUtcMs('2026-10-01', '12:00', 'America/Toronto');

describe('routeFacts', () => {
  it('daily route with a return still ahead today', () => {
    expect(routeFacts('YUL', 'LHR', '2026-10-04', NOON)[0]).toBe('1 nonstop a day from YUL');
    expect(routeFacts('YUL', 'LHR', '2026-10-01', NOON)[0]).toBe('1 to 2 nonstops a day from YUL'); // Sat Oct 3 has an extra
    expect(routeFacts('YUL', 'LHR', '2026-10-01', toUtcMs('2026-10-01', '09:00', 'Europe/London'))).toContain('Last nonstop home today 12:10');
  });

  it('three days a week, and nothing about a way home when none is published', () => {
    const f = routeFacts('YUL', 'ATH', '2026-10-01', NOON);
    expect(f[0]).toBe('Nonstop 3 days a week (Mon, Wed, Fri)');
    expect(f.some(x => x.startsWith('Last nonstop') || x.startsWith('No nonstop home'))).toBe(false);
  });

  it('says so when nothing flies in the next 7 days', () => {
    expect(routeFacts('YUL', 'ATH', '2026-12-01', NOON)[0]).toBe('No nonstop from YUL in the next 7 days');
  });

  it('after the last return has left, names the next day', () => {
    const late = toUtcMs('2026-10-01', '20:00', 'Europe/London');
    expect(routeFacts('YUL', 'LHR', '2026-10-01', late)).toContain('No nonstop home today; next Fri');
  });

  it('is bilingual', () => {
    setLocale('fr');
    expect(routeFacts('YUL', 'LHR', '2026-10-04', NOON)[0]).toBe('1 vol sans escale par jour depuis YUL');
  });
});
