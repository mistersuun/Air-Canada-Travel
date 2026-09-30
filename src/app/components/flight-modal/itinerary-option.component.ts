import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { findAlternatives, NO_OPTS, type ConnectOptions, type Itinerary } from '../../utils/connections';
import { aircraftName } from '../../utils/aircraft';
import { buildIcs, downloadIcs, icsFilename } from '../../utils/ics';
import { formatClock, formatDayOffset, formatDuration } from '../../utils/time';
import { IconComponent } from '../shared/icons.component';
import { PlaneIconComponent } from '../shared/plane-icon.component';
import { ItineraryTimelineComponent } from './itinerary-timeline.component';
import { domId, itinKey, prettyFlight, shortDay, stopsLabel } from './modal-model';

interface AltRow {
  label: string;
  key: string;
  dep: string;
  arr: string;
  dayOff: string;
  via: string;
  flights: string;
  estimated: boolean;
}

/**
 * One schedule option. Collapsed, it reads like a boarding-pass row
 * (ref 27254834): departure time and code, a route line with the connection
 * hub, arrival time with "+1", then flight/aircraft chips. Expanded, it shows
 * the full timeline, calendar export, and "If you miss this" schedule options
 * (later same route, other hubs the same day, first option next day).
 */
@Component({
  selector: 'app-itinerary-option',
  standalone: true,
  imports: [IconComponent, PlaneIconComponent, ItineraryTimelineComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let it = itinerary();
    <button type="button" class="sum" [attr.aria-expanded]="expanded()" [attr.aria-controls]="panelId()"
            [attr.aria-label]="ariaLabel()" (click)="toggle.emit()">
      <span class="end">
        <span class="ui-time">{{ dep() }}</span>
        <span class="code">{{ it.origin }}</span>
      </span>
      <span class="mid">
        <span class="ui-route-line" [class.ui-route-line--estimated]="it.legs[0].estimated"
              [style.--plane-x]="it.hubs.length ? '82%' : '58%'">
          <span class="ui-route-line__bar"></span>
          @if (it.hubs.length) { <span class="ui-route-line__hub" style="--hub-x: 46%">{{ it.hubs[0] }}</span> }
          <app-plane-icon class="ui-route-line__plane" [size]="13" />
        </span>
        <span class="dur">{{ duration() }}</span>
      </span>
      <span class="end end--r">
        <span class="ui-time">{{ arr() }}@if (dayOff()) {<sup class="ui-dayoff">{{ dayOff() }}</sup>}</span>
        <span class="code">{{ it.dest }}</span>
      </span>
      <span class="meta">
        @for (l of it.legs; track $index) {
          @if (l.estimated) {
            <span class="ui-chip ui-chip--warn" title="Domestic leg not from published schedules: verify in the Air Canada app">Estimated leg</span>
          } @else {
            <span class="ui-chip-mono">{{ pretty(l.flightNumber) }}</span>
          }
        }
        @if (aircraft(); as a) { <span class="ui-chip-mono" [title]="a.title">{{ a.codes }}</span> }
        @if (it.hubs.length) {
          <span class="ui-chip ui-chip--connect">{{ layover() }} in {{ it.hubs[0] }}</span>
        }
        @if (badge()) { <span class="ui-chip ui-chip--ok">{{ badge() }}</span> }
        <app-icon class="chev" name="chevron-down" [size]="18" />
      </span>
    </button>

    @if (expanded()) {
      <div class="detail" [id]="panelId()">
        <app-itinerary-timeline [itinerary]="it" [timeFormat]="timeFormat()" [minConnect]="minConnect()" />
        <div class="actions">
          <button type="button" class="ui-btn" (click)="exportIcs(false)">
            <app-icon name="calendar" [size]="16" /> Add to calendar
          </button>
          @if (pair()) {
            <button type="button" class="ui-btn" (click)="exportIcs(true)">
              <app-icon name="download" [size]="16" /> Round trip .ics
            </button>
          }
        </div>
        @if (alternatives(); as alts) {
          <section class="alts" [attr.aria-labelledby]="panelId() + '-alts'">
            <h4 class="ui-label" [id]="panelId() + '-alts'">If you miss this · schedule options</h4>
            @for (a of alts; track a.key) {
              <div class="alt">
                <span class="alt__label">{{ a.label }}</span>
                <span class="alt__times">{{ a.dep }} → {{ a.arr }}@if (a.dayOff) {<sup class="ui-dayoff">{{ a.dayOff }}</sup>}</span>
                <span class="alt__via">{{ a.via }}@if (a.estimated) { · est.}</span>
                <span class="alt__flights">{{ a.flights }}</span>
              </div>
            } @empty {
              <p class="alts__none">No later options today or tomorrow in the published schedules.</p>
            }
            <p class="alts__note">Schedules only, not seat availability.</p>
          </section>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); overflow: hidden; }
    :host(.is-selected) { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); }
    .sum {
      all: unset; box-sizing: border-box; width: 100%; cursor: pointer;
      display: grid; grid-template-columns: auto 1fr auto; align-items: start; gap: 6px 12px;
      padding: 12px 14px; transition: background var(--dur-fast) var(--ease-out);
    }
    .sum:hover { background: color-mix(in srgb, var(--surface-2) 60%, transparent); }
    .sum:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 14px; }
    .end { display: grid; gap: 2px; min-width: 56px; }
    .end--r { text-align: right; justify-items: end; }
    .code { font-family: var(--font-code); font-size: 12px; font-weight: 600; color: var(--ink-3); letter-spacing: .04em; }
    .mid { display: grid; gap: 3px; padding-top: 3px; min-width: 0; }
    .mid .ui-route-line { min-width: 0; }
    .dur { text-align: center; font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
    .meta { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .chev { margin-left: auto; color: var(--ink-3); transition: transform var(--dur) var(--ease-out); }
    .sum[aria-expanded='true'] .chev { transform: rotate(180deg); }
    .detail { padding: 4px 14px 14px; border-top: 1px dashed var(--line-strong); animation: enter-up var(--dur) var(--ease-out); }
    .detail app-itinerary-timeline { margin-top: 14px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .actions .ui-btn { height: 36px; font-size: 13px; }
    .alts { margin-top: 14px; padding: 12px; border-radius: var(--radius-inner); background: var(--surface-2); }
    .alts h4 { margin: 0 0 8px; }
    .alt {
      display: grid; grid-template-columns: 1fr auto; gap: 0 10px; padding: 7px 0;
      border-top: 1px solid var(--line); font-size: 13px;
    }
    .alt:first-of-type { border-top: 0; }
    .alt__label { color: var(--ink-2); font-weight: 600; }
    .alt__times { font-family: var(--font-code); font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
    .alt__via, .alt__flights { color: var(--ink-3); font-size: 12px; }
    .alt__flights { text-align: right; font-family: var(--font-code); }
    .alts__none, .alts__note { margin: 4px 0 0; font-size: 12px; color: var(--ink-3); }
  `],
  host: { '[class.is-selected]': 'expanded()' },
})
export class ItineraryOptionComponent {
  readonly itinerary = input.required<Itinerary>();
  readonly expanded = input(false);
  readonly timeFormat = input<'12h' | '24h'>('24h');
  readonly connect = input<ConnectOptions>(NO_OPTS);
  readonly destName = input('');
  /** Show the "If you miss this" panel when expanded. */
  readonly showAlternatives = input(true);
  /** The other direction of a round trip, for a two-way .ics. */
  readonly pair = input<Itinerary | null>(null);
  /** Optional small green badge ('Earliest arrival'). */
  readonly badge = input('');

  readonly toggle = output<void>();

  protected readonly pretty = prettyFlight;
  protected readonly minConnect = computed(() => this.connect().minConnect ?? 60);
  protected readonly panelId = computed(() => domId('opt', itinKey(this.itinerary())));
  protected readonly dep = computed(() => formatClock(this.itinerary().legs[0].depLocal, this.timeFormat()));
  protected readonly arr = computed(() => {
    const legs = this.itinerary().legs;
    return formatClock(legs[legs.length - 1].arrLocal, this.timeFormat());
  });
  protected readonly dayOff = computed(() => formatDayOffset(this.itinerary().arrDayOffset));
  protected readonly duration = computed(() => `${formatDuration(this.itinerary().totalMin)} · ${stopsLabel(this.itinerary())}`);
  protected readonly layover = computed(() => formatDuration(this.itinerary().layovers[0] ?? 0));

  protected readonly aircraft = computed(() => {
    const codes = [...new Set(this.itinerary().legs.map(l => l.aircraft).filter((a): a is string => !!a))];
    return codes.length ? { codes: codes.join(' · '), title: codes.map(aircraftName).join(', ') } : null;
  });

  protected readonly ariaLabel = computed(() => {
    const it = this.itinerary();
    const flights = it.legs.map(l => (l.estimated ? 'estimated leg' : prettyFlight(l.flightNumber))).join(', ');
    const off = it.arrDayOffset > 0 ? ` plus ${it.arrDayOffset} day` : it.arrDayOffset < 0 ? ` minus ${-it.arrDayOffset} day` : '';
    return `${it.origin} ${this.dep()} to ${it.dest} ${this.arr()}${off}, ${this.duration()}, ${flights}`;
  });

  protected readonly alternatives = computed<AltRow[] | null>(() => {
    if (!this.expanded() || !this.showAlternatives()) return null;
    const it = this.itinerary();
    const alts = findAlternatives(it.origin, it.dest, it, this.connect());
    const rows: [string, Itinerary][] = [
      ...alts.laterSameRoute.slice(0, 2).map(a => ['Later, same route', a] as [string, Itinerary]),
      ...alts.otherHubsSameDay.slice(0, 2).map(a => [a.hubs.length ? `Via ${a.hubs[0]}` : 'Direct', a] as [string, Itinerary]),
      ...(alts.nextDayFirst ? [[`Next day · ${shortDay(alts.nextDayFirst.dateKey)}`, alts.nextDayFirst] as [string, Itinerary]] : []),
    ];
    const fmt = this.timeFormat();
    return rows.map(([label, a]) => ({
      label,
      key: label + itinKey(a),
      dep: formatClock(a.legs[0].depLocal, fmt),
      arr: formatClock(a.legs[a.legs.length - 1].arrLocal, fmt),
      dayOff: formatDayOffset(a.arrDayOffset),
      via: stopsLabel(a),
      flights: a.legs.map(l => (l.estimated ? 'est.' : prettyFlight(l.flightNumber))).join(' + '),
      estimated: a.estimated,
    }));
  });

  exportIcs(roundTrip: boolean): void {
    const it = this.itinerary();
    const pair = this.pair();
    const list = roundTrip && pair ? (pair.departUtc < it.departUtc ? [pair, it] : [it, pair]) : [it];
    downloadIcs(buildIcs(list, this.destName()), icsFilename(list));
  }
}
