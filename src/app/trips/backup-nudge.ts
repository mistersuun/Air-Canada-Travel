/**
 * When to remind the traveller to export a backup (trips live on this device
 * only). Facts, not alarms: nothing here is shown unless trips changed since
 * the last export, and then only when the last export is old or a trip leaves soon.
 */
import { legWindow } from './engine/legs';
import type { Trip } from './model';

export const BACKUP_STALE_DAYS = 14;
export const BACKUP_SOON_HOURS = 72;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function ms(iso: string | null): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
}

/** Departure (UTC ms) of the trip's first flight, or null when no flight has times. */
function firstDeparture(t: Trip): number | null {
  const leg = t.legs.find(l => l.kind === 'flight' && l.refs.length > 0);
  return leg ? legWindow(leg)?.depUtc ?? null : null;
}

/** The reminder text, or null when no reminder is due. */
export function backupNudge(trips: readonly Trip[], lastBackupAt: string | null, nowMs: number): string | null {
  const last = ms(lastBackupAt);
  const changed = trips.filter(t => last === null || (ms(t.updatedAt) ?? 0) > last);
  if (!changed.length) return null;
  const departing = changed.some(t => {
    const dep = !t.archived ? firstDeparture(t) : null;
    return dep !== null && dep >= nowMs && dep - nowMs <= BACKUP_SOON_HOURS * HOUR_MS;
  });
  if (departing) return 'A trip leaves within 3 days and has changed since your last backup. Export trips to keep a copy.';
  if (last === null) return 'No backup yet. Export trips to keep a copy outside this phone.';
  const days = Math.floor((nowMs - last) / DAY_MS);
  if (days > BACKUP_STALE_DAYS) return `Your trips changed since your last backup, ${days} days ago. Export trips to keep a copy.`;
  return null;
}
