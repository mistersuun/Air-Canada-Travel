import { SCHEDULES_URL } from '../../../data/schedule-index';
import { CITIES_URL } from '../../../places/city-index';
import { GROUND_URL } from '../../../places/ground-timetable.service';
import { CLIMATE_URL } from '../../../recs/climate.service';
import { PHOTO_BASE } from '../../../state/photo.service';
import type { Trip } from '../../../trips/model';

export type OfflineItemId = 'schedules' | 'ground' | 'cities' | 'climate' | 'photos';

export interface OfflineItem {
  id: OfflineItemId;
  label: string;
  urls: string[];
}

export interface OfflineItemResult {
  id: OfflineItemId;
  label: string;
  ok: boolean;
}

/** The trip's destination airport code (the place's own, else where the outbound flight lands), or null. */
export function tripDestCode(trip: Trip): string | null {
  if (trip.goal.acCode) return trip.goal.acCode;
  for (const leg of trip.legs) {
    if (leg.kind === 'flight' && leg.role === 'outbound' && leg.refs.length) return leg.refs[leg.refs.length - 1].dest;
  }
  return null;
}

/**
 * What "Save for offline" warms for a trip. Ground timetables only when the
 * trip has ground legs; photos only when the destination has one in the manifest.
 */
export function offlineItems(trip: Trip, hasPhoto: (code: string) => boolean, hasHero: (code: string) => boolean = () => false): OfflineItem[] {
  const items: OfflineItem[] = [{ id: 'schedules', label: 'Schedules', urls: [SCHEDULES_URL] }];
  if (trip.legs.some(l => l.kind === 'ground')) items.push({ id: 'ground', label: 'Trains', urls: [GROUND_URL] });
  items.push({ id: 'cities', label: 'City info', urls: [CITIES_URL] });
  items.push({ id: 'climate', label: 'Weather', urls: [CLIMATE_URL] });
  const code = tripDestCode(trip);
  if (code && hasPhoto(code)) {
    const urls = [`${PHOTO_BASE}${code}-400.webp`, `${PHOTO_BASE}${code}.webp`];
    if (hasHero(code)) urls.push(`${PHOTO_BASE}${code}-1920.webp`);
    items.push({ id: 'photos', label: 'Photos', urls });
  }
  return items;
}

/** Fetches every URL of every item; an item is ok only when all of its URLs answered 2xx. Never rejects. */
export async function warmOffline(
  items: readonly OfflineItem[],
  fetcher: (url: string) => Promise<{ ok: boolean }>,
): Promise<OfflineItemResult[]> {
  return Promise.all(items.map(async ({ id, label, urls }) => {
    const oks = await Promise.all(urls.map(async u => {
      try { return (await fetcher(u)).ok; } catch { return false; }
    }));
    return { id, label, ok: oks.every(Boolean) };
  }));
}

/** 'Schedules ✓ · Trains ✓ · City info ✗' */
export function offlineReportLabel(results: readonly OfflineItemResult[]): string {
  return results.map(r => `${r.label} ${r.ok ? '✓' : '✗'}`).join(' · ');
}

/** The toast: all saved, or what is still missing. */
export function offlineFlash(results: readonly OfflineItemResult[]): string {
  const missing = results.filter(r => !r.ok).map(r => r.label);
  if (!missing.length) return 'Saved for offline';
  if (results.find(r => r.id === 'schedules')?.ok === false) return 'Plan saved. Schedules need a connection to download.';
  return `Saved for offline, but not yet: ${missing.join(', ')}`;
}
