import { tzOffsetMin } from '../../utils/time';
import { greatCircleKm } from '../../utils/geo';

export interface FactPoint { code: string; lat: number; lng: number; tz: string }
export interface FactHub { code: string; lat: number; lng: number; tz: string }

const DAY_MS = 86_400_000;

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** '6 hours ahead of Montréal' / '3 hours behind Montréal' / 'Same time as Montréal'. */
export function timeDifferenceFact(dest: FactPoint, hub: FactHub, hubLabel: string, now: number): string | null {
  if (dest.code === hub.code) return null;
  const diff = tzOffsetMin(dest.tz, now) - tzOffsetMin(hub.tz, now);
  if (!diff) return `Same time as ${hubLabel}`;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const amount = h && m ? `${h}h ${m}m` : h ? `${h} ${h === 1 ? 'hour' : 'hours'}` : `${m} minutes`;
  return `${amount} ${diff > 0 ? 'ahead of' : 'behind'} ${hubLabel}`;
}

/** '3rd-longest nonstop from YYZ' among `nonstops` (this one counted); null with fewer than 3 airports. */
export function distanceRankFact(dest: FactPoint, hub: FactHub, nonstops: readonly FactPoint[]): string | null {
  const all = nonstops.some(p => p.code === dest.code) ? nonstops : [...nonstops, dest];
  if (all.length < 3) return null;
  const km = (p: FactPoint) => greatCircleKm(hub, p);
  const sorted = [...all].sort((a, b) => km(b) - km(a) || a.code.localeCompare(b.code));
  const rank = sorted.findIndex(p => p.code === dest.code) + 1;
  if (rank === 1) return `The longest nonstop from ${hub.code}`;
  if (rank === sorted.length) return `The shortest nonstop from ${hub.code}`;
  return `${ordinal(rank)}-longest nonstop from ${hub.code}`;
}

/** Hours of daylight on `now`'s UTC day at a latitude (standard declination + sunrise equation); null for polar day or night. */
export function daylightHours(latDeg: number, now: number): number | null {
  const doy = Math.floor((now - Date.UTC(new Date(now).getUTCFullYear(), 0, 0)) / DAY_MS);
  const g = (2 * Math.PI / 365) * (doy - 1);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const lat = latDeg * Math.PI / 180;
  // 90.833 degrees: the sun's centre at the horizon, refraction included.
  const cosH = (Math.cos(90.833 * Math.PI / 180) - Math.sin(lat) * Math.sin(decl)) / (Math.cos(lat) * Math.cos(decl));
  if (cosH >= 1 || cosH <= -1) return null;
  return (2 * Math.acos(cosH) * 180 / Math.PI) / 15;
}

/** 'About 14 hours of daylight today'. */
export function daylightFact(dest: FactPoint, now: number): string | null {
  const h = daylightHours(dest.lat, now);
  if (h === null) return null;
  const whole = Math.round(h);
  return `About ${whole} ${whole === 1 ? 'hour' : 'hours'} of daylight today`;
}

/** 'The northernmost destination from YYZ' / 'The southernmost ...' (among `nonstops`, this one counted). */
export function extremeFact(dest: FactPoint, hub: FactHub, nonstops: readonly FactPoint[]): string | null {
  const all = nonstops.some(p => p.code === dest.code) ? nonstops : [...nonstops, dest];
  if (all.length < 3) return null;
  if (all.every(p => p.code === dest.code || p.lat < dest.lat)) return `The northernmost destination from ${hub.code}`;
  if (all.every(p => p.code === dest.code || p.lat > dest.lat)) return `The southernmost destination from ${hub.code}`;
  return null;
}

/** Whole days since 1970 for the day `now` falls on in `tz`. */
export function dayNumber(now: number, tz: string): number {
  return Math.floor((now + tzOffsetMin(tz, now) * 60_000) / DAY_MS);
}

/** One fact per day: stable for a destination all day, different tomorrow. Null when none apply. */
export function dailyFact(
  dest: FactPoint, hub: FactHub, hubLabel: string, nonstops: readonly FactPoint[], now: number,
): string | null {
  const facts = [
    timeDifferenceFact(dest, hub, hubLabel, now),
    distanceRankFact(dest, hub, nonstops),
    daylightFact(dest, now),
    extremeFact(dest, hub, nonstops),
  ].filter((f): f is string => !!f);
  if (!facts.length) return null;
  let h = dayNumber(now, hub.tz);
  for (const c of dest.code) h = (h * 31 + c.charCodeAt(0)) | 0;
  return facts[Math.abs(h) % facts.length];
}
