import type { Messages } from '../catalogue';

/** Saved (pages/saved). Chunk C in docs/i18n.md; keys start with 'saved.'. */
export const saved = {
  'saved.title': 'Saved',
  'saved.countAria': '{n} saved',
  'saved.tab.upcoming': 'Upcoming',
  'saved.tab.watching': 'Watching',
  'saved.viewAria': 'Saved view',
  'saved.empty.title': 'Nothing saved yet',
  'saved.empty.text': 'Tap ★ on a destination to keep it here.',
  'saved.empty.cta': 'Explore destinations',
  'saved.noFlights': 'No flights published',
  'saved.remove': 'Remove {city} from saved',
  'saved.showing': 'Showing {week}',
  'saved.thatWeek': '{n}× that week',
  'saved.ends': 'ends {date}',
} satisfies Messages;
