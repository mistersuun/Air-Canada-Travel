/**
 * Trip attachments (extras spec §1.1): files, photos, notes and addresses
 * attached to a trip, a leg or a day. Kept in IndexedDB on this device only;
 * they go into a backup only when the user turns on "Include files in backups".
 */
export const FILES_DB = 'routes-files';
export const FILES_DB_VERSION = 1;
export const FILES_PREFS_KEY = 'ac.files.v1';
/** Refuse larger files with a message. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Compress larger photos (when FilesPrefs.compressPhotos). */
export const PHOTO_MAX_SIDE = 2560;

export type AttachmentScope =
  | { kind: 'trip' }
  | { kind: 'leg'; legId: string }
  | { kind: 'day'; dateKey: string };

export type AttachmentKind = 'pdf' | 'image' | 'file' | 'note' | 'address';

export interface Attachment {
  v: 1;
  id: string;                    // newId() from trips/ids.ts
  tripId: string;
  scope: AttachmentScope;
  kind: AttachmentKind;
  title: string;                 // 'Train tickets', defaults to the file name without extension
  text: string | null;           // note body, or the address for kind 'address'
  blobId: string | null;         // content, for pdf/image/file
  thumbBlobId: string | null;    // ≤ 320px JPEG thumb for images (P2; null is fine)
  mime: string | null;
  bytes: number;                 // content bytes (0 for note/address)
  pages: number | null;          // PDFs, when cheaply known; else null
  createdAt: string;             // ISO instant
  updatedAt: string;
}

export interface StoredBlob { id: string; blob: Blob; bytes: number; mime: string; createdAt: string }

export interface FilesPrefs {
  includeInBackup: boolean;       // default false
  deletePassesAfterTrip: boolean; // default false; the default for new passes' deleteAfterTrip
  compressPhotos: boolean;        // default true
}

export const DEFAULT_FILES_PREFS: FilesPrefs = { includeInBackup: false, deletePassesAfterTrip: false, compressPhotos: true };

export type FilesStatus = 'idle' | 'loading' | 'ready' | 'memory' | 'readOnly' | 'error';
export type FilesError = 'quota' | 'tooLarge' | 'unsupported' | 'readOnly' | 'failed';

/** User-facing copy per FilesError (the quota copy takes the file size). */
export const FILES_ERROR_TEXT: Record<FilesError, string> = {
  quota: 'Not enough space on this phone for this file. Delete some files or photos, then try again.',
  tooLarge: 'This file is over 50 MB. Pick a smaller one.',
  unsupported: "Files can't be kept on this browser.",
  readOnly: 'Files were saved by a newer version of the app, so they cannot be changed here.',
  failed: "Couldn't save this file. Try again.",
};

/** Shown when IndexedDB is unavailable and files live in memory only. */
export const MEMORY_WARNING = "Files can't be kept on this browser. They'll be gone when you close the app.";
/** Flashed when another tab upgraded the database. */
export const VERSION_CHANGE_NOTICE = 'Routes was updated in another tab. Reload to keep using files.';

export interface UsageSummary {
  count: number;                 // attachments + passes
  bytes: number;                 // sum of blob bytes we own (not the origin's total)
  byCategory: { passes: number; pdfs: number; photos: number; notes: number; other: number }; // bytes
}

export function emptyUsage(): UsageSummary {
  return { count: 0, bytes: 0, byCategory: { passes: 0, pdfs: 0, photos: 0, notes: 0, other: 0 } };
}

/** Same scope (kind and target). */
export function sameScope(a: AttachmentScope, b: AttachmentScope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'leg') return a.legId === (b as { legId: string }).legId;
  if (a.kind === 'day') return a.dateKey === (b as { dateKey: string }).dateKey;
  return true;
}
