import type { Messages } from '../catalogue';

/** The settings sheet (components/settings). Sub-sections owned by other areas keep their own keys. */
export const settings = {
  'settings.title': 'Settings',
  'settings.hub': 'Home airport',
  'settings.hubHint': 'Where the app opens',
  'settings.language': 'Language',
  'settings.languageHint': 'Automatic follows your device',
  'settings.language.auto': 'Automatic',
  /** Language names are written in their own language, in every catalogue. */
  'settings.language.en': 'English',
  'settings.language.fr': 'Français',
  'settings.appearance': 'Appearance',
  'settings.theme.auto': 'Auto',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.timeFormat': 'Time format',
  'settings.connections': 'Connections',
  'settings.showConnections': 'Show connections',
  'settings.showConnectionsHint': 'Include one-stop trips through a hub',
  'settings.minConnect': 'Minimum connection',
  'settings.maxLayover': 'Maximum layover',
  'settings.listing': 'Listing reminder',
  'settings.listingLabel': 'Listing reminder, hours before departure',
  'settings.listingHint':
    'When a flight shows Listing open, and the calendar reminder. A notification when it opens needs permission, granted under background checks below. Check your own pass rules.',
  'settings.overnight': 'Overnight connections',
  'settings.overnightHint': 'Allow a layover that crosses midnight at the hub',
  'settings.logbook': 'Logbook',
  'settings.shortcuts': 'Keyboard shortcuts',
  'settings.schedules': 'Schedules',
  'settings.photoCredits': 'Photo credits',
  'settings.photo': 'Photo',
  'settings.by': 'by',
  'settings.resetDefaults': 'Reset to defaults',
  'settings.resetNote': 'Saved destinations are kept when you reset.',
  'settings.bg.title': 'Background schedule checks',
  'settings.bg.hint':
    'Once or twice a day, look for new schedules and send a notification. Android and Chrome only; the browser decides when it runs, so it is best effort.',
  'settings.bg.blocked': 'Notifications are blocked, so there is nothing to show. Allow them in your browser settings to turn this on.',
  'settings.bg.failed': 'This browser would not allow it. Install the app to your home screen or desktop and try again.',
} satisfies Messages;
