import type { Messages } from '../catalogue';

/** Add to a trip from the share sheet (pages/share-in, share-in/). Chunk B in docs/i18n.md; keys start with 'shareIn.'. */
export const shareIn = {
  'shareIn.title': 'Add to a trip',
  'shareIn.opening': 'Opening what you shared…',
  'shareIn.nothing': 'Nothing to add.',
  'shareIn.nothing.hint': 'This share has expired or was already used.',
  'shareIn.myTrips': 'My trips',
  'shareIn.noTrips': 'You have no trips yet.',
  'shareIn.noTrips.hint': 'Start a trip first, then share again.',
  'shareIn.findFlight': 'Find a flight',
  'shareIn.trip': 'Trip',
  'shareIn.passLike': 'This looks like a boarding pass.',
  'shareIn.saveFile': 'Save to trip files',
  'shareIn.saveNote': 'Save as a note',
  'shareIn.sharedText': 'Shared text',
  'shareIn.sharedNote': 'Shared note',
  'shareIn.privacy': 'Stays on this device. Nothing is uploaded.',
  'shareIn.notNow': 'Not now',
  'shareIn.savedFile': 'Saved to trip files',
  'shareIn.savedNote': 'Saved as a note',
  'shareIn.tooLarge': 'That share is too big to receive. Share up to 5 files, 25 MB in all.',
  'shareIn.failed': "Couldn't receive that share. Try again.",
  'shareIn.notify.title': 'Schedules updated',
  'shareIn.notify.body': 'Open to check your trips.',
} satisfies Messages;
