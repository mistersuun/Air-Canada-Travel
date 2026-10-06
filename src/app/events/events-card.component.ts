import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { AppStateService } from '../state/app-state.service';
import { airportTz } from '../utils/airports';
import { todayKey } from '../utils/time';
import { TICKETMASTER_URL, clampWindow, eventLine, rangeLabel, type EventItem } from './events';
import { EventsService } from './events.service';

/**
 * "What's on" for a destination and a date range (clamped to what the server accepts: 7 days, the
 * next 120). It asks when it is created or its inputs change, so callers that must not fetch in
 * bulk create it only on demand. Renders nothing without events (unavailable is not an error).
 */
@Component({
  selector: 'app-events-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (events().length) {
      <section class="ev" data-events>
        <p class="ev__t"><b>What's on</b> · {{ range() }}</p>
        <ul class="ev__l">
          @for (e of events(); track e.url) {
            <li><a [href]="e.url" target="_blank" rel="noopener" class="ev__a">{{ line(e) }}</a></li>
          }
        </ul>
        <p class="ev__c ui-sub">Events from <a [href]="tm" target="_blank" rel="noopener">Ticketmaster</a>. Prices and availability are on their site.</p>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    :host:empty { display: none; }
    .ev { display: grid; gap: 8px; margin-top: 12px; }
    .ev__t { margin: 0; font-size: 13.5px; color: var(--ink-2); }
    .ev__t b { color: var(--ink); font-weight: 650; }
    .ev__l { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .ev__a { font-size: 14px; color: var(--blue); overflow-wrap: anywhere; }
    .ev__c { margin: 0; font-size: 11.5px; }
    .ev__c a { color: var(--blue); }
  `],
})
export class EventsCardComponent {
  private readonly svc = inject(EventsService);
  private readonly state = inject(AppStateService);

  readonly code = input.required<string>();
  /** First and last day (date keys). */
  readonly from = input.required<string>();
  readonly to = input.required<string>();

  protected readonly tm = TICKETMASTER_URL;

  private readonly window = computed(() => {
    const today = todayKey(airportTz(this.code()), this.state.nowMs());
    return clampWindow(this.from(), this.to(), today);
  });
  protected readonly events = computed(() => {
    const w = this.window();
    return w ? (this.svc.result(this.code(), w)?.events ?? []) : [];
  });
  protected readonly range = computed(() => {
    const w = this.window();
    return w ? rangeLabel(w) : '';
  });

  constructor() {
    effect(() => {
      const w = this.window();
      const code = this.code();
      if (w) untracked(() => void this.svc.load(code, w));
    });
  }

  protected line(e: EventItem): string {
    return eventLine(e, this.state.timeFormat());
  }
}
