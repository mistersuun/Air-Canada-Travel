import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { RouteEntry } from '../../utils/routes';
import type { FlightInstance } from '../../utils/week';
import type { Itinerary } from '../../utils/connections';
import type { TimeFormat } from '../../state/prefs.service';
import { getFlag } from '../../utils/flags';
import { regionVar } from '../../utils/region-color';
import { aircraftName } from '../../utils/aircraft';
import { airportName } from '../../utils/airports';
import {
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  formatClock,
  formatDayOffset,
  formatDuration,
  formatKey,
} from '../../utils/time';
import { PlaneIconComponent } from '../shared/plane-icon.component';
import { IconComponent } from '../shared/icons.component';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
const YEAR_ROUND = new Set(['Year-round', 'Jan – Dec', '']);

export type SegKind = 'direct' | 'connect' | 'outside' | 'none';

export interface WeekSeg {
  dateKey: string;
  letter: string;
  kind: SegKind;
  /** Direct departures that day. */
  count: number;
  label: string;
}

/** What the big route row shows: one flight or one itinerary, reduced to display fields. */
interface Trip {
  origin: string;
  dest: string;
  dep: string;
  arr: string;
  arrOffset: number;
  totalMin: number;
  depUtc: number;
  hubs: string[];
  /** Hub position along the line, 0–100 (by elapsed time of leg 1). */
  hubX: number;
  /** 1-based index of the first estimated leg, 0 when none. */
  estimatedLeg: number;
  legs: FlightInstance[];
}

/** 'AC864' → 'AC 864'. */
export function spaceFlightNumber(fn: string | null | undefined): string {
  if (!fn) return '';
  const m = /^([A-Z0-9]{2})(\d+)$/.exec(fn);
  return m ? `${m[1]} ${m[2]}` : fn;
}

function fromItinerary(it: Itinerary): Trip {
  const first = it.legs[0];
  const last = it.legs[it.legs.length - 1];
  const leg1 = first.arrUtc - first.depUtc;
  const span = Math.max(1, it.arriveUtc - it.departUtc);
  const est = it.legs.findIndex(l => l.estimated);
  return {
    origin: it.origin,
    dest: it.dest,
    dep: first.depLocal,
    arr: last.arrLocal,
    arrOffset: it.arrDayOffset,
    totalMin: it.totalMin,
    depUtc: it.departUtc,
    hubs: it.hubs,
    hubX: Math.round(Math.min(72, Math.max(28, (leg1 / span) * 100))),
    estimatedLeg: est + 1,
    legs: it.legs,
  };
}

function fromFlight(f: FlightInstance): Trip {
  return {
    origin: f.origin,
    dest: f.dest,
    dep: f.depLocal,
    arr: f.arrLocal,
    arrOffset: f.arrDayOffset,
    totalMin: f.durationMin,
    depUtc: f.depUtc,
    hubs: [],
    hubX: 50,
    estimatedLeg: f.estimated ? 1 : 0,
    legs: [f],
  };
}

/** Most common timetable (dep/arr/offset) among a week's flights; ties go to the earliest. */
function typicalFlight(flights: readonly FlightInstance[]): FlightInstance | null {
  if (!flights.length) return null;
  const tally = new Map<string, { n: number; f: FlightInstance }>();
  for (const f of flights) {
    const k = `${f.depLocal}|${f.arrLocal}|${f.arrDayOffset}`;
    const t = tally.get(k);
    if (t) t.n++;
    else tally.set(k, { n: 1, f });
  }
  let best: { n: number; f: FlightInstance } | null = null;
  for (const t of tally.values()) if (!best || t.n > best.n) best = t;
  return best!.f;
}

function distinct<T>(xs: readonly (T | null | undefined)[]): T[] {
  return [...new Set(xs.filter((x): x is T => x != null && x !== ''))];
}

/**
 * One destination in the list. Everything arrives precomputed in `entry`
 * (RouteEntry from utils/routes); the card calls no schedule functions.
 *
 * The whole card opens the flight modal through a stretched <button>
 * (aria-haspopup="dialog"); the star and "+N more" buttons sit above it.
 */
@Component({
  selector: 'app-route-card',
  standalone: true,
  imports: [PlaneIconComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'rc-host' },
  template: `
    @let d = entry().destination;
    @let t = trip();
    <article class="card ui-card ui-glide" [class.card--connect]="!entry().isDirect" [style.--region]="region()">
      <button type="button" class="card__hit" aria-haspopup="dialog" [attr.aria-label]="ariaLabel()" (click)="open.emit()"></button>

      @if (countdown(); as c) {
        <div class="card__countdown ui-num" role="status">
          <app-icon name="clock" [size]="14" />
          <span>Departs in <strong>{{ c }}</strong></span>
        </div>
      }

      <header class="card__head">
        <span class="card__flag" aria-hidden="true">{{ flag() }}</span>
        <div class="card__place">
          <div class="ui-city card__city">{{ d.city }}</div>
          <div class="card__country"><span class="card__dot"></span>{{ d.country }}</div>
        </div>
        <button
          type="button"
          class="card__fav ui-icon-btn"
          [class.is-on]="isFavourite()"
          [attr.aria-pressed]="isFavourite()"
          [attr.aria-label]="(isFavourite() ? 'Unstar ' : 'Star ') + d.city"
          (click)="toggleFavourite.emit()"
        >
          <app-icon name="star" [size]="18" [filled]="isFavourite()" />
        </button>
      </header>

      <div class="card__chips">
        @if (entry().isDirect) {
          <span class="ui-chip ui-chip--ok">Direct</span>
        } @else {
          <span class="ui-chip ui-chip--connect">Connecting</span>
        }
        @if (d.isNew) { <span class="ui-chip ui-chip--new">New</span> }
        @if (season(); as s) { <span class="ui-chip ui-chip--seasonal ui-chip--nodot" [attr.title]="'Seasonal: ' + s">{{ s }}</span> }
        @if (estimatedText(); as e) {
          <span class="ui-chip ui-chip--warn ui-chip--nodot card__est" [attr.title]="estimatedTitle">
            <app-icon name="warning" [size]="12" />{{ e }}
          </span>
        }
        <span class="card__mono">
          @for (c of monoChips(); track $index) { <span class="ui-chip-mono" [attr.title]="c.title">{{ c.text }}</span> }
        </span>
      </div>

      @if (t) {
        <div class="card__route">
          <div class="card__end">
            <span class="ui-label card__lbl">{{ originCity() }}</span>
            <span class="ui-code">{{ t.origin }}</span>
          </div>
          <div class="ui-route-line card__line" [style.--plane-x.%]="planeX()" [style.--hub-x.%]="t.hubX">
            <span class="ui-route-line__bar"></span>
            @if (t.estimatedLeg) {
              <span class="card__dash" [class.card__dash--second]="t.estimatedLeg > 1 && t.hubs.length"
                    [class.card__dash--all]="!t.hubs.length"></span>
            }
            @for (h of t.hubs; track h) { <span class="ui-route-line__hub" [style.--hub-x.%]="t.hubX">{{ h }}</span> }
            <app-plane-icon class="ui-route-line__plane" />
          </div>
          <div class="card__end card__end--r">
            <span class="ui-label card__lbl">{{ d.city }}</span>
            <span class="ui-code">{{ t.dest }}</span>
          </div>
        </div>

        <div class="card__times">
          <span class="ui-time">{{ clock(t.dep) }}</span>
          <span class="card__dur ui-muted">{{ durationText() }}</span>
          <span class="ui-time card__arr">{{ clock(t.arr) }}@if (t.arrOffset) {<sup class="ui-dayoff" [attr.aria-label]="dayOffsetLabel(t.arrOffset)">{{ offset(t.arrOffset) }}</sup>}</span>
        </div>
      } @else {
        <p class="card__none ui-muted">{{ noTripText() }}</p>
      }

      @if (stub(); as s) {
        <div class="ui-stub card__stub">
          <div class="ui-stub__grid">
            <div><div class="ui-label">Departs</div><div class="ui-stub__value">{{ s.departs }}</div></div>
            <div><div class="ui-label">Arrives</div><div class="ui-stub__value">{{ s.arrives }}</div></div>
            <div><div class="ui-label">Flight</div><div class="ui-stub__value">{{ s.flight }}</div></div>
            <div><div class="ui-label">Aircraft</div><div class="ui-stub__value" [attr.title]="s.aircraftName">{{ s.aircraft }}</div></div>
            <div><div class="ui-label">Duration</div><div class="ui-stub__value">{{ s.duration }}</div></div>
            <div><div class="ui-label">Operates</div><div class="ui-stub__value">{{ s.operates }}</div></div>
          </div>
          @if (s.more) {
            <button type="button" class="card__more" aria-haspopup="dialog" (click)="open.emit()">
              +{{ s.more }} more {{ s.more === 1 ? 'flight' : 'flights' }} this day
              <app-icon name="chevron-right" [size]="14" />
            </button>
          }
        </div>
      }

      @if (!selectedDateKey()) {
        <div class="card__week">
          <div class="card__weekhead">
            <span class="ui-label">This week</span>
            <span class="card__weeksum ui-muted">{{ weekText() }}</span>
          </div>
          <div class="ui-segs card__segs">
            @for (s of segs(); track s.dateKey) {
              <span class="card__seg">
                <span [class]="'ui-seg ui-seg--' + s.kind" role="img" [attr.aria-label]="s.label"></span>
                <span class="card__day" aria-hidden="true">{{ s.letter }}@if (s.count > 1) {<b>×{{ s.count }}</b>}</span>
              </span>
            }
          </div>
        </div>
      }
    </article>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .card {
      position: relative; height: 100%; display: flex; flex-direction: column; gap: var(--space-3);
      transition: transform var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
    }
    .card:hover { border-color: var(--line-strong); }
    .card:has(.card__hit:active) { transform: scale(.985); }
    .card:has(.card__hit:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
    .card__hit {
      position: absolute; inset: 0; z-index: 0; width: 100%; border: 0; padding: 0; margin: 0;
      background: transparent; border-radius: inherit; cursor: pointer; outline: none;
    }
    .card__fav, .card__more { position: relative; z-index: 1; }
    .card > *:not(.card__hit) { pointer-events: none; }
    .card__fav, .card__more { pointer-events: auto; }

    .card__countdown {
      display: flex; align-items: center; gap: 6px; margin: calc(-1 * var(--space-4)) calc(-1 * var(--space-4)) 0;
      padding: 8px var(--space-4); border-radius: var(--radius-card) var(--radius-card) 0 0;
      background: var(--accent-soft); color: var(--accent-strong); font-size: 12.5px; font-weight: 500;
    }
    .card__countdown strong { font-family: var(--font-code); font-weight: 600; }

    .card__head { display: flex; align-items: center; gap: var(--space-3); }
    .card__flag { font-size: 24px; line-height: 1; }
    .card__place { flex: 1; min-width: 0; }
    .card__city, .card__country { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card__country { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-2); margin-top: 1px; }
    .card__dot { width: 6px; height: 6px; border-radius: 2px; background: var(--region); flex-shrink: 0; }
    .card__fav { width: 36px; height: 36px; margin: -6px -8px -6px 0; color: var(--ink-3); }
    .card__fav.is-on { color: var(--accent); }

    .card__chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .card__est { gap: 4px; }
    .card__mono { display: inline-flex; gap: 4px; margin-left: auto; }

    .card__route { display: flex; align-items: flex-end; gap: var(--space-3); margin-top: var(--space-1); }
    .card__end { display: flex; flex-direction: column; gap: 4px; min-width: 0; max-width: 32%; }
    .card__end--r { align-items: flex-end; text-align: right; }
    .card__lbl { letter-spacing: .04em; text-transform: none; font-size: 11.5px; font-weight: 500;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
    .card__line { align-self: flex-end; margin-bottom: 6px; }
    .card--connect .card__line .ui-route-line__bar {
      background: linear-gradient(90deg, var(--accent), var(--connect-fill)) left / var(--plane-x) 100% no-repeat, var(--line);
    }
    .card__dash {
      position: absolute; top: 7px; left: 0; width: var(--hub-x); height: 2px;
      background: repeating-linear-gradient(90deg, var(--warn-fill) 0 6px, var(--surface) 6px 10px);
    }
    .card__dash--second { left: var(--hub-x); width: auto; right: 0; }
    .card__dash--all { width: 100%; }

    .card__times { display: grid; grid-template-columns: auto 1fr auto; align-items: baseline; gap: var(--space-2); margin-top: -4px; }
    .card__dur { text-align: center; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .card__arr { text-align: right; }
    .card__none { margin: 0; font-size: 13px; }

    .card__stub { margin-top: var(--space-1); }
    /* Centre the notches on the card's outer edge so they bite in; the card clips the outer half. */
    .card { overflow: hidden; }
    .ui-stub__value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card__more {
      display: inline-flex; align-items: center; gap: 2px; margin-top: var(--space-3); padding: 4px 0;
      border: 0; background: none; color: var(--accent-strong); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
    }
    .card__more:hover { text-decoration: underline; }

    .card__week { margin-top: auto; padding-top: var(--space-1); }
    .card__weekhead { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2); margin-bottom: 8px; }
    .card__weeksum { font-size: 12px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card__seg { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .card__day { font-family: var(--font-code); font-size: 10px; font-weight: 500; color: var(--ink-3); text-align: center; line-height: 1; }
    .card__day b { color: var(--accent-strong); font-weight: 700; margin-left: 1px; }
  `],
})
export class RouteCardComponent {
  readonly entry = input.required<RouteEntry>();
  readonly hubName = input<string>('');
  readonly selectedDateKey = input<string | null>(null);
  readonly isFavourite = input<boolean>(false);
  readonly timeFormat = input<TimeFormat>('24h');
  /**
   * Current instant (ms) when the selected day is today at the origin airport,
   * else null. Owned by route-list (one timer for all cards); drives the countdown.
   */
  readonly now = input<number | null>(null);

  readonly open = output<void>();
  readonly toggleFavourite = output<void>();

  readonly estimatedTitle = 'Domestic first leg is not from published schedules, verify in the Air Canada app';

  readonly flag = computed(() => getFlag(this.entry().destination));
  readonly region = computed(() => regionVar(this.entry().destination.region));
  readonly season = computed(() => {
    const s = this.entry().destination.season?.trim() ?? '';
    return YEAR_ROUND.has(s) ? null : s;
  });

  readonly originCity = computed(() => this.hubName() || airportName(this.trip()?.origin ?? ''));

  /** Day mode: the flights of the selected day (direct entries only). */
  private readonly dayFlights = computed(() => (this.selectedDateKey() && this.entry().isDirect ? this.entry().flights : []));

  /**
   * Day mode, direct: the flight the card shows. The next one still to leave
   * when `now` is known (so times, flight number and countdown agree), else
   * the first of the day.
   */
  private readonly shownFlight = computed(() => {
    const flights = this.dayFlights();
    const now = this.now();
    return (now != null ? flights.find(f => f.depUtc > now) : undefined) ?? flights[0] ?? null;
  });

  /** Best connecting itinerary for the week (first day that has one). */
  private readonly weekBest = computed(() => this.entry().weekSummary?.days.find(x => x.best)?.best ?? null);

  readonly trip = computed<Trip | null>(() => {
    const e = this.entry();
    if (this.selectedDateKey()) {
      if (e.isDirect) {
        const f = this.shownFlight() ?? e.flights[0];
        return f ? fromFlight(f) : null;
      }
      return e.itinerary ? fromItinerary(e.itinerary) : null;
    }
    if (e.isDirect) {
      const f = typicalFlight(e.flights);
      return f ? fromFlight(f) : null;
    }
    const best = e.itinerary ?? this.weekBest();
    return best ? fromItinerary(best) : null;
  });

  readonly planeX = computed(() => {
    const t = this.trip();
    if (!t || !t.hubs.length) return 60;
    return Math.round(t.hubX + (100 - t.hubX) * 0.55);
  });

  /** Flight count on the selected day. */
  readonly dayCount = computed(() => this.dayFlights().length);

  readonly estimatedText = computed(() => {
    const e = this.entry();
    if (e.isDirect) return null;
    if (this.selectedDateKey()) {
      const n = this.trip()?.estimatedLeg ?? 0;
      return n ? `Leg ${n} estimated` : null;
    }
    if (e.weekSummary?.estimated || this.trip()?.estimatedLeg) return 'Estimated leg';
    return null;
  });

  readonly monoChips = computed<{ text: string; title: string }[]>(() => {
    const e = this.entry();
    const t = this.trip();
    if (!t) return [];
    if (!e.isDirect) {
      if (!this.selectedDateKey()) return [];
      return t.legs
        .filter(l => l.flightNumber)
        .map(l => ({ text: spaceFlightNumber(l.flightNumber), title: `${l.origin}–${l.dest}` }));
    }
    const pool = e.flights;
    const fns = distinct(pool.map(f => f.flightNumber));
    const acs = distinct(pool.map(f => f.aircraft));
    const chips: { text: string; title: string }[] = [];
    if (fns.length) chips.push({ text: spaceFlightNumber(fns[0]) + (fns.length > 1 ? ` +${fns.length - 1}` : ''), title: fns.map(spaceFlightNumber).join(', ') });
    if (acs.length) chips.push({ text: acs[0] + (acs.length > 1 ? ` +${acs.length - 1}` : ''), title: acs.map(aircraftName).join(', ') });
    if (this.selectedDateKey() && this.dayCount() > 1) chips.push({ text: `×${this.dayCount()}`, title: `${this.dayCount()} flights this day` });
    return chips;
  });

  readonly durationText = computed(() => {
    const t = this.trip();
    if (!t) return '';
    const dur = formatDuration(t.totalMin);
    if (!t.hubs.length) return `${dur} · direct`;
    return `${dur} · ${t.hubs.length} stop${t.hubs.length > 1 ? 's' : ''} via ${t.hubs.join('/')}`;
  });

  readonly segs = computed<WeekSeg[]>(() => {
    const e = this.entry();
    const sum = e.weekSummary?.days ?? [];
    return e.weekDays.map((w, i) => {
      const count = w.flights.length;
      const conn = sum.find(s => s.dateKey === w.dateKey)?.connections ?? 0;
      const kind: SegKind = count ? 'direct' : w.coverage === 'outside' ? 'outside' : conn ? 'connect' : 'none';
      const day = `${WEEKDAY_LONG[i]} ${formatKey(w.dateKey, { month: 'short', day: 'numeric' })}`;
      const what =
        kind === 'direct' ? `${count} direct flight${count > 1 ? 's' : ''}`
        : kind === 'connect' ? `connection only${conn > 1 ? ` (${conn} options)` : ''}`
        : kind === 'outside' ? 'schedule not yet published'
        : 'no flights';
      return { dateKey: w.dateKey, letter: DAY_LETTERS[i] ?? '', kind, count, label: `${day}: ${what}` };
    });
  });

  readonly weekText = computed(() => {
    const e = this.entry();
    const direct = e.weekDays.filter(w => w.flights.length).length;
    const ws = e.weekSummary;
    const via = ws?.hubs.length ? `via ${ws.hubs.join('/')}` : '1 stop';
    if (e.isDirect) {
      const base = direct === 7 ? 'Daily direct' : `${direct} ${direct === 1 ? 'day' : 'days'} direct`;
      return ws?.connectOnlyDays ? `${base} · +${ws.connectOnlyDays} ${via}` : base;
    }
    const n = ws?.connectDays ?? e.daysFlying;
    return `${via} · ${n} ${n === 1 ? 'day' : 'days'}`;
  });

  readonly stub = computed(() => {
    const flights = this.dayFlights();
    const f = this.shownFlight();
    if (!f) return null;
    const dayFmt: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
    const flying = this.entry().weekDays.map((w, i) => (w.flights.length ? WEEKDAY_SHORT[i] : null)).filter(Boolean);
    const operates = flying.length === 7 ? 'Daily' : flying.length ? flying.map(x => x!.slice(0, 2)).join(' ') : '—';
    return {
      departs: formatKey(f.dateKey, dayFmt),
      arrives: formatKey(f.arrDateKey, dayFmt),
      flight: spaceFlightNumber(f.flightNumber) || '—',
      aircraft: f.aircraft ?? '—',
      aircraftName: aircraftName(f.aircraft),
      duration: formatDuration(f.durationMin),
      operates,
      more: flights.length - 1,
    };
  });

  /** 'Departs in 3h 12m' when the selected day is today at the origin and the first departure is ahead. */
  readonly countdown = computed(() => {
    const now = this.now();
    const t = this.trip();
    if (now == null || !t || !this.selectedDateKey()) return null;
    const shown = this.entry().isDirect ? this.shownFlight() : t;
    const next = shown && shown.depUtc > now ? shown : null;
    if (!next) return null;
    return formatDuration(Math.ceil((next.depUtc - now) / 60_000));
  });

  readonly noTripText = computed(() => (this.selectedDateKey() ? 'No flight this day' : 'No flights this week'));

  readonly ariaLabel = computed(() => {
    const e = this.entry();
    const d = e.destination;
    const t = this.trip();
    const parts = [`${d.city}, ${d.country}, ${d.code}`];
    parts.push(e.isDirect ? 'Direct' : t?.hubs.length ? `Connecting via ${t.hubs.join(' and ')}` : 'Connecting');
    if (t) {
      const off = t.arrOffset ? ` ${this.dayOffsetLabel(t.arrOffset)}` : '';
      parts.push(`departs ${this.clock(t.dep)}, arrives ${this.clock(t.arr)}${off}, ${formatDuration(t.totalMin)}`);
    }
    if (this.dayCount() > 1) parts.push(`${this.dayCount()} flights this day`);
    if (!this.selectedDateKey()) parts.push(this.weekText());
    if (this.estimatedText()) parts.push('includes an estimated leg');
    parts.push('Open details');
    return parts.join('. ');
  });

  clock(hhmm: string): string {
    return formatClock(hhmm, this.timeFormat());
  }

  offset(n: number): string {
    return formatDayOffset(n);
  }

  dayOffsetLabel(n: number): string {
    if (n === 1) return 'next day';
    if (n > 1) return `${n} days later`;
    return n === -1 ? 'previous day' : `${-n} days earlier`;
  }
}
