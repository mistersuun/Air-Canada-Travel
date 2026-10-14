import type { Messages } from '../catalogue';

/** Shared display formats (ui/format.ts, utils/time.ts). */
export const format = {
  'format.daily': 'Daily',
  'format.nonstop': 'Nonstop',
  'format.stops': '{n, plural, one {# stop} other {# stops}} · {hubs}',
  'format.via': 'via {hubs}',
  'format.today': 'Today',
  'format.tomorrow': 'Tomorrow',
  'format.todayLower': 'today',
  'format.yesterdayLower': 'yesterday',
  'format.daysAgo': '{n, plural, one {# day ago} other {# days ago}}',
  'format.greeting.morning': 'Good morning',
  'format.greeting.afternoon': 'Good afternoon',
  'format.greeting.evening': 'Good evening',
  'format.now': 'now',
  'format.in': 'in {dur}',
  'format.todayAt': 'Today · {x}',
  'format.tomorrowAt': 'Tomorrow · {x}',
  'format.inDays': '{n, plural, one {In # day} other {In # days}} · {weekday}',
  'format.perWeek': '{n}× wk',
  /** Week ranges: each language picks the parts it needs ('Oct 1 – 7' / '1–7 oct.'). */
  'format.range.sameMonth': '{start} – {endDay}',
  'format.range.twoMonths': '{start} – {end}',
  /** Compact durations: '6h35', '13h', '45m'. */
  'format.hm.hm': '{h}h{mm}',
  'format.hm.h': '{h}h',
  'format.hm.m': '{m}m',
  /** Spaced durations: '2d 3h', '2h 10m', '7h 05m'. */
  'format.dur.dh': '{d}d {h}h',
  'format.dur.d': '{d}d',
  'format.dur.hm': '{h}h {m}m',
  'format.dur.h': '{h}h',
  'format.dur.m': '{m}m',
  'format.dur.hmm': '{h}h {mm}m',
  'format.clock.am': '{h}:{mm} AM',
  'format.clock.pm': '{h}:{mm} PM',
} satisfies Messages;
