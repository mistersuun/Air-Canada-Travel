import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal,
  untracked, viewChild,
} from '@angular/core';
import { Router, RouterLink, type NavigationExtras, type Params } from '@angular/router';
import { t } from '../../i18n/t';
import { AppStateService } from '../../state/app-state.service';
import { ShareService } from '../../state/share.service';
import { airportTz, findDestination } from '../../utils/airports';
import { allItineraries, findAlternatives, type Itinerary } from '../../utils/connections';
import { buildIcs, downloadIcs, icsFilename } from '../../utils/ics';
import { addDays, diffDays, formatKey, isDateKey, todayKey, weekKeys, weekStartKey as mondayOf } from '../../utils/time';
import { type CountCtx, minuteOf, nightsBetween, outCounts, retFrom, shiftRet, startRoundTrip } from '../../planner/round-trip';
import { nextFlightDate } from '../../utils/week';
import { seasonEvent } from '../home/home-model';
import { IconComponent } from '../../components/shared/icons.component';
import { SegComponent, type SegOption } from '../../ui/seg.component';
import { WeekStripComponent } from '../../ui/week-strip.component';
import { calendarPath, destPath, flightPath, flightSlug, matchSlug, tripPath } from '../../ui/links';
import { GlassSheetComponent } from '../../ui/glass-sheet.component';
import { refFromInstance } from '../../trips/engine/legs';
import { type Trip, instanceKey } from '../../trips/model';
import { TripsService } from '../../trips/trips.service';
import { OutcomePromptComponent } from '../../trips/ui/outcome-prompt.component';
import { countdown, dayLabel as dayLabelOf, isOutside, itinKey, prettyFlight, relativeDay, shortDay } from '../../ui/format';
import {
  backupGroups, choose, missSummary, missSummaryText, nearbyOptions, noteFlights, optionRow, pickOf, ticketModel, tripTarget, tripsCovering, tripsFor,
  type Pick,
} from './flight-model';
import { historyFor, recordLine } from '../../trips/engine/track-record';
import { LiveStatusComponent } from '../../live/live-status.component';
import { FunFactCardComponent } from './fun-fact-card.component';
import { FactsCardComponent } from './facts-card.component';
import { LoadNotesComponent } from './load-notes.component';
import { TicketComponent } from './ticket.component';
import { OptionRowComponent } from './option-row.component';
import { OnTheDayComponent } from '../../ui/on-the-day.component';
import { ReturnSummaryComponent } from './return-summary.component';

/** Other options listed before "Show all". */
export const OPTIONS_SHOWN = 4;

/** Home-by for a chosen return (moved to the planner model; kept here for existing imports). */
export { homeByFor } from '../../planner/round-trip';

/**
 * Flight details, /flight/:code/:date/:flight? (spec §4.3).
 *
 * The day's itineraries hub → code (nonstop and, with connections on, one
 * stop), one of them shown as a boarding-pass ticket. Which one: the flight
 * slug when it matches, else ?pick= (Earliest / Nonstop / Fastest), else the
 * earliest. Below: actions (.ics, change dates, Start a trip), the "Coming
 * home" card for ?ret= (counts of ways home after this flight lands, or stay
 * chips that set ?ret=; picking the return happens on /plan), the other
 * options that day and "If you miss this" backups. A legacy ?nights=N is
 * rewritten to ?ret = date + N (dates-spec D1). Day chips move the date
 * (replaceUrl) and keep the stay length when the return would fall before it.
 * Desktop: the ticket column is sticky on the left, the lists on the right.
 */
@Component({
  selector: 'app-flight-page',
  standalone: true,
  imports: [
    OnTheDayComponent, RouterLink, IconComponent, SegComponent, WeekStripComponent, TicketComponent, OptionRowComponent, ReturnSummaryComponent,
    FactsCardComponent, FunFactCardComponent, LoadNotesComponent, OutcomePromptComponent, GlassSheetComponent, LiveStatusComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare fl">
      <div class="grid">
        <div #left class="left" [class.is-sticky]="leftFits()">
          <div class="top">
            <button type="button" class="ui-circ ui-circ--glass" [attr.aria-label]="t('ui.back')" (click)="back()">
              <app-icon name="arrow-left" [size]="18" />
            </button>
            <h1 class="ui-h3">{{ t('flight.title') }}</h1>
            <button type="button" class="ui-circ ui-circ--glass" [attr.aria-label]="t('flight.shareAria')" (click)="share()">
              <app-icon name="share" [size]="18" />
            </button>
          </div>
          <p class="ctx ui-sub tn">{{ hub() }} → {{ dest() }} · {{ destCity() }}</p>

          <app-week-strip class="strip" [glass]="true" [weekStartKey]="weekStart()" [selectedDateKey]="dateKey()"
                          [todayKey]="state.todayKey()" [coverage]="state.coverage()" [counts]="stripCounts()"
                          (selectDay)="goDate($event)" (prev)="goDate(shift(-7))" (next)="goDate(shift(7))"
                          (jumpTo)="goDate($event)" />

          <app-seg class="pk" [stretch]="true" [ariaLabel]="t('flight.pickAria')" [options]="pickOptions()"
                   [value]="chosen().pick ?? ''" (valueChange)="setPick($event)" />
          @if (nonstopWhy(); as why) { <p class="pk-why ui-sub" id="pk-why">{{ why }}</p> }

          @if (outside()) {
            <div class="ui-card state">
              <h2 class="ui-h3">{{ t('flight.outsideTitle', { day: dayLabel() }) }}</h2>
              <p class="ui-sub">{{ t('flight.outsideBody') }}</p>
              <button type="button" class="ui-btn ui-btn--sm" (click)="toCoverage()">{{ t('dest.lastPublished') }}</button>
            </div>
          } @else if (ticket(); as tk) {
            <app-ticket [model]="tk" [label]="ticketLabel()" />
            @if (liveLeg(); as l) {
              <app-live-status [flightNumber]="l.flightNumber" [origin]="l.origin" [depUtc]="l.depUtc" [leadMs]="sixHours" />
            }
            @if (clock(); as c) {
              <p class="cd tn" [class.cd--live]="c.live"><app-icon name="clock" [size]="15" />{{ c.text }}</p>
            }
            <div class="acts">
              <button type="button" class="ui-btn ui-btn--dark" (click)="exportIcs()">
                <app-icon name="calendar" [size]="17" /> {{ t('flight.addCal') }}
              </button>
              <a class="ui-btn ui-btn--ghost" [routerLink]="calendarLink()" [queryParams]="calendarParams()">{{ t('flight.changeDates') }}</a>
              @if (tripAction(); as a) {
                <button type="button" class="ui-btn ui-btn--ghost" data-add-trip [disabled]="a.disabled" (click)="addToTrip()">
                  <app-icon name="suitcase" [size]="17" /> {{ a.label }}
                </button>
              }
            </div>
            @if (current(); as it) {
              <app-return-summary class="ret" [outbound]="it" [hub]="hub()" [code]="dest()" [ret]="retKey()"
                                  [ctx]="countCtx()" [timeFormat]="state.timeFormat()" [params]="state.globalParams()"
                                  (pickRet)="setRet($event)" (includeConnections)="state.setShowConnections(true)" />
            }
          } @else {
            <div class="ui-card state">
              <h2 class="ui-h3">{{ t('flight.noFlightsOn', { day: dayLabel() }) }}</h2>
              @if (nextDate(); as n) {
                <p class="ui-sub">{{ t('flight.nextNonstopTo', { city: destCity(), date: n.label }) }}</p>
                <a class="ui-btn ui-btn--sm" [routerLink]="n.link" [queryParams]="keepParams()" [replaceUrl]="true">{{ t('flight.see', { date: n.label }) }}</a>
              } @else {
                <p class="ui-sub">{{ t('flight.noNonstopAfter', { hub: hub() }) }}</p>
              }
              @if (hiddenConnections()) {
                <button type="button" class="ui-link conn" (click)="state.setShowConnections(true)">{{ t('flight.showConnDay') }}</button>
              }
            </div>
          }

          <div class="adds">
            <app-facts-card [origin]="hub()" [dest]="dest()" [dateKey]="dateKey()" [timeFormat]="state.timeFormat()" [records]="records()" />
            @if (noteFlights().length) {
              <app-load-notes [flights]="noteFlights()" [selected]="noteKey()" [partySize]="partySize()" [timeFormat]="state.timeFormat()" />
            }
            @for (p of prompts(); track p.key) { <app-outcome-prompt [prompt]="p" /> }
          </div>
          @if (ticket() && !departed()) { <app-fun-fact-card class="ff" [code]="dest()" [hub]="hub()" [nowMs]="state.nowMs()" [city]="destCity()" /> }
        </div>

        <div class="right">
          @if (current()) {
            @if (others().length) {
              <section class="sec" aria-labelledby="fl-others">
                <div class="ui-sec-h">
                  <h2 class="ui-h3" id="fl-others">{{ t('flight.others') }}</h2>
                  <span class="ui-tag ui-tag--amber">{{ t('flight.moreCount', { n: others().length }) }}</span>
                </div>
                <div class="ui-card list">
                  @for (r of visibleOthers(); track r.key) {
                    <app-option-row [row]="r" [link]="linkFor(r.it)" [queryParams]="keepParams()" [replaceUrl]="true" />
                  }
                </div>
                @if (others().length > visibleOthers().length) {
                  <button type="button" class="ui-link more" (click)="allOthers.set(true)">{{ t('flight.showAll', { n: others().length }) }}</button>
                }
              </section>
            }

            <section class="sec" aria-labelledby="fl-miss">
              <div class="ui-sec-h">
                <h2 class="ui-h3" id="fl-miss">{{ t('flight.ifMiss') }}</h2>
                <span class="ui-sub small">{{ t('flight.schedulesNotSeats') }}</span>
              </div>
              @if (missLine()) { <p class="miss tn" data-miss-summary>{{ missLine() }}</p> }
              <div class="ui-card list">
                @for (g of backups(); track g.id) {
                  <div class="grp" [attr.data-group]="g.id">{{ g.label }}</div>
                  @for (r of g.rows; track r.key) {
                    <app-option-row [row]="r" [link]="linkFor(r.it)" [queryParams]="keepParams()" [replaceUrl]="true" />
                  }
                } @empty {
                  <p class="none">{{ t('flight.noLater') }}</p>
                }
              </div>
            </section>
          }
          @if (pickerOpen()) {
            <app-glass-sheet [title]="t('flight.addToWhich')" [open]="true" (closed)="pickerOpen.set(false)">
              <div class="pick">
                @for (ct of connectedTrips(); track ct.id) {
                  <button type="button" class="ui-btn ui-btn--ghost ui-btn--block" data-pick-trip (click)="addTo(ct)">{{ ct.name }}</button>
                }
              </div>
            </app-glass-sheet>
          }
          <app-on-the-day [codes]="[hub(), dest()]" />
          <p class="foot ui-sub">{{ t('flight.footer') }}</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .miss { margin: 0 0 8px; font-size: 13.5px; color: var(--ink-2); }
    :host { display: block; }
    .fl { max-width: 480px; }
    .top { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 4px; }
    .top h1 { margin: 0; }
    .ctx { text-align: center; margin: 0 0 12px; font-size: 12.5px; }
    .strip { display: block; margin-bottom: 12px; }
    .pk { margin-bottom: 14px; }
    .pk:has(+ .pk-why) { margin-bottom: 6px; }
    .pk-why { margin: 0 0 14px; font-size: 12.5px; }
    .state { padding: 22px; display: grid; gap: 8px; justify-items: start; }
    .state h2, .state p { margin: 0; }
    .state .ui-btn { margin-top: 6px; }
    .conn { font-size: 13.5px; margin-top: 4px; }
    .cd { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 14px 0 0; font-size: 13px; font-weight: 600; color: var(--ink-2); }
    .cd--live { color: var(--blue); }
    .acts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
    .acts .ui-btn { flex: 1 1 auto; padding: 13px 16px; font-size: 14.5px; }
    .right { display: grid; gap: 0; align-content: start; min-width: 0; }
    .sec { margin-top: 22px; min-width: 0; }
    .sec .ui-sec-h { margin-bottom: 8px; align-items: center; }
    .sec h2 { margin: 0; font-size: 19px; }
    .small { font-size: 12px; }
    .list { padding: 4px 14px; }
    .grp { padding: 12px 0 0; font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); }
    .none { margin: 0; padding: 14px 0; font-size: 13.5px; color: var(--ink-2); }
    .more { margin-top: 10px; font-size: 13px; }
    .ret { display: block; margin-top: 14px; }
    .adds { display: grid; gap: 14px; margin-top: 18px; }
    .ff { margin-top: 14px; }
    .pick { display: grid; gap: 8px; }
    .foot { margin: 22px 0 0; font-size: 12px; text-align: center; }

    @media (min-width: 720px) {
      .fl { padding-top: 28px; }
    }
    @media (min-width: 1024px) {
      .fl { max-width: var(--page-max); }
      .grid { display: grid; grid-template-columns: 440px minmax(0, 1fr); gap: 32px; align-items: start; }
      .left.is-sticky { position: sticky; top: 24px; }
      .sec { margin-top: 0; margin-bottom: 28px; }
      .sec h2 { font-size: 22px; letter-spacing: -.02em; }
      .list { padding: 6px 22px; }
      .foot { margin: 0; text-align: left; }
      .strip { margin-inline: 40px; }
    }
  `],
})
export class FlightPage {
  protected readonly t = t;
  protected readonly state = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly sharer = inject(ShareService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly trips = inject(TripsService);

  readonly code = input.required<string>();
  readonly date = input<string>();
  readonly flight = input<string>();
  /** Query params (component input binding). */
  readonly pick = input<string>();
  readonly ret = input<string>();
  readonly nights = input<string>();

  protected readonly allOthers = signal(false);
  protected readonly pickerOpen = signal(false);
  /** The ticket column sticks only while it fits in the viewport (else its bottom could never be reached). */
  protected readonly leftFits = signal(true);
  private readonly left = viewChild.required<ElementRef<HTMLElement>>('left');

  protected readonly dest = computed(() => this.code().toUpperCase());
  protected readonly hub = computed(() => this.state.hub());
  protected readonly destCity = computed(() => findDestination(this.dest())?.city ?? this.dest());
  protected readonly dateKey = computed(() => {
    const d = this.date();
    return d && isDateKey(d) ? d : this.state.todayKey();
  });
  protected readonly weekStart = computed(() => mondayOf(this.dateKey()));
  protected readonly dayLabel = computed(() => shortDay(this.dateKey()));
  protected readonly outside = computed(() => isOutside(this.dateKey(), this.state.coverage()));
  /** The return day: ?ret= on or after the date, else (legacy) date + ?nights=, else null (dates-spec D1). */
  readonly retKey = computed(() => retFrom(this.dateKey(), this.ret(), this.nights()));

  /** The planner's count context (one source for the strip and the Coming home card). */
  readonly countCtx = computed<CountCtx>(() => ({
    today: this.state.todayKey(),
    nowMinute: minuteOf(this.state.nowMs()),
    coverage: this.state.coverage(),
    showConnections: this.state.showConnections(),
    connect: this.state.connect(),
    loading: this.state.dataLoad() === 'loading',
  }));

  /** Every itinerary that day; nonstops only when connections are off (unless the slug names a connection). */
  readonly itineraries = computed<Itinerary[]>(() => {
    if (this.outside()) return [];
    const all = allItineraries(this.hub(), this.dest(), this.dateKey(), this.state.connect());
    if (this.state.showConnections()) return all;
    // A shared link to a connection still opens it.
    const slugged = matchSlug(this.flight(), all);
    return slugged?.hubs.length ? all : all.filter(i => !i.hubs.length);
  });

  readonly chosen = computed(() => choose(this.itineraries(), this.flight(), this.pick()));
  readonly current = computed(() => this.chosen().it);
  /** The shown flight has already left (the fun fact is for waiting, not for looking back). */
  protected readonly departed = computed(() => { const it = this.current(); return !!it && it.departUtc <= this.state.nowMs(); });

  protected readonly pickOptions = computed<SegOption[]>(() => [
    { value: 'earliest', label: t('flight.pick.earliest'), disabled: !this.itineraries().length },
    { value: 'nonstop', label: t('flight.pick.nonstop'), disabled: !pickOf(this.itineraries(), 'nonstop'), describedBy: this.nonstopWhy() ? 'pk-why' : undefined },
    { value: 'fastest', label: t('flight.pick.fastest'), disabled: !this.itineraries().length },
  ]);

  /** Why NONSTOP is greyed out: 'No nonstop on Sat · last one Oct 23', or null when it is pickable (or nothing flies). */
  protected readonly nonstopWhy = computed(() => {
    if (this.outside() || !this.itineraries().length || pickOf(this.itineraries(), 'nonstop')) return null;
    const day = formatKey(this.dateKey(), { weekday: 'short' });
    // Hub-local today, the same clock as Home's "Seasonal & ending soon", so the dates agree.
    const ev = seasonEvent(this.hub(), this.dest(), todayKey(airportTz(this.hub()), this.state.nowMs()));
    if (ev?.kind === 'ends' && this.dateKey() > ev.dateKey) {
      return t('flight.noNonstopLast', { day, date: formatKey(ev.dateKey, { month: 'short', day: 'numeric' }) });
    }
    const next = nextFlightDate(this.hub(), this.dest(), this.dateKey(), false);
    return next ? t('flight.noNonstopNext', { day, date: shortDay(next) }) : t('flight.noNonstopDay');
  });

  protected readonly ticket = computed(() => {
    const it = this.current();
    return it ? ticketModel(it, this.state.timeFormat(), this.state.connect().minConnect ?? 60) : null;
  });

  /** The first flight of the shown itinerary, for live status (the component only acts within -12h..+36h of departure). */
  protected readonly sixHours = 6 * 3_600_000;
  protected readonly liveLeg = computed(() => {
    const it = this.current();
    const leg = it?.legs[0];
    return it && leg?.flightNumber ? { flightNumber: leg.flightNumber,origin: it.origin, depUtc: it.departUtc } : null;
  });

  protected readonly ticketLabel = computed(() => {
    const tk = this.ticket();
    return tk
      ? t('flight.ticketAria', {
        origin: tk.origin, dep: tk.dep, dest: tk.dest, arr: tk.arr, date: tk.depDate,
        kind: tk.nonstop ? t('format.nonstop').toLowerCase() : tk.tag.toLowerCase(),
      })
      : '';
  });

  /** Countdown line: 'Departs today · in 2h 10m', 'In the air · lands in 3h', 'Departed Thu, Oct 1'. */
  protected readonly clock = computed(() => {
    const it = this.current();
    if (!it) return null;
    const now = this.state.nowMs();
    if (now < it.departUtc) {
      const day = relativeDay(it.dateKey, this.state.todayKey());
      const when = day === t('format.today') || day === t('format.tomorrow') ? day.toLowerCase() : day;
      return { text: t('flight.departs', { when, cd: countdown(it.departUtc - now) }), live: it.departUtc - now < 86_400_000 };
    }
    if (now < it.arriveUtc) return { text: t('flight.inAir', { cd: countdown(it.arriveUtc - now) }), live: true };
    return { text: t('flight.departed', { date: shortDay(it.dateKey) }), live: false };
  });

  /** Flights out each day of the shown week (the counts follow the connection setting). */
  readonly stripCounts = computed(() =>
    outCounts(this.hub(), this.dest(), weekKeys(this.weekStart()), this.countCtx(), this.state.timeFormat()));

  /** Connections exist that day but are switched off in settings. */
  protected readonly hiddenConnections = computed(() =>
    !this.outside() && !this.itineraries().length && !this.state.showConnections()
    && allItineraries(this.hub(), this.dest(), this.dateKey(), this.state.connect()).length > 0);

  protected readonly others = computed(() => {
    const it = this.current();
    if (!it) return [];
    const k = itinKey(it);
    const fmt = this.state.timeFormat();
    return this.itineraries().filter(i => itinKey(i) !== k).map(i => optionRow(i, fmt));
  });
  protected readonly visibleOthers = computed(() => (this.allOthers() ? this.others() : this.others().slice(0, OPTIONS_SHOWN)));

  private readonly alternatives = computed(() => {
    const it = this.current();
    return it ? findAlternatives(it.origin, it.dest, it, this.state.connect()) : null;
  });
  protected readonly backups = computed(() => {
    const it = this.current(), alts = this.alternatives();
    if (!it || !alts) return [];
    return backupGroups(alts, it, this.state.timeFormat(), nearbyOptions(it, this.state.connect()));
  });
  /** 'After this: 3 more options today, the last at 21:40. Next day: 5, the first at 06:10.' */
  protected readonly missLine = computed(() => {
    const it = this.current(), alts = this.alternatives();
    return it && alts ? missSummaryText(missSummary(alts, it, this.state.connect()), this.state.timeFormat()) : '';
  });

  protected readonly nextDate = computed(() => {
    if (this.current()) return null;
    const key = nextFlightDate(this.hub(), this.dest(), this.dateKey(), false);
    return key ? { key, label: shortDay(key), link: flightPath(this.dest(), key) } : null;
  });

  /** Params kept on in-page links: the global keys plus the return day. */
  protected readonly keepParams = computed<Params>(() => {
    const p: Params = { ...this.state.globalParams() };
    const r = this.retKey();
    if (r) p['ret'] = r;
    return p;
  });

  // ── Trips v2 (g6): load notes, outcome prompts, Add to trip ────────────────

  /** The day's flights that can carry a load note (every segment of the listed itineraries). */
  protected readonly noteFlights = computed(() => noteFlights(this.itineraries(), this.state.timeFormat()));
  /** The shown flight's first segment, pre-selected in the note sheet. */
  protected readonly noteKey = computed(() => {
    const it = this.current();
    return it?.legs[0]?.flightNumber ? instanceKey(refFromInstance(it.legs[0])) : null;
  });
  /** Your own saved outcomes, one line per leg of the shown itinerary that you have tried (same number and route). Counts only. */
  protected readonly records = computed(() => {
    const outcomes = this.trips.outcomes();
    const out: string[] = [];
    if (!outcomes.length) return out;
    for (const l of this.current()?.legs ?? []) {
      const fn = prettyFlight(l.flightNumber);
      if (!fn || l.estimated) continue;
      const h = historyFor({ outcomes }, { flightNumber: fn, route: { origin: l.origin, dest: l.dest }, dateKey: l.dateKey });
      const line = recordLine(h, fn, l.dateKey);
      if (line) out.push(line);
    }
    return out;
  });
  protected readonly coveringTrips = computed(() => tripsCovering(this.trips.activeTrips(), this.dateKey()));
  /** Trips on these dates that the shown flight connects to (goes to the trip's side, or comes home from it). */
  protected readonly connectedTrips = computed(() => {
    const it = this.current();
    return it ? tripsFor(this.trips.activeTrips(), it) : [];
  });
  /** Party size for the notes' open-seat check: the trip holding one of these flights, else a trip covering the day, else 1. */
  protected readonly partySize = computed(() => {
    const keys = new Set(this.noteFlights().map(f => f.key));
    const holding = this.trips.activeTrips().find(tr => tr.legs.some(l => l.kind === 'flight' && l.refs.some(r => keys.has(instanceKey(r)))));
    return (holding ?? this.coveringTrips()[0])?.party.count ?? 1;
  });
  /** Pending "How did it go?" prompts for this page's flights. */
  protected readonly prompts = computed(() => {
    const keys = new Set(this.noteFlights().map(f => f.key));
    const hub = this.hub();
    const dest = this.dest();
    const day = this.dateKey();
    return this.trips.pendingOutcomes().filter(p =>
      keys.has(p.key) || (p.ref.origin === hub && p.ref.dest === dest && p.ref.dateKey === day));
  });
  /**
   * The "Add to trip" button: Start a trip, Add to <trip>, In <trip> (already there), or Add to trip (a picker).
   * Only trips the flight connects to are offered; a flight to an unrelated place starts a new trip.
   */
  protected readonly tripAction = computed<{ label: string; disabled: boolean } | null>(() => {
    const it = this.current();
    if (!it || it.estimated) return null;
    const list = this.connectedTrips();
    if (!list.length) return { label: t('flight.startTrip'), disabled: this.trips.readOnly() };
    if (list.length > 1) return { label: t('flight.addToTrip'), disabled: this.trips.readOnly() };
    const tr = list[0];
    return tripTarget(tr, it).kind === 'already'
      ? { label: t('flight.inTrip', { name: tr.name }), disabled: true }
      : { label: t('dest.trip.add', { name: tr.name }), disabled: this.trips.readOnly() };
  });

  protected readonly calendarLink = computed(() => calendarPath(this.dest()));
  /** The picker opens on this trip: the day, the return day and this flight (carried on to /plan). */
  protected readonly calendarParams = computed<Params>(() => {
    const p: Params = { ...this.state.globalParams(), dep: this.dateKey() };
    const r = this.retKey();
    if (r) p['ret'] = r;
    const it = this.current();
    if (it) p['out'] = flightSlug(it);
    return p;
  });

  constructor() {
    let ro: ResizeObserver | null = null;
    afterNextRender(() => {
      const el = this.left().nativeElement;
      const win = el.ownerDocument.defaultView;
      const sync = () => this.leftFits.set(!win || el.offsetHeight + 48 <= win.innerHeight);
      sync();
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(sync);
        ro.observe(el);
      }
      win?.addEventListener('resize', sync);
      this.destroyRef.onDestroy(() => {
        ro?.disconnect();
        win?.removeEventListener('resize', sync);
      });
    });
    // A legacy ?nights=N becomes ?ret = date + N, written back in place (dates-spec D4).
    effect(() => {
      const n = this.nights();
      if (n === undefined || n === null || n === '') return;
      const ret = this.retKey();
      untracked(() => void this.router.navigate([], {
        queryParams: { ret, nights: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
        scroll: 'manual',
      }));
    });
    effect(() => {
      this.dateKey();
      untracked(() => this.allOthers.set(false));
    });
  }

  protected shift(days: number): string {
    return addDays(this.dateKey(), days);
  }

  protected linkFor(it: Itinerary): string[] {
    return flightPath(this.dest(), it.dateKey, it);
  }

  protected back(): void {
    this.state.goBack(destPath(this.dest()));
  }

  protected share(): void {
    void this.sharer.share(`${this.destCity()} · ${this.dayLabel()}`);
  }

  /**
   * Day chips and week arrows: same page, another date (the slug is dropped).
   * Moving to or past the return day moves the return to keep the nights, and
   * says so (nothing changes silently, D6).
   */
  goDate(key: string | null): void {
    if (!key || !isDateKey(key) || key === this.dateKey()) return;
    const shifted = shiftRet(key, this.dateKey(), this.retKey());
    const extras: NavigationExtras = { queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' };
    if (shifted.moved && shifted.ret) {
      extras.queryParams = { ret: shifted.ret, nights: null };
      this.state.flash(t('planner.toast.retMoved', {
        date: dayLabelOf(shifted.ret, this.state.todayKey()),
        nights: t('planner.nights', { n: nightsBetween(key, shifted.ret) }),
      }));
    }
    void this.router.navigate(flightPath(this.dest(), key), extras);
  }

  setPick(value: string | undefined): void {
    const p = value as Pick;
    const it = pickOf(this.itineraries(), p);
    if (!it) return;
    void this.router.navigate(flightPath(this.dest(), this.dateKey(), it), {
      queryParams: { pick: p },
      queryParamsHandling: 'merge',
      replaceUrl: true,
      scroll: 'manual',
    });
  }

  /** A stay chip or a nearby day: the return day goes in ?ret= (in place). */
  setRet(key: string): void {
    if (!isDateKey(key) || key < this.dateKey()) return;
    void this.router.navigate([], {
      queryParams: { ret: key, nights: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
      scroll: 'manual',
    });
  }

  protected toCoverage(): void {
    const cov = this.state.coverage();
    const from = cov.to && this.dateKey() > cov.to ? addDays(cov.to, -13) : (cov.from ?? this.state.todayKey());
    const target = nextFlightDate(this.hub(), this.dest(), from);
    this.state.jumpToCoverage(target);
    if (target) this.goDate(target);
    else void this.router.navigate(destPath(this.dest()), { queryParams: this.state.globalParams() });
  }

  addToTrip(): void {
    const it = this.current();
    if (!it) return;
    const list = this.connectedTrips();
    if (list.length > 1) {
      this.pickerOpen.set(true);
      return;
    }
    if (list.length === 1) {
      this.addTo(list[0]);
      return;
    }
    // One way from here (the return is picked on /plan): home by the return day at 22:00 when it is on or after landing.
    const r = this.retKey();
    const trip = startRoundTrip(this.trips, {
      hub: this.hub(), code: this.dest(), out: it, back: null, ret: r && r >= it.arrDateKey ? r : null,
    });
    void this.router.navigate(tripPath(trip.id), { queryParams: this.state.globalParams() });
  }

  /** Adds the shown itinerary to a trip: as a backup of the leg leaving the same day, else as a new leg. */
  addTo(trip: Trip): void {
    this.pickerOpen.set(false);
    const it = this.current();
    if (!it) return;
    const target = tripTarget(trip, it);
    const flights = it.legs.map(l => l.flightNumber).join(' + ');
    const open = { label: t('common.open'), run: () => void this.router.navigate(tripPath(trip.id), { queryParams: this.state.globalParams() }) };
    if (target.kind === 'already') {
      this.state.flash(t('flight.already', { flights, name: trip.name }), open);
    } else if (target.kind === 'alternate') {
      this.trips.addAlternate(trip.id, target.legId, it);
      this.state.flash(t('flight.addedBackup', { flights, name: trip.name, backup: target.flight }), open);
    } else {
      const first = target.role === 'outbound';
      const empty = !trip.legs.some(l => l.kind === 'flight');
      if (first && empty && trip.outboundDate !== it.dateKey) {
        // A trip started without a flight takes the chosen flight's day; its home-by moves by the same offset.
        const shift = diffDays(trip.outboundDate, it.dateKey);
        this.trips.update(trip.id, tr => ({
          ...tr, outboundDate: it.dateKey, homeBy: { ...tr.homeBy, dateKey: addDays(tr.homeBy.dateKey, shift) },
        }));
      }
      this.trips.addFlightLeg(trip.id, it, target.role);
      this.state.flash(t('flight.added', { flights, name: trip.name }), open);
    }
  }

  exportIcs(): void {
    const it = this.current();
    if (!it) return;
    downloadIcs(buildIcs([it], this.destCity()), icsFilename([it]));
  }
}
