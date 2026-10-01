/**
 * Pure helpers for the add-pass flow (extras spec §6.1): turn decoder reads
 * into one draft per BCBP leg, describe the match, and build the PassRecord
 * input. A match is only a suggestion; nothing here picks a leg the user has
 * not confirmed, and nothing changes a leg's status.
 */
import type { TimeFormat } from '../../state/prefs.service';
import { julianToDateKey, normalizeFlightNumber, parseBcbp } from '../../passes/bcbp';
import { matchPassLeg, matchingAlternate, unmatchedDateKey } from '../../passes/match';
import type {
  BarcodeFormat, BcbpLeg, BcbpPassenger, DecodedRead, MatchCandidate, NewPass, PassRecord,
} from '../../passes/model';
import type { FlightLeg, FlightRef, Trip } from '../../trips/model';
import { refsRoute, refsTimes, dayLabel, monthDay, legById } from '../trips/trips-model';

/** Where the pass came from. */
export type PassSource = PassRecord['source'];

/** One BCBP leg of one decoded barcode, ready for the check step. */
export interface PassDraft {
  key: string;                      // `${readIndex}:${legIndex}`
  readIndex: number;
  legIndex: number;                 // 0-based leg inside the barcode
  legCount: number;
  raw: string;
  format: BarcodeFormat;
  page: number | null;
  passenger: BcbpPassenger;
  leg: BcbpLeg;
  flightNumber: string;             // 'AC834'
  candidates: MatchCandidate[];
  /** A backup (alternate) flight with this number and route, when nothing matched. */
  alternate: { legId: string; ref: FlightRef } | null;
  /** The pass date resolved against the best candidate, else the trip's first day; null = ask the user. */
  dateKey: string | null;
}

/** The leg the user chose for a draft: a trip leg (with the segment) or "no leg". */
export type DraftChoice = { legId: string; refIndex: number; matched: 'confirmed' | 'manual' } | { legId: null };

/** Reads → drafts (non-BCBP reads are dropped; duplicate barcode texts are kept once). */
export function buildDrafts(reads: readonly DecodedRead[], trip: Trip): PassDraft[] {
  const out: PassDraft[] = [];
  const seen = new Set<string>();
  reads.forEach((read, readIndex) => {
    if (seen.has(read.text)) return;
    seen.add(read.text);
    const p = parseBcbp(read.text);
    if (!p.ok) return;
    p.legs.forEach((leg, legIndex) => {
      const candidates = matchPassLeg(leg, p.passenger.issueDate, trip);
      out.push({
        key: `${readIndex}:${legIndex}`, readIndex, legIndex, legCount: p.legs.length,
        raw: read.text, format: read.format, page: read.page,
        passenger: p.passenger, leg,
        flightNumber: normalizeFlightNumber(leg.carrier, leg.flightNumber),
        candidates,
        alternate: candidates.length ? null : matchingAlternate(leg, trip),
        dateKey: candidates[0]?.dateKey ?? unmatchedDateKey(leg, p.passenger.issueDate, trip),
      });
    });
  });
  return out;
}

/**
 * The choice shown before the user touches anything: the single candidate
 * (the user still confirms it by saving), or the candidate on the leg the
 * page was opened from. With several candidates and no hint, or none at all,
 * nothing is chosen.
 */
export function initialChoice(d: PassDraft, hintLegId: string | null): DraftChoice | null {
  const hinted = hintLegId ? d.candidates.find(c => c.legId === hintLegId) : undefined;
  const c = hinted ?? (d.candidates.length === 1 ? d.candidates[0] : undefined);
  return c ? { legId: c.legId, refIndex: c.refIndex, matched: 'confirmed' } : null;
}

/** A leg the user picked by hand: 'confirmed' when it is one of the candidates, else 'manual'. */
export function pickLeg(d: PassDraft, trip: Trip, legId: string | null): DraftChoice {
  if (!legId) return { legId: null };
  const c = d.candidates.find(x => x.legId === legId);
  if (c) return { legId, refIndex: c.refIndex, matched: 'confirmed' };
  const leg = legById(trip, legId);
  const refs = leg?.kind === 'flight' ? leg.refs : [];
  const i = refs.findIndex(r => r.origin === d.leg.from && r.dest === d.leg.to);
  return { legId, refIndex: Math.max(0, i), matched: 'manual' };
}

/** The flight legs a pass can be saved to (replaced legs included: a pass may still be wanted). */
export function flightLegs(trip: Trip): FlightLeg[] {
  return trip.legs.filter((l): l is FlightLeg => l.kind === 'flight' && l.refs.length > 0);
}

/** 'AC834 · YUL → MAD · Thu Oct 8' for the leg picker. */
export function legOptionLabel(leg: FlightLeg): string {
  const nums = leg.refs.map(r => r.flightNumber).join(' + ');
  return `${nums} · ${refsRoute(leg.refs)} · ${dayLabel(leg.refs[0].dateKey)}`;
}

/** 'Seville trip · Thu Oct 8 · YUL 17:55 → MAD 06:50⁺¹' (times are Scheduled). */
export function matchLine(trip: Trip, ref: FlightRef, fmt: TimeFormat): string {
  const times = refsTimes([ref], fmt).split(' → ');
  return `${trip.name} · ${dayLabel(ref.dateKey)} · ${ref.origin} ${times[0]} → ${ref.dest} ${times[1] ?? ''}`.trim();
}

/** 'Day 281' and '= Oct 8' ('= ?' when no year fits). */
export function julianLabel(julian: number, dateKey: string | null): { day: string; date: string } {
  return { day: `Day ${julian}`, date: dateKey ? `= ${monthDay(dateKey)}` : '= ?' };
}

/** 'PDF417 · 1 leg', 'Aztec · 2 legs'. */
export function barcodeLabel(format: BarcodeFormat, legCount: number): string {
  const f = format === 'QRCode' ? 'QR code' : format;
  return `${f} · ${legCount} ${legCount === 1 ? 'leg' : 'legs'}`;
}

/** "This pass is for AC812, one of your backups. …" (backups are not matched in v1). */
export function alternateText(flightNumber: string): string {
  return `This pass is for ${flightNumber}, one of your backups. Swap the leg in the trip first, or save the pass to a leg yourself.`;
}

/** The date a draft is saved with for a given choice (null when no year fits and the user gave none). */
export function draftDateKey(d: PassDraft, choice: DraftChoice | null, trip: Trip, userDate: string | null): string | null {
  if (choice && choice.legId) {
    const c = d.candidates.find(x => x.legId === choice.legId && x.refIndex === choice.refIndex);
    if (c) return c.dateKey;
    const leg = legById(trip, choice.legId);
    const ref = leg?.kind === 'flight' ? leg.refs[choice.refIndex] ?? leg.refs[0] : undefined;
    if (ref) {
      const k = julianToDateKey(d.leg.julian, ref.dateKey, d.passenger.issueDate);
      if (k) return k;
    }
  }
  return d.dateKey ?? (userDate || null);
}

/** PassesService.save input for one draft. */
export function toNewPass(
  d: PassDraft, trip: Trip, choice: DraftChoice | null, opts: { source: PassSource; deleteAfterTrip: boolean; userDate: string | null },
): NewPass {
  const linked = choice && choice.legId ? choice : null;
  return {
    tripId: trip.id,
    legId: linked ? linked.legId : null,
    refIndex: linked ? linked.refIndex : null,
    matched: linked ? linked.matched : 'none',
    raw: d.raw,
    format: d.format,
    bcbpLeg: d.legIndex,
    lastName: d.passenger.lastName,
    firstName: d.passenger.firstName,
    pnr: d.leg.pnr,
    from: d.leg.from,
    to: d.leg.to,
    flightNumber: d.flightNumber,
    julian: d.leg.julian,
    dateKey: draftDateKey(d, choice, trip, opts.userDate),
    cabin: d.leg.cabin,
    seat: d.leg.seat,
    sequence: d.leg.sequence,
    source: opts.source,
    page: d.page,
    deleteAfterTrip: opts.deleteAfterTrip,
  };
}

/** 'Pass saved to AC834', '2 passes saved', 'Pass saved to the trip'. */
export function savedText(saved: readonly PassRecord[]): string {
  if (saved.length > 1) return `${saved.length} passes saved`;
  const p = saved[0];
  return p?.legId ? `Pass saved to ${p.flightNumber}` : 'Pass saved to the trip';
}

/** 'Doe/John'-style name as decoded ('DOE/JOHN' stays as on the pass). */
export function passName(p: { lastName: string; firstName: string }): string {
  return p.firstName ? `${p.lastName}/${p.firstName}` : p.lastName;
}

/** Leg statuses for which "Set leg to Checked in" is offered. */
export function offersCheckIn(trip: Trip, legId: string | null): boolean {
  const leg = legById(trip, legId);
  return !!leg && (leg.status === 'planned' || leg.status === 'listed');
}
