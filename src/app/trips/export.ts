/**
 * Backup export / import (spec §1.2): one JSON file with the trips and the
 * flight log. Import merges by id; the newer updatedAt wins.
 */
import { FlightLog, Outcome, Trip, TripsFile, TRIPS_SCHEMA, instanceKey } from './model';
import { migrateFlightLog, sanitizeTrip } from './storage';

export const BACKUP_KIND = 'routes-backup';

export function exportBackup(trips: TripsFile, log: FlightLog, now: number): string {
  return JSON.stringify({
    kind: BACKUP_KIND,
    schema: 1,
    exportedAt: new Date(now).toISOString(),
    trips: trips.trips,
    flightlog: log,
  }, null, 1);
}

/** 'routes-trips-2026-10-01.json' (UTC date of `now`). */
export function backupFilename(now: number): string {
  return `routes-trips-${new Date(now).toISOString().slice(0, 10)}.json`;
}

export function parseBackup(text: string): { trips: Trip[]; log: FlightLog } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "This file isn't a Routes backup." };
  }
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r || r['kind'] !== BACKUP_KIND || !Array.isArray(r['trips'])) {
    return { error: "This file isn't a Routes backup." };
  }
  if (typeof r['schema'] === 'number' && r['schema'] > TRIPS_SCHEMA) {
    return { error: 'This backup was made by a newer version of the app. Update the app, then try again.' };
  }
  const trips = (r['trips'] as unknown[]).map(sanitizeTrip).filter((t): t is Trip => !!t);
  const log = migrateFlightLog(r['flightlog'] ?? null).file;
  return { trips, log };
}

function mergeById<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  const ids = new Set(current.map(x => x.id));
  return [...current, ...incoming.filter(x => !ids.has(x.id))];
}

/** Merges a backup into the current data: trips by id (newer updatedAt wins), notes and outcomes by id. */
/**
 * One outcome per flight and trip (the same rule recordOutcome follows): a
 * correction is stored under a new id, so the newer recordedAt wins.
 */
export function mergeOutcomes(current: readonly Outcome[], incoming: readonly Outcome[]): Outcome[] {
  const byKey = new Map<string, Outcome>();
  for (const o of [...current, ...incoming]) {
    const k = `${instanceKey(o)}|${o.tripId ?? ''}`;
    const cur = byKey.get(k);
    if (!cur || Date.parse(o.recordedAt) > Date.parse(cur.recordedAt)) byKey.set(k, o);
  }
  return [...byKey.values()];
}

export function mergeBackup(
  current: { trips: readonly Trip[]; log: FlightLog },
  incoming: { trips: readonly Trip[]; log: FlightLog },
): { trips: Trip[]; log: FlightLog; added: number; updated: number } {
  const byId = new Map(current.trips.map(t => [t.id, t]));
  let added = 0, updated = 0;
  for (const t of incoming.trips) {
    const cur = byId.get(t.id);
    if (!cur) {
      byId.set(t.id, t);
      added++;
    } else if (Date.parse(t.updatedAt) > Date.parse(cur.updatedAt)) {
      byId.set(t.id, t);
      updated++;
    }
  }
  return {
    trips: [...byId.values()],
    log: {
      schema: 1,
      notes: mergeById(current.log.notes, incoming.log.notes),
      outcomes: mergeOutcomes(current.log.outcomes, incoming.log.outcomes),
      dismissed: [...new Set([...current.log.dismissed, ...incoming.log.dismissed])],
    },
    added,
    updated,
  };
}
