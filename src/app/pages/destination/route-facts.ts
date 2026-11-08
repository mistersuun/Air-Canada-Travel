/**
 * Route facts for the destination page: a few plain counts read off the
 * published schedules for the selected hub. No predictions, no seat talk.
 */
import { t } from '../../i18n/t';
import type { TimeFormat } from '../../state/prefs.service';
import { shortDay } from '../../ui/format';
import { airportTz } from '../../utils/airports';
import { routeSeason } from '../../utils/season';
import { addDays, formatClock, todayKey, weekdayIndex, weekdayShort } from '../../utils/time';
import { flightsOn, nextFlightDate } from '../../utils/week';

/** Up to three short facts: frequency, season, last nonstop home today. Empty when the schedules say nothing. */
export function routeFacts(hub: string, code: string, today: string, nowMs: number, fmt: TimeFormat = '24h'): string[] {
  const out: string[] = [];

  const counts: number[] = [];
  const days: number[] = [];
  for (let i = 0; i < 7; i++) {
    const key = addDays(today, i);
    const n = flightsOn(hub, code, key).length;
    counts.push(n);
    if (n) days.push(weekdayIndex(key));
  }
  const flying = counts.filter(n => n > 0);
  if (!flying.length) {
    out.push(t('dest.facts.none', { hub }));
  } else if (flying.length === 7) {
    const lo = Math.min(...flying);
    const hi = Math.max(...flying);
    out.push(lo === hi ? t('dest.facts.daily', { n: lo, hub }) : t('dest.facts.dailyRange', { lo, hi, hub }));
  } else {
    const names = [...days].sort((a, b) => a - b).map(weekdayShort).join(', ');
    out.push(t('dest.facts.weekly', { n: flying.length, days: names }));
  }

  const season = routeSeason(hub, code);
  if (season) out.push(t('dest.facts.seasonal', { months: season }));

  const homeToday = todayKey(airportTz(code), nowMs);
  const ahead = flightsOn(code, hub, homeToday).filter(f => f.depUtc > nowMs);
  if (ahead.length) {
    out.push(t('dest.facts.lastHome', { time: formatClock(ahead[ahead.length - 1].depLocal, fmt) }));
  } else {
    const next = nextFlightDate(code, hub, homeToday, false);
    if (next) {
      const day = next <= addDays(homeToday, 6) ? weekdayShort(weekdayIndex(next)) : shortDay(next);
      out.push(t('dest.facts.noHome', { day }));
    }
  }
  return out;
}
