/**
 * When to remind the traveller to export a backup (trips live on this device
 * only). Facts, not alarms: nothing here is shown unless trips or the flight
 * log changed since the last export, and then only when the last export is
 * old or a flight leaves soon.
 */
import { legWindow } from './engine/legs';
import { FlightLog, Trip, isFinalStatus } from './model';

export const BACKUP_STALE_DAYS = 14;
export const BACKUP_SOON_HOURS = 72;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function ms(iso: string | null): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
}

/** Latest time anything in the flight log was written (notes and outcomes), or null for an empty log. */
function latestLog(log: FlightLog | null): number | null {
  const times = [...(log?.notes ?? []).map(n => ms(n.at)), ...(log?.outcomes ?? []).map(o => ms(o.recordedAt))]
    .filter((t): t is number => t !== null);
  return times.length ? Math.max(...times) : null;
}

/** Departure (UTC ms) of each flight leg still to fly (not boarded, dropped or missed). */
function upcomingDepartures(t: Trip): number[] {
  return t.legs
    .filter(l => l.kind === 'flight' && l.refs.length > 0 && !isFinalStatus(l.status))
    .map(l => legWindow(l)?.depUtc)
    .filter((d): d is number => d !== undefined);
}

/** Not archived and the last flight left less than a day ago (or hasn't yet). */
function live(t: Trip, nowMs: number): boolean {
  if (t.archived) return false;
  const deps = t.legs.filter(l => l.kind === 'flight' && l.refs.length > 0).map(l => legWindow(l)?.depUtc ?? 0);
  return !deps.length || Math.max(...deps) >= nowMs - DAY_MS;
}

/**
 * The reminder text, or null when no reminder is due. "Days" are whole days
 * since the last backup, rounded down, so 14 days 23 h counts as 14 and does not nudge yet.
 */
export function backupNudge(
  trips: readonly Trip[], log: FlightLog | null, lastBackupAt: string | null, nowMs: number,
): string | null {
  const last = ms(lastBackupAt);
  const since = (t: number | null): boolean => last === null || (t ?? 0) > last;
  const changed = trips.filter(t => since(ms(t.updatedAt)));
  const departing = changed.some(t => !t.archived
    && upcomingDepartures(t).some(d => d >= nowMs && d - nowMs <= BACKUP_SOON_HOURS * HOUR_MS));
  if (departing) return 'A flight leaves within 3 days and has changed since your last backup.';
  const logTime = latestLog(log);
  const logChanged = logTime !== null && since(logTime);
  // Never backed up: only live trips (or a flight log with entries) are worth a reminder.
  const anyChange = last === null ? changed.some(t => live(t, nowMs)) || logChanged : changed.length > 0 || logChanged;
  if (!anyChange) return null;
  if (last === null) return 'No backup yet. A copy outside this phone keeps your trips safe.';
  const days = Math.floor((nowMs - last) / DAY_MS);
  if (days > BACKUP_STALE_DAYS) return `Changes since your last backup, ${days} days ago.`;
  return null;
}
