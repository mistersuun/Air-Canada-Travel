import { getSchedulesForRoute } from '../data/schedules';

export interface DayFlight {
  date: Date;
  flies: boolean;
  flightNumber?: string;
  departure?: string;
  arrival?: string;
  aircraft?: string;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Returns the Monday of the week containing `date`. Does not mutate input. */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const jsDay = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysFromMonday = jsDay === 0 ? 6 : jsDay - 1;
  d.setDate(d.getDate() - daysFromMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns one DayFlight per day Mon–Sun for the given week.
 * weekStart must be a Monday at midnight (use getWeekStart).
 * Does not mutate weekStart.
 */
export function getFlightsForWeek(
  hubCode: string,
  destCode: string,
  weekStart: Date
): DayFlight[] {
  const schedules = getSchedulesForRoute(hubCode, destCode);

  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    const dayName = DAY_NAMES[i];

    const match = schedules.find(s => {
      const from = new Date(s.fromDate + 'T00:00:00');
      const to = new Date(s.toDate + 'T00:00:00');
      return date >= from && date <= to && s.days.includes(dayName);
    });

    if (match) {
      return {
        date,
        flies: true,
        flightNumber: match.flightNumber,
        departure: match.departure,
        arrival: match.arrival,
        aircraft: match.aircraft,
      };
    }
    return { date, flies: false };
  });
}

/** Returns true if any day in the 7-day week has a flight for this route. */
export function routeHasFlightsInWeek(
  hubCode: string,
  destCode: string,
  weekStart: Date
): boolean {
  return getFlightsForWeek(hubCode, destCode, weekStart).some(d => d.flies);
}

/** "Jun 8 – 14, 2026" */
export function formatWeekLabel(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const startStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endDay = end.toLocaleDateString('en-US', { day: 'numeric' });
  return `${startStr} – ${endDay}, ${end.getFullYear()}`;
}

/** "Jun 8" — used in week strip prev/next arrows */
export function formatWeekNavLabel(weekStart: Date): string {
  return weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Tue Jun 9" — used in expanded flight rows */
export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
