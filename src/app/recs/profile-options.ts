import { tripLengthLabel } from '../i18n/labels';
import type { SegOption } from '../ui/seg.component';

/** The trip-length choices ('Day trip', 'Long weekend', 'A week+') in the UI language. */
export function lengthOptions(): SegOption[] {
  return (['day', 'weekend', 'week'] as const).map(v => ({ value: v, label: tripLengthLabel(v) }));
}

/** Toggle a value in a list (kept in its natural order by sanitizeProfile). */
export function toggled<T>(list: readonly T[], v: T): T[] {
  return list.includes(v) ? list.filter(x => x !== v) : [...list, v];
}
