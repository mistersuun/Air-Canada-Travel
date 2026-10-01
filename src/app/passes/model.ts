/**
 * Boarding passes (extras spec §1.2). A PassRecord lives in IndexedDB only and
 * is never in share links, share text or images, backups, logs or console
 * output. `raw` is kept only to redraw the barcode; it is never shown whole.
 */
import type { FlightRef } from '../trips/model';

export type BarcodeFormat = 'PDF417' | 'Aztec' | 'QRCode';
export type DecodeStep = 'native' | 'as-is' | 'invert' | 'up2x' | 'rot+7' | 'rot-7';

export interface BcbpLeg {
  pnr: string; from: string; to: string;
  carrier: string;              // 'AC'
  flightNumber: string;         // '834' (leading zeros stripped, optional suffix letter kept)
  julian: number;               // 1..366
  cabin: string; seat: string | null; sequence: string | null; paxStatus: string;
  airlineNumeric?: string | null; docSerial?: string | null; marketingCarrier?: string | null;
  ffAirline?: string | null; ffNumber?: string | null; freeBaggage?: string | null;
}
export interface BcbpPassenger {
  nameRaw: string; lastName: string; firstName: string; eTicket: boolean;
  issueDate: string | null;     // 'yddd'
  issuer: string | null;
}
export type BcbpParse =
  | { ok: true; version: string | null; legCount: number; passenger: BcbpPassenger; legs: BcbpLeg[];
      security: { present: true } | null;   // data never kept in the parse result
      warnings: string[] }
  | { ok: false; error: 'not-bcbp-m' };

export interface PassRecord {
  v: 1;
  id: string;
  tripId: string;
  legId: string | null;          // null = saved to the trip without a leg
  refIndex: number | null;       // segment within a 2-segment FlightLeg
  matched: 'confirmed' | 'manual' | 'none'; // confirmed = user accepted the suggestion; manual = user picked a leg
  raw: string;                   // full decoded text; needed to redraw the barcode. Never rendered as a whole, never exported.
  format: BarcodeFormat;
  bcbpLeg: number;               // 0-based leg index inside a multi-leg (M2..M4) barcode
  lastName: string; firstName: string;
  pnr: string;
  from: string; to: string;
  flightNumber: string;          // normalised 'AC834'
  julian: number;
  dateKey: string | null;        // julianToDateKey result; null = the user could not confirm a year
  cabin: string; seat: string | null; sequence: string | null;
  imageBlobId: string | null;    // the original image, or the rendered PDF page (PNG)
  source: 'camera' | 'image' | 'pdf';
  page: number | null;           // PDF page (1-based)
  deleteAfterTrip: boolean;
  createdAt: string;
}

export interface DecodedRead { text: string; format: BarcodeFormat; step: DecodeStep; page: number | null }

export interface MatchCandidate {
  tripId: string; legId: string; refIndex: number;
  ref: FlightRef;
  dateKey: string;               // the pass date resolved against this ref
  deltaDays: -1 | 0 | 1;
}

/** Input of PassesService.save. */
export type NewPass = Omit<PassRecord, 'v' | 'id' | 'createdAt' | 'imageBlobId'>;

/** UI copy for a decode that found nothing / found something else. */
export const NO_BARCODE_TEXT = 'No barcode found in this image.';
export const NOT_BCBP_TEXT = 'Not a boarding pass barcode.';
