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
  'saved.chg.new': 'New: nonstop from {hub} from {date}',
  'saved.chg.newNow': 'New: nonstop from {hub}',
  'saved.chg.ends': 'Ends: last nonstop {date}',
  'saved.chg.fewer': 'Fewer days this week: {from} → {to}',
  'saved.chg.fewerWeek': 'Fewer days the week of {date}: {from} → {to}',
  'saved.chg.more': 'More days this week: {from} → {to}',
  'saved.chg.moreWeek': 'More days the week of {date}: {from} → {to}',
  'saved.chg.fromHub': '{text} (from {hub})',
} satisfies Messages;
