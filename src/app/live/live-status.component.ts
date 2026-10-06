import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppStateService } from '../state/app-state.service';
import { PrefsService } from '../state/prefs.service';
import { FlightStatusService } from './flight-status.service';
import { POLL_MS, inStatusWindow, statusLine } from './flight-status';

/**
 * One quiet line of live status under a flight: "Estimated 14:25 (+40) · Gate
 * D32 · Inbound AC811 landed 13:52", then the source and age. Cancelled shows
 * in red with a link to Recover (when `recoverLink` is given). Renders nothing
 * outside the -12h..+36h window, with no result, or when the result is more
 * than 10 minutes old. Polls every 5 minutes while the tab is visible.
 *
 *   <app-live-status flightNumber="AC834" origin="YUL" dateKey="2026-10-06" [depUtc]="ms" />
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
        @if (l.cancelled && recoverLink(); as r) { <a class="ui-link" [routerLink]="r" [queryParams]="recoverParams()">What can I still reach?</a> }
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
  readonly origin = input.required<string>();
  /** Local departure date at the origin. */
  readonly dateKey = input.required<string>();
  readonly depUtc = input.required<number>();
  readonly recoverLink = input<string[] | null>(null);
  readonly recoverParams = input<Record<string, string> | undefined>(undefined);

  private readonly active = computed(() => inStatusWindow(this.depUtc(), this.state.nowMs()));
  private readonly entry = computed(() => this.svc.entry(this.flightNumber(), this.dateKey()));

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
    // Fetch when the flight (or window membership) changes, then every 5 minutes while visible.
    effect(onCleanup => {
      if (!this.active()) return;
      const ident = this.flightNumber();
      const date = this.dateKey();
      const tick = () => {
        if (document.visibilityState === 'visible') void untracked(() => this.svc.refresh(ident, date));
      };
      tick();
      const id = setInterval(tick, POLL_MS);
      document.addEventListener('visibilitychange', tick);
      onCleanup(() => { clearInterval(id); document.removeEventListener('visibilitychange', tick); });
    });
  }
}
