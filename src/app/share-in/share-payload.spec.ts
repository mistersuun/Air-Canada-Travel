import { describe, expect, it } from 'vitest';
import {
  SHARE_FAILED_TEXT, SHARE_TOO_LARGE_TEXT, actionsFor, backgroundChecksSupport, noteTextFrom, noteTitleFrom, sharedKind, stashKey, validShareId,
} from './share-payload';

describe('sharedKind', () => {
  it('routes by mime type, then by extension', () => {
    expect(sharedKind({ name: 'bp', type: 'application/pdf' })).toBe('pdf');
    expect(sharedKind({ name: 'Boarding.PDF', type: '' })).toBe('pdf');
    expect(sharedKind({ name: 'x', type: 'image/jpeg' })).toBe('image');
    expect(sharedKind({ name: 'IMG_1.HEIC', type: '' })).toBe('image');
    expect(sharedKind({ name: 'trip.ics', type: '' })).toBe('calendar');
    expect(sharedKind({ name: 'a', type: 'text/calendar' })).toBe('calendar');
    expect(sharedKind({ name: 'notes.txt', type: 'text/plain' })).toBe('text');
    expect(sharedKind({ name: 'a.zip', type: 'application/zip' })).toBe('other');
  });
});

describe('actionsFor', () => {
  it('offers the pass reader only for images and PDFs, and notes only for text', () => {
    expect(actionsFor('image')).toEqual({ pass: true, file: true, note: false });
    expect(actionsFor('pdf').pass).toBe(true);
    expect(actionsFor('text')).toEqual({ pass: false, file: true, note: true });
    expect(actionsFor('calendar')).toEqual({ pass: false, file: true, note: false });
    expect(actionsFor('other').pass).toBe(false);
  });
});

describe('note text and title', () => {
  it('joins text, file text and url, without repeating a url already in the text', () => {
    expect(noteTextFrom({ text: 'Dinner at 8', url: 'https://x.test/a' })).toBe('Dinner at 8\n\nhttps://x.test/a');
    expect(noteTextFrom({ text: 'See https://x.test/a', url: 'https://x.test/a' })).toBe('See https://x.test/a');
    expect(noteTextFrom({ text: '', url: '' }, ' from file ')).toBe('from file');
    expect(noteTextFrom({ text: '', url: '' })).toBe('');
  });

  it('titles from the share title, then the file name, then a default', () => {
    expect(noteTitleFrom({ title: ' Hotel ' }, 'a.txt')).toBe('Hotel');
    expect(noteTitleFrom({ title: '' }, 'itinerary.txt')).toBe('itinerary');
    expect(noteTitleFrom({ title: '' })).toBe('Shared note');
  });
});

describe('share limits', () => {
  it('has clear texts for a failed and an oversized share', () => {
    expect(SHARE_FAILED_TEXT).toMatch(/Try again/);
    expect(SHARE_TOO_LARGE_TEXT).toMatch(/25 MB/);
  });
});

describe('stash keys', () => {
  it('matches the service worker layout and refuses odd ids', () => {
    expect(stashKey('abc123', 'meta.json')).toBe('/__share/abc123/meta.json');
    expect(stashKey('abc123', 2)).toBe('/__share/abc123/2');
    expect(validShareId('lq3x9k2a1b')).toBe(true);
    expect(validShareId('failed')).toBe(true);
    expect(validShareId('../etc')).toBe(false);
    expect(validShareId(undefined)).toBe(false);
  });
});

describe('backgroundChecksSupport', () => {
  const reg = { periodicSync: {} };
  it('needs a worker, notifications and the periodicSync manager', () => {
    expect(backgroundChecksSupport({ hasServiceWorker: true, hasNotification: true, registration: reg })).toEqual({ supported: true, reason: 'ok' });
    expect(backgroundChecksSupport({ hasServiceWorker: false, hasNotification: true, registration: reg }).reason).toBe('no-sw');
    expect(backgroundChecksSupport({ hasServiceWorker: true, hasNotification: false, registration: reg }).reason).toBe('no-notifications');
    // Safari and Firefox: a registration without periodicSync
    expect(backgroundChecksSupport({ hasServiceWorker: true, hasNotification: true, registration: {} }).reason).toBe('no-periodic-sync');
    expect(backgroundChecksSupport({ hasServiceWorker: true, hasNotification: true, registration: null }).supported).toBe(false);
  });
});
