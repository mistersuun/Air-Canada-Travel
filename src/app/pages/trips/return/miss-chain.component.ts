import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { IconComponent, type IconName } from '../../../components/shared/icons.component';
import { AppStateService } from '../../../state/app-state.service';
import type { TimeFormat } from '../../../state/prefs.service';
import type { MissStep } from '../../../trips/engine/homeby';
import { prettyFlight, supOffset } from '../../../ui/format';
import type { Itinerary } from '../../../utils/connections';
import { formatClock } from '../../../utils/time';
import type { FlightInstance } from '../../../utils/week';
import { dayLabel } from './return-model';

export interface MissRow {
  kind: MissStep['kind'];
  icon: IconName;
  title: string;
  lines: string[];
  itinerary: Itinerary | null;
}

/** 'AC813 LIS 11:25 → YUL 13:50'. */
export function segmentText(f: FlightInstance, fmt: TimeFormat = '24h'): string {
  const num = prettyFlight(f.flightNumber) || 'Estimated leg';
  return `${num} ${f.origin} ${formatClock(f.depLocal, fmt)} → ${f.dest} ${formatClock(f.arrLocal, fmt)}${supOffset(f.arrDayOffset)}`;
}

/** '8h', '45 min': the spare time, whole hours from one hour up. */
export function spareText(min: number): string {
  return min >= 60 ? `${Math.floor(min / 60)}h` : `${Math.max(0, Math.round(min))} min`;
}

/**
 * Display rows for a miss-one chain:
 *   Try 1 · AC813 LIS 11:25 → YUL 13:50 / Home with 8h to spare
 *   If you miss it · AC811 LIS 13:00 → YYZ 15:55 / then AC422 YYZ 18:00 → YUL 19:21 · 2 standby legs
 *   If you miss both / Next is AC813 Wed Oct 14 · lands after your deadline
 */
export function missRows(
  steps: readonly MissStep[],
  opts: { fmt?: TimeFormat; arrive?: string; lateNote?: string } = {},
): MissRow[] {
  const fmt = opts.fmt ?? '24h';
  const arrive = opts.arrive ?? 'Home';
  const lateNote = opts.lateNote ?? 'lands after your deadline';
  return steps.map(s => {
    const it = s.itinerary;
    if (s.kind === 'late') {
      let line: string;
      if (!it) {
        line = 'Nothing later found in our schedule data';
      } else {
        const nums = it.legs.map(l => prettyFlight(l.flightNumber) || 'an estimated leg').join(' + ');
        const via = it.hubs.length ? ` via ${it.hubs.join(', ')}` : '';
        line = `Next is ${nums} ${dayLabel(it.dateKey)}${via} · ${lateNote}`;
      }
      return { kind: s.kind, icon: 'close', title: s.label, lines: [line], itinerary: it };
    }
    if (!it || !it.legs.length) return { kind: s.kind, icon: 'plane', title: s.label, lines: [], itinerary: it };
    const lines: string[] = [];
    if (it.legs.length > 1) {
      const rest = it.legs.slice(1).map(l => segmentText(l, fmt)).join(', then ');
      lines.push(`then ${rest} · ${it.legs.length} standby legs`);
    }
    if (s.kind === 'try' && s.slackMin !== null) {
      lines.push(s.slackMin <= 0 ? `${arrive} right at your deadline` : `${arrive} with ${spareText(s.slackMin)} to spare`);
    }
    return {
      kind: s.kind,
      icon: s.kind === 'try' ? 'plane' : 'retry',
      title: `${s.label} · ${segmentText(it.legs[0], fmt)}`,
      lines,
      itinerary: it,
    };
  });
}

/**
 * The miss-one chain as a vertical timeline (plane / retry / x). Used by the
 * Return tab and by S1's leg sheet for the outbound:
 *
 *   <app-miss-chain [steps]="steps" />
 *   <app-miss-chain [steps]="steps" arrive="Madrid" lateNote="lands after you wanted"
 *                   actionLabel="Use as return" (pick)="use($event)" />
 *
 * With `actionLabel`, every try and fallback row gets a small button that
 * emits its itinerary.
 */
@Component({
  selector: 'app-miss-chain',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="mc" aria-label="If you miss a flight">
      @for (r of rows(); track $index) {
        <li class="mc__it" [class]="'mc__it mc__it--' + r.kind" [attr.data-step]="r.kind">
          <span class="mc__ic" aria-hidden="true"><b><app-icon [name]="r.icon" [size]="12" [strokeWidth]="2.2" /></b><u></u></span>
          <div class="mc__b">
            <div class="mc__t tn">{{ r.title }}</div>
            @for (l of r.lines; track $index) { <div class="mc__m tn">{{ l }}</div> }
            @if (actionLabel() && r.kind !== 'late' && r.itinerary) {
              <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm mc__act" (click)="pick.emit(r.itinerary)">{{ actionLabel() }}</button>
            }
          </div>
        </li>
      }
    </ol>
  `,
  styles: [`
    :host { display: block; }
    .mc { list-style: none; margin: 0; padding: 0; display: grid; }
    .mc__it { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 10px; }
    .mc__ic { display: flex; flex-direction: column; align-items: center; }
    .mc__ic b {
      width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; flex: none;
      background: color-mix(in srgb, var(--blue) 14%, transparent); color: var(--blue);
    }
    .mc__ic u { flex: 1; width: 2px; background: var(--hair); min-height: 10px; }
    .mc__it:last-child .mc__ic u { visibility: hidden; }
    .mc__it--fallback .mc__ic b { background: color-mix(in srgb, var(--amber) 16%, transparent); color: var(--amber); }
    .mc__it--late .mc__ic b { background: color-mix(in srgb, var(--red) 13%, transparent); color: var(--red); }
    .mc__b { min-width: 0; padding: 1px 0 14px; }
    .mc__it:last-child .mc__b { padding-bottom: 0; }
    .mc__t { font-weight: 650; font-size: 14px; line-height: 1.35; }
    .mc__m { font-size: 12.5px; color: var(--ink-2); margin-top: 1px; line-height: 1.4; }
    .mc__act { margin-top: 8px; min-height: 36px; }
  `],
})
export class MissChainComponent {
  private readonly state = inject(AppStateService);

  readonly steps = input.required<MissStep[]>();
  /** Who arrives with time to spare: 'Home' (return) or the gateway city (outbound). */
  readonly arrive = input('Home');
  /** Shown on the late step after the next flight. */
  readonly lateNote = input('lands after your deadline');
  /** A button label on each try ('Use as return'); none when null. */
  readonly actionLabel = input<string | null>(null);
  readonly pick = output<Itinerary>();

  protected readonly rows = computed(() =>
    missRows(this.steps(), { fmt: this.state.timeFormat(), arrive: this.arrive(), lateNote: this.lateNote() }));
}
