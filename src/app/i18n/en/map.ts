import type { Messages } from '../catalogue';

/** Map (pages/map). Chunk C in docs/i18n.md; keys start with 'map.'. */
export const map = {
  'map.title': 'Route map',
  'map.search': 'Search the map',
  'map.clearSearch': 'Clear search',
  'map.recentre': 'Recentre on {hub}',
  'map.zoomIn': 'Zoom in',
  'map.zoomOut': 'Zoom out',
  'map.collapse': 'Collapse list',
  'map.expand': 'Expand list',
  'map.sortBy': 'Sort by',
  'map.sort.distance': 'Distance',
  'map.sort.time': 'Time',
  'map.connGroup': 'Connections only · {n}',
  'map.open': 'Open {city}',
  'map.noMatch': 'No destinations match “{query}”.',
  'map.notPublished': 'Schedules for this week aren’t published yet.',
  'map.noFlights': '{when, select, day {No flights from {hub} on this day.} other {No flights from {hub} this week.}}',
  'map.count': '{n, plural, one {# destination} other {# destinations}}',
  'map.rowSelected': '. Selected; press again to open',
  'map.thisWeek': '{n} this week',
} satisfies Messages;
