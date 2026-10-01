/**
 * Schedule change detection (spec §2.9). Compares each open flight segment of
 * a trip with the current schedules. Changes are proposals: nothing here
 * edits a trip's plan (an aircraft-only change is a display fact, refreshed
 * by refreshAircraft). Wording elsewhere: "not found in the latest
 * schedules", never "cancelled".
 */
import { getSchedulesMeta, isCovered } from '../../data/schedule-index';
import { FlightRef, PendingChange, Trip, isFinalStatus } from '../model';
import { newId } from '../ids';
import { refFromInstance, resolveRef } from './legs';

/** A finding before it becomes a stored PendingChange. */
export interface ChangeFinding {
  legId: string;
  refIndex: number;
  kind: PendingChange['kind'];
  old: FlightRef;
  next: FlightRef | null;
}

/** Every open segment of a trip, with what the current schedules say about it. */
export function scanTrip(trip: Trip): { checked: number; findings: ChangeFinding[] } {
  const findings: ChangeFinding[] = [];
  let checked = 0;
  for (const leg of trip.legs) {
    if (leg.kind !== 'flight' || isFinalStatus(leg.status)) continue;
    leg.refs.forEach((old, refIndex) => {
      checked++;
      if (!isCovered(old.dateKey, old.origin)) {
        findings.push({ legId: leg.id, refIndex, kind: 'outsideCoverage', old, next: null });
        return;
      }
      const inst = resolveRef(old);
      if (!inst) {
        findings.push({ legId: leg.id, refIndex, kind: 'notFound', old, next: null });
        return;
      }
      const next = { ...refFromInstance(inst), flightNumber: old.flightNumber };
      if (next.depLocal !== old.depLocal || next.arrLocal !== old.arrLocal || next.arrDateKey !== old.arrDateKey) {
        findings.push({ legId: leg.id, refIndex, kind: 'retimed', old, next });
      }
    });
  }
  return { checked, findings };
}

/** Dedupe key: leg + segment + kind + the new times. */
export function changeKey(c: Pick<ChangeFinding, 'legId' | 'refIndex' | 'kind' | 'next'>): string {
  const n = c.next;
  return `${c.legId}|${c.refIndex}|${c.kind}|${n ? `${n.dateKey} ${n.depLocal}-${n.arrDateKey} ${n.arrLocal}` : ''}`;
}

/** New open changes only (one already stored in any state is not raised again). */
export function detectChanges(trip: Trip, nowIso: string): PendingChange[] {
  const known = new Set(trip.changes.map(changeKey));
  const generatedAt = getSchedulesMeta()?.generatedAt ?? null;
  return scanTrip(trip).findings
    .filter(f => !known.has(changeKey(f)))
    .map(f => ({ id: newId(), ...f, generatedAt, detectedAt: nowIso, state: 'open' as const }));
}

/** Segments checked across trips (the denominator of looksLikeBadData). */
export function checkedSegments(trips: readonly Trip[]): number {
  return trips.reduce((n, t) => n + scanTrip(t).checked, 0);
}

/**
 * True when the new schedules look broken rather than changed: more than half
 * of all checked segments (at least 2) are not found. The service then
 * stores none of the findings and says "The latest schedules look
 * incomplete. Your plans are unchanged."
 */
export function looksLikeBadData(allTrips: Trip[], found: PendingChange[]): boolean {
  const checked = checkedSegments(allTrips);
  const notFound = found.filter(c => c.kind === 'notFound').length;
  return checked >= 2 && notFound * 2 > checked;
}

/**
 * The trip with each open segment's aircraft refreshed from the schedules
 * (a display fact, applied silently). Returns the same object when nothing
 * changed.
 */
export function refreshAircraft(trip: Trip): Trip {
  let changed = false;
  const legs = trip.legs.map(leg => {
    if (leg.kind !== 'flight' || isFinalStatus(leg.status)) return leg;
    let legChanged = false;
    const refs = leg.refs.map(r => {
      const inst = resolveRef(r);
      if (!inst || inst.depLocal !== r.depLocal || inst.arrLocal !== r.arrLocal || inst.arrDateKey !== r.arrDateKey) return r;
      if (inst.aircraft === r.aircraft) return r;
      legChanged = true;
      return { ...r, aircraft: inst.aircraft };
    });
    if (!legChanged) return leg;
    changed = true;
    return { ...leg, refs };
  });
  return changed ? { ...trip, legs } : trip;
}
