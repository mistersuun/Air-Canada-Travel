import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Itinerary } from '../../utils/connections';
import { isLayoverAlert, LONG_LAYOVER } from '../../utils/connections';
import { aircraftName } from '../../utils/aircraft';
import { airportName } from '../../utils/airports';
import { diffDays, formatClock, formatDayOffset, formatDuration } from '../../utils/time';
import { IconComponent } from '../shared/icons.component';
import { prettyFlight, shortDay } from './modal-model';

interface Stop {
  kind: 'dep' | 'arr';
  code: string;
  city: string;
  time: string;
  dayOff: string;
  date: string;
  flight: string;
  aircraft: string | null;
  aircraftTitle: string;
  duration: string;
  /** The rail below this stop belongs to an estimated leg. */
  estimated: boolean;
}

interface Row {
  stop: Stop;
  /** Caption under an estimated leg's departure. */
  caption: boolean;
  /** Layover after this (arrival) stop. */
  layover: { text: string; alert: boolean; reason: string } | null;
}

/**
 * One itinerary as a vertical timeline (refs 24671318, 27254834): a ring dot
 * per departure and arrival, local times with a "+1" relative to the first
 * departure date, flight and aircraft chips, a layover pill between legs
 * (alert colours when tight or long), and the total elapsed time.
 * Estimated legs get a dashed rail and a "verify" caption.
 */
@Component({
  selector: 'app-itinerary-timeline',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="ui-timeline">
      @for (r of rows(); track $index) {
        <li class="ui-timeline__stop" [class.ui-timeline__seg--estimated]="r.stop.estimated">
          <span class="ui-timeline__code">{{ r.stop.code }}</span>
          <span class="ui-timeline__city">{{ r.stop.city }}</span>
          <span class="ui-timeline__time">
            <span class="ui-visually-hidden">{{ r.stop.kind === 'dep' ? 'Departs' : 'Arrives' }}</span>
            {{ r.stop.time }}@if (r.stop.dayOff) {<sup class="ui-dayoff" [attr.aria-label]="r.stop.dayOff + ' day'">{{ r.stop.dayOff }}</sup>}
          </span>
          <span class="ui-timeline__meta">
            <span>{{ r.stop.date }}</span>
            @if (r.stop.kind === 'dep') {
              @if (r.stop.flight) { <span class="ui-chip-mono">{{ r.stop.flight }}</span> }
              @if (r.stop.aircraft) { <span class="ui-chip-mono" [title]="r.stop.aircraftTitle">{{ r.stop.aircraft }}</span> }
              <span>{{ r.stop.duration }} flight</span>
            }
          </span>
        </li>
        @if (r.caption) {
          <li class="ui-timeline__caption ui-timeline__seg--estimated">
            Estimated leg, not from published schedules · verify in the AC app
          </li>
        }
        @if (r.layover; as l) {
          <li class="ui-timeline__layover" [class.ui-timeline__layover--alert]="l.alert">
            @if (l.alert) { <app-icon name="warning" [size]="14" /> }
            {{ l.text }}@if (l.reason) {<span class="tl-reason">&nbsp;· {{ l.reason }}</span>}
          </li>
        }
      }
    </ol>
    <div class="ui-timeline__footer">
      <span>Total {{ total() }}</span>
      <span>{{ summary() }}</span>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .ui-timeline__meta .ui-chip-mono { height: 20px; }
    .tl-reason { font-weight: 500; }
  `],
})
export class ItineraryTimelineComponent {
  readonly itinerary = input.required<Itinerary>();
  readonly timeFormat = input<'12h' | '24h'>('24h');
  readonly minConnect = input<number>(60);

  protected readonly rows = computed<Row[]>(() => {
    const it = this.itinerary();
    const fmt = this.timeFormat();
    const rows: Row[] = [];
    it.legs.forEach((leg, i) => {
      rows.push({
        stop: {
          kind: 'dep',
          code: leg.origin,
          city: airportName(leg.origin),
          time: formatClock(leg.depLocal, fmt),
          dayOff: formatDayOffset(diffDays(it.dateKey, leg.dateKey)),
          date: shortDay(leg.dateKey),
          flight: leg.estimated ? 'Estimated' : prettyFlight(leg.flightNumber),
          aircraft: leg.aircraft,
          aircraftTitle: aircraftName(leg.aircraft),
          duration: formatDuration(leg.durationMin),
          estimated: leg.estimated,
        },
        caption: leg.estimated,
        layover: null,
      });
      const lay = i < it.layovers.length ? it.layovers[i] : null;
      rows.push({
        stop: {
          kind: 'arr',
          code: leg.dest,
          city: airportName(leg.dest),
          time: formatClock(leg.arrLocal, fmt),
          dayOff: formatDayOffset(diffDays(it.dateKey, leg.arrDateKey)),
          date: shortDay(leg.arrDateKey),
          flight: '',
          aircraft: null,
          aircraftTitle: '',
          duration: '',
          estimated: false,
        },
        caption: false,
        layover: lay === null ? null : {
          text: `${formatDuration(lay)} layover · ${airportName(leg.dest)}`,
          alert: isLayoverAlert(lay, this.minConnect()),
          reason: lay < this.minConnect() ? 'tight connection' : lay > LONG_LAYOVER ? 'long wait' : '',
        },
      });
    });
    return rows;
  });

  protected readonly total = computed(() => formatDuration(this.itinerary().totalMin));

  protected readonly summary = computed(() => {
    const it = this.itinerary();
    const stops = it.hubs.length ? `${it.hubs.length} stop via ${it.hubs.map(airportName).join(', ')}` : 'Nonstop';
    return it.estimated ? `${stops} · includes an estimated leg` : stops;
  });
}
