import { ChangeDetectionStrategy, Component, booleanAttribute, computed, effect, inject, input, untracked } from '@angular/core';
import { AppStateService } from '../state/app-state.service';
import { airportTz } from '../utils/airports';
import { todayKey } from '../utils/time';
import { MAX_EVENTS, TICKETMASTER_URL, eventLine, weekBuckets, weekLabel, type EventItem } from './events';
import { EventsService } from './events.service';

let nextId = 0;

/**
 * "What's on" for a destination and a date range, as the one or two Monday to Sunday weeks the
 * range overlaps (the server accepts those, and the CDN shares them between people). It asks when
 * it is created or its inputs change, so callers that must not fetch in bulk create it only on
 * demand. By default it renders nothing without events (unavailable is not an error); `verbose`
 * (set where the person asked) shows "Looking…" and "No events listed".
 */
@Component({
  selector: 'app-events-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (events().length) {
      <section class="ev" data-events [attr.aria-labelledby]="hid">
        <p class="ev__t" [id]="hid"><b>What's on</b> · {{ label() }}</p>
        <ul class="ev__l">
          @for (e of events(); track e.url) {
            <li><a [href]="e.url" target="_blank" rel="noopener" class="ev__a">{{ line(e) }}<span class="ui-visually-hidden"> (opens in a new tab)</span></a></li>
          }
        </ul>
        <p class="ev__c ui-sub">Events from <a [href]="tm" target="_blank" rel="noopener">Ticketmaster<span class="ui-visually-hidden"> (opens in a new tab)</span></a>. Prices and availability are on their site.</p>
      </section>
    } @else if (verbose() && state() === 'loading') {
      <p class="ev__n ui-sub" role="status" data-events-status>Looking…</p>
    } @else if (verbose() && state() === 'empty') {
      <p class="ev__n ui-sub" role="status" data-events-status>No events listed</p>
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
    .ev__n { margin: 8px 0 0; font-size: 13px; }
  `],
})
export class EventsCardComponent {
  private readonly svc = inject(EventsService);
  private readonly appState = inject(AppStateService);

  readonly code = input.required<string>();
  /** First and last day (date keys). */
  readonly from = input.required<string>();
  readonly to = input.required<string>();
  readonly verbose = input(false, { transform: booleanAttribute });

  protected readonly hid = `ev-h-${nextId++}`;
  protected readonly tm = TICKETMASTER_URL;

  private readonly buckets = computed(() => weekBuckets(this.from(), this.to(), todayKey(airportTz(this.code()), this.appState.nowMs())));
  protected readonly label = computed(() => weekLabel(this.buckets()));
  private readonly results = computed(() => this.buckets().map(w => this.svc.result(this.code(), w)));
  protected readonly events = computed<EventItem[]>(() =>
    this.results().flatMap(r => r?.events ?? []).sort((a, b) => (a.date + (a.time ?? '99')).localeCompare(b.date + (b.time ?? '99'))).slice(0, MAX_EVENTS));
  protected readonly state = computed<'loading' | 'empty'>(() => (this.results().some(r => r === undefined) ? 'loading' : 'empty'));

  constructor() {
    effect(() => {
      const ws = this.buckets();
      const code = this.code();
      untracked(() => { for (const w of ws) void this.svc.load(code, w); });
    });
  }

  protected line(e: EventItem): string {
    return eventLine(e, this.appState.timeFormat());
  }
}
