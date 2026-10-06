import type { SegOption } from '../ui/seg.component';

export const LENGTH_OPTIONS: SegOption[] = [
  { value: 'day', label: 'Day trip' },
  { value: 'weekend', label: 'Long weekend' },
  { value: 'week', label: 'A week+' },
];
export const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/** Toggle a value in a list (kept in its natural order by sanitizeProfile). */
export function toggled<T>(list: readonly T[], v: T): T[] {
  return list.includes(v) ? list.filter(x => x !== v) : [...list, v];
}
