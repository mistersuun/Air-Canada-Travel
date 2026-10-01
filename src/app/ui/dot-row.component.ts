import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { WEEKDAY_SHORT } from '../utils/time';
import type { RouteEntry } from '../utils/routes';

/** One weekday's state: a nonstop ('on'), only a connection, nothing, or unpublished. */
export type DotDay = 'on' | 'off' | 'connect' | 'outside';

/**
 * Mon–Sun dots for a route entry's week: 'on' when a nonstop flies, else
 * 'connect' when a connection does, 'outside' beyond the published window.
 */
export function entryDots(e: Pick<RouteEntry, 'weekDays' | 'weekSummary'>): DotDay[] {
  return e.weekDays.map((d, i) => {
    if (d.coverage === 'outside') return 'outside';
    if (d.flies) return 'on';
    return (e.weekSummary?.days[i]?.connections ?? 0) > 0 ? 'connect' : 'off';
  });
}

/** 'Flies Mon, Tue, Thu' (+ '; connections Wed'), or 'No flights this week'. */
export function dotsLabel(days: readonly DotDay[]): string {
  const on = days.flatMap((d, i) => (d === 'on' ? [WEEKDAY_SHORT[i]] : []));
  const conn = days.flatMap((d, i) => (d === 'connect' ? [WEEKDAY_SHORT[i]] : []));
  const parts: string[] = [];
  if (on.length === 7) parts.push('Flies daily');
  else if (on.length) parts.push(`Flies ${on.join(', ')}`);
  if (conn.length) parts.push(`${on.length ? 'connections' : 'Connections'} ${conn.join(', ')}`);
  if (!parts.length) return days.some(d => d === 'outside') ? 'Schedules not yet published' : 'No flights this week';
  return parts.join('; ');
}

/**
 * Seven weekday dots (`.dots7`): teal for a nonstop, amber for a connection
 * only, --hair for none, a hollow ring outside the published window. The
 * selected day gets a soft red ring.
 *
 *   <app-dot-row [days]="dots" [selected]="2" size="sm" />
 */
@Component({
  selector: 'app-dot-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'img',
    '[attr.aria-label]': 'label()',
    '[class.is-sm]': "size() === 'sm'",
  },
  template: `
    @for (d of days(); track $index) {
      <i [class]="d" [class.sel]="$index === selected()"></i>
    }
  `,
  styles: [`
    :host { display: flex; gap: 4px; flex: none; align-items: center; }
    :host(.is-sm) { gap: 3px; }
    i { width: 7px; height: 7px; border-radius: 50%; background: var(--hair); }
    :host(.is-sm) i { width: 6px; height: 6px; }
    i.on { background: var(--teal); }
    i.connect { background: var(--amber); }
    i.outside { background: transparent; box-shadow: inset 0 0 0 1px var(--hair); }
    i.sel { box-shadow: 0 0 0 2px color-mix(in srgb, var(--red) 35%, transparent); }
    i.outside.sel { box-shadow: inset 0 0 0 1px var(--hair), 0 0 0 2px color-mix(in srgb, var(--red) 35%, transparent); }
  `],
})
export class DotRowComponent {
  readonly days = input<readonly DotDay[]>([]);
  readonly selected = input<number | null>(null);
  readonly size = input<'sm' | 'md'>('md');

  protected readonly label = computed(() => dotsLabel(this.days()));
}
