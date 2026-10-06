import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppStateService } from '../state/app-state.service';
import { PrefsService } from '../state/prefs.service';
import { FlightStatusService } from './flight-status.service';
import { VISIBLE_MIN_AGE_MS, WINDOW_AFTER_MS, WINDOW_BEFORE_MS, pollDelay, shouldPoll, statusLine } from './flight-status';

/**
 * One quiet line of live status under a flight: "Estimated 14:25 (+40) · Gate
 * D32 · Inbound AC811 landed 13:52", then the source and age. Cancelled shows
 * in red with a link to where to go next (when `recoverLink` is given).
 * Renders nothing outside the window (-12h .. +`leadMs` of departure, 36h by
 * default), with no result, or when the result is more than 10 minutes old.
 * Polls every 30 minutes until 6h before departure and every 5 minutes after,
 * while the tab is visible; stops once the flight left over 30 minutes ago or
 * arrived. The server only sees the flight number, origin and departure minute.
 *
 *   <app-live-status flightNumber="AC834" origin="YUL" [depUtc]="ms" />
 */
@Component({
  selector: 'app-live-status',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (line(); as l) {
      <p class="ls" [class.ls--bad]="l.cancelled" data-live-status>
        <b class="tn">{{ l.text }}</b>
        @if (l.cancelled && recoverLink(); as r) { <a class="ui-link" [routerLink]="r" [queryParams]="recoverParams()">{{ recoverLabel() }}</a> }
        <small>{{ l.source }}</small>
      </p>
    } @else if (unavailable()) {
      <p class="ls ls--quiet" data-live-status-unavailable>Live status unavailable</p>
    }
  `,
  styles: [`
    :host { display: block; }
    .ls { margin: 8px 0 0; font-size: 13.5px; color: var(--ink-2); display: flex; flex-wrap: wrap; gap: 2px 10px; align-items: baseline; }
    .ls b { color: var(--ink); font-weight: 650; }
    .ls small { flex-basis: 100%; font-size: 12px; color: var(--ink-3); }
    .ls--bad b { color: var(--red-ink); }
    .ls--quiet { font-size: 12px; color: var(--ink-3); }
  `],
})
export class LiveStatusComponent {
  private readonly svc = inject(FlightStatusService);
  private readonly state = inject(AppStateService);
  private readonly prefs = inject(PrefsService);

  readonly flightNumber = input.required<string>();
  /** Departure airport (IATA). */
  readonly origin = input.required<string>();
  /** Scheduled departure, epoch ms. */
  readonly depUtc = input.required<number>();
  /** How far before departure to start asking, in ms (the flight page uses 6h). */
  readonly leadMs = input<number>(WINDOW_AFTER_MS);
  readonly recoverLink = input<string | string[] | null>(null);
  readonly recoverParams = input<Record<string, string> | undefined>(undefined);
  readonly recoverLabel = input('What can I still reach?');

  private readonly active = computed(() => {
    if (!/^AC\d{1,4}$/.test(this.flightNumber())) return false; // the endpoint serves Air Canada only
    const d = this.depUtc() - this.state.nowMs();
    return d >= -WINDOW_BEFORE_MS && d <= Math.min(this.leadMs(), WINDOW_AFTER_MS);
  });
  private readonly entry = computed(() => this.svc.entry(this.flightNumber(), this.origin(), this.depUtc()));

  protected readonly line = computed(() => {
    const d = this.active() ? this.svc.fresh(this.entry(), this.state.nowMs()) : null;
    return d ? statusLine(d, this.origin(), this.state.nowMs(), this.prefs.timeFormat()) : null;
  });
  /** Only when a result was shown before and the latest refresh failed. */
  protected readonly unavailable = computed(() => {
    const e = this.entry();
    return this.active() && !!e?.data && e.failed;
  });

  constructor() {
    // Ask when the flight (or window membership) changes, then on a timer while visible.
    effect(onCleanup => {
      if (!this.active()) return;
      const ident = this.flightNumber();
      const origin = this.origin();
      const dep = this.depUtc();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const visible = () => document.visibilityState === 'visible';
      const go = (minAge: number) => {
        if (!visible()) return;
        const data = untracked(() => this.svc.entry(ident, origin, dep)?.data ?? null);
        if (shouldPoll(data, this.state.nowMs())) void untracked(() => this.svc.refresh(ident, origin, dep, minAge));
      };
      const loop = () => {
        go(0);
        timer = setTimeout(loop, pollDelay(dep, this.state.nowMs()));
      };
      loop();
      const onVis = () => go(VISIBLE_MIN_AGE_MS);
      document.addEventListener('visibilitychange', onVis);
      onCleanup(() => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); });
    });
  }
}
