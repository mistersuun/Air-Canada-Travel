import type { Messages } from '../catalogue';

/**
 * Display names for data values that are also identifiers (regions, trip
 * types, departure windows, hub names). The values stay English in data,
 * URLs and storage; i18n/labels.ts maps them to these keys for display.
 */
export const data = {
  'data.region.all': 'All regions',
  'data.region.starred': '★ Starred',
  'data.region.starredShort': 'Starred',
  'data.region.caribbean': 'Caribbean',
  'data.region.mexico': 'Mexico',
  'data.region.usa': 'USA',
  'data.region.europe': 'Europe',
  'data.region.asiaPacific': 'Asia & Pacific',
  'data.region.centralAmerica': 'Central America',
  'data.region.southAmerica': 'South America',
  'data.region.africaMiddleEast': 'Africa & Middle East',
  'data.type.sun': 'Sun',
  'data.type.city': 'City',
  'data.type.adventure': 'Adventure',
  'data.window.morning': 'Morning',
  'data.window.afternoon': 'Afternoon',
  'data.window.evening': 'Evening',
  'data.window.redeye': 'Red-eye',
  'data.length.day': 'Day trip',
  'data.length.weekend': 'Long weekend',
  'data.length.week': 'A week+',
  'data.hub.YUL': 'Montréal',
  'data.hub.YQB': 'Québec City',
  'data.hub.YTZ': 'Toronto Island',
  /** Monday-first one-letter weekday initials, joined (split by weekdayLetters()). */
  'data.weekdayLetters': 'MTWTFSS',
} satisfies Messages;
