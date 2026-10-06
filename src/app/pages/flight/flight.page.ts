import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal,
  untracked, viewChild,
} from '@angular/core';
import { Router, RouterLink, type Params } from '@angular/router';
import { AppStateService } from '../../state/app-state.service';
import { ShareService } from '../../state/share.service';
import { findDestination } from '../../utils/airports';
import { allItineraries, findAlternatives, type Itinerary } from '../../utils/connections';
import { buildIcs, downloadIcs, icsFilename } from '../../utils/ics';
import { addDays, diffDays, isDateKey, weekKeys, weekStartKey as mondayOf } from '../../utils/time';
import { nextFlightDate } from '../../utils/week';
import { IconComponent } from '../../components/shared/icons.component';
import { SegComponent, type SegOption } from '../../ui/seg.component';
import { WeekStripComponent } from '../../ui/week-strip.component';
import { calendarPath, destPath, flightPath, matchSlug, tripPath } from '../../ui/links';
import { GlassSheetComponent } from '../../ui/glass-sheet.component';
import { placeFromDestination } from '../../places/place';
import { refFromInstance } from '../../trips/engine/legs';
import { type Trip, instanceKey } from '../../trips/model';
import { TripsService } from '../../trips/trips.service';
import { OutcomePromptComponent } from '../../trips/ui/outcome-prompt.component';
import { countdown, isOutside, itinKey, prettyFlight, relativeDay, shortDay } from '../../ui/format';
import {
  backupGroups, choose, noteFlights, optionRow, parseNights, pickOf, roundTrip, ticketModel, tripTarget, tripsCovering, tripsFor,
  type Pick,
} from './flight-model';
import { historyFor, recordLine } from '../../trips/engine/track-record';
import { LiveStatusComponent } from '../../live/live-status.component';
import { FactsCardComponent } from './facts-card.component';
import { LoadNotesComponent } from './load-notes.component';
import { TicketComponent } from './ticket.component';
import { OptionRowComponent } from './option-row.component';
import { ReturnPanelComponent } from './return-panel.component';

/** Other options listed before "Show all". */
export const OPTIONS_SHOWN = 4;

/**
 * Home-by for a chosen return, from its local arrival at home: 22:00 on the
 * arrival date, or 23:59 when it lands after 22:00. A small-hours arrival
 * (before 05:00) would otherwise give a deadline already past, so the deadline
 * is 08:00 that morning.
 */
export function homeByFor(ret: Itinerary): { dateKey: string; hhmm: string } {
  const arr = ret.legs[ret.legs.length - 1].arrLocal;
  if (arr < '05:00') return { dateKey: ret.arrDateKey, hhmm: '08:00' };
  return { dateKey: ret.arrDateKey, hhmm: arr > '22:00' ? '23:59' : '22:00' };
}

/**
 * Flight details, /flight/:code/:date/:flight? (spec §4.3).
 *
 * The day's itineraries hub → code (nonstop and, with connections on, one
 * stop), one of them shown as a boarding-pass ticket. Which one: the flight
 * slug when it matches, else ?pick= (Earliest / Nonstop / Fastest), else the
 * earliest. Below: actions (.ics, round-trip .ics, change dates), the other
 * options that day, "If you miss this" backups and the return planner
 * (?nights=, or ?ret= from the calendar). Day chips move the date (replaceUrl).
 * Desktop: the ticket column is sticky on the left, the lists on the right.
 */
@Component({
  selector: 'app-flight-page',
  standalone: true,
  imports: [
    RouterLink, IconComponent, SegComponent, WeekStripComponent, TicketComponent, OptionRowComponent, ReturnPanelComponent,
    FactsCardComponent, LoadNotesComponent, OutcomePromptComponent, GlassSheetComponent, LiveStatusComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare fl">
      <div class="grid">
        <div #left class="left" [class.is-sticky]="leftFits()">
          <div class="top">
            <button type="button" class="ui-circ ui-circ--glass" aria-label="Back" (click)="back()">
              <app-icon name="arrow-left" [size]="18" />
            </button>
            <h1 class="ui-h3">Flight details</h1>
            <button type="button" class="ui-circ ui-circ--glass" aria-label="Share this flight" (click)="share()">
              <app-icon name="share" [size]="18" />
            </button>
          </div>
          <p class="ctx ui-sub tn">{{ hub() }} → {{ dest() }} · {{ destCity() }}</p>

          <app-week-strip class="strip" [glass]="true" [weekStartKey]="weekStart()" [selectedDateKey]="dateKey()"
                          [todayKey]="state.todayKey()" [coverage]="state.coverage()" [dots]="stripDots()"
                          (selectDay)="goDate($event)" (prev)="goDate(shift(-7))" (next)="goDate(shift(7))"
                          (jumpTo)="goDate($event)" />

          <app-seg class="pk" [stretch]="true" ariaLabel="Choose a flight" [options]="pickOptions()"
                   [value]="chosen().pick ?? ''" (valueChange)="setPick($event)" />

          @if (outside()) {
            <div class="ui-card state">
              <h2 class="ui-h3">Schedules for {{ dayLabel() }} aren't published yet</h2>
              <p class="ui-sub">Air Canada publishes schedules a few months ahead. Times will appear here when they do.</p>
              <button type="button" class="ui-btn ui-btn--sm" (click)="toCoverage()">Go to last published week</button>
            </div>
          } @else if (ticket(); as t) {
            <app-ticket [model]="t" [label]="ticketLabel()" />
            @if (liveLeg(); as l) {
              <app-live-status [flightNumber]="l.flightNumber" [origin]="l.origin" [depUtc]="l.depUtc" [leadMs]="sixHours" />
            }
            @if (clock(); as c) {
              <p class="cd tn" [class.cd--live]="c.live"><app-icon name="clock" [size]="15" />{{ c.text }}</p>
            }
            <div class="acts">
              <button type="button" class="ui-btn ui-btn--dark" (click)="exportIcs(false)">
                <app-icon name="calendar" [size]="17" /> Add to calendar
              </button>
              @if (returnPick()) {
                <button type="button" class="ui-btn ui-btn--ghost" (click)="exportIcs(true)">
                  <app-icon name="download" [size]="17" /> Round trip .ics
                </button>
              }
              <a class="ui-btn ui-btn--ghost" [routerLink]="calendarLink()" [queryParams]="calendarParams()">Change dates</a>
              @if (tripAction(); as a) {
                <button type="button" class="ui-btn ui-btn--ghost" data-add-trip [disabled]="a.disabled" (click)="addToTrip()">
                  <app-icon name="suitcase" [size]="17" /> {{ a.label }}
                </button>
              }
            </div>
          } @else {
            <div class="ui-card state">
              <h2 class="ui-h3">No flights on {{ dayLabel() }}</h2>
              @if (nextDate(); as n) {
                <p class="ui-sub">The next nonstop to {{ destCity() }} leaves {{ n.label }}.</p>
                <a class="ui-btn ui-btn--sm" [routerLink]="n.link" [queryParams]="keepParams()" [replaceUrl]="true">See {{ n.label }}</a>
              } @else {
                <p class="ui-sub">No published nonstop from {{ hub() }} after this date.</p>
              }
              @if (hiddenConnections()) {
                <button type="button" class="ui-link conn" (click)="state.setShowConnections(true)">Show connections for this day</button>
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
        </div>

        <div class="right">
          @if (current(); as it) {
            @if (others().length) {
              <section class="sec" aria-labelledby="fl-others">
                <div class="ui-sec-h">
                  <h2 class="ui-h3" id="fl-others">Other options</h2>
                  <span class="ui-tag ui-tag--amber">{{ others().length }} more</span>
                </div>
                <div class="ui-card list">
                  @for (r of visibleOthers(); track r.key) {
                    <app-option-row [row]="r" [link]="linkFor(r.it)" [queryParams]="keepParams()" [replaceUrl]="true" />
                  }
                </div>
                @if (others().length > visibleOthers().length) {
                  <button type="button" class="ui-link more" (click)="allOthers.set(true)">Show all {{ others().length }}</button>
                }
              </section>
            }

            <section class="sec" aria-labelledby="fl-miss">
              <div class="ui-sec-h">
                <h2 class="ui-h3" id="fl-miss">If you miss this</h2>
                <span class="ui-sub small">Schedules, not seats</span>
              </div>
              <div class="ui-card list">
                @for (g of backups(); track g.id) {
                  <div class="grp" [attr.data-group]="g.id">{{ g.label }}</div>
                  @for (r of g.rows; track r.key) {
                    <app-option-row [row]="r" [link]="linkFor(r.it)" [queryParams]="keepParams()" [replaceUrl]="true" />
                  }
                } @empty {
                  <p class="none">No later option today or tomorrow in the published schedules.</p>
                }
              </div>
            </section>

            <section class="sec" aria-labelledby="fl-ret">
              <div class="ui-sec-h">
                <h2 class="ui-h3" id="fl-ret">Return</h2>
                @if (returnPick()) { <span class="ui-tag ui-tag--teal">Round trip ready</span> }
              </div>
              <div class="ui-card ret">
                <app-return-panel [outbound]="it" [hub]="hub()" [code]="dest()" [nights]="nightCount()" [ret]="ret() ?? null"
                  [coverage]="state.coverage()" [connect]="state.connect()" [showConnections]="state.showConnections()"
                  [timeFormat]="state.timeFormat()" [selectedKey]="returnKey()" [showAll]="allReturns()"
                  (nightsChange)="setNights($event)" (selectedChange)="pickReturn($event)" (expand)="allReturns.set(true)" />
              </div>
            </section>
          }
          @if (pickerOpen()) {
            <app-glass-sheet title="Add to which trip?" [open]="true" (closed)="pickerOpen.set(false)">
              <div class="pick">
                @for (t of connectedTrips(); track t.id) {
                  <button type="button" class="ui-btn ui-btn--ghost ui-btn--block" data-pick-trip (click)="addTo(t)">{{ t.name }}</button>
                }
              </div>
            </app-glass-sheet>
          }
          <p class="foot ui-sub">Published schedules only, times local at each airport. Not seat availability: verify on aircanada.com.</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .fl { max-width: 480px; }
    .top { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 4px; }
    .top h1 { margin: 0; }
    .ctx { text-align: center; margin: 0 0 12px; font-size: 12.5px; }
    .strip { display: block; margin-bottom: 12px; }
    .pk { margin-bottom: 14px; }
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
    .ret { padding: 16px; }
    .adds { display: grid; gap: 14px; margin-top: 18px; }
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
      .ret { padding: 20px 22px; }
      .foot { margin: 0; text-align: left; }
      .strip { margin-inline: 40px; }
    }
  `],
})
export class FlightPage {
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
  protected readonly allReturns = signal(false);
  protected readonly pickerOpen = signal(false);
  protected readonly returnPick = signal<Itinerary | null>(null);
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
  protected readonly nightCount = computed(() => parseNights(this.nights()));

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

  protected readonly pickOptions = computed<SegOption[]>(() => [
    { value: 'earliest', label: 'EARLIEST', disabled: !this.itineraries().length },
    { value: 'nonstop', label: 'NONSTOP', disabled: !pickOf(this.itineraries(), 'nonstop') },
    { value: 'fastest', label: 'FASTEST', disabled: !this.itineraries().length },
  ]);

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
    const t = this.ticket();
    return t ? `${t.origin} ${t.dep} to ${t.dest} ${t.arr}, ${t.depDate}, ${t.nonstop ? 'nonstop' : t.tag.toLowerCase()}` : '';
  });

  /** Countdown line: 'Departs today · in 2h 10m', 'In the air · lands in 3h', 'Departed Thu, Oct 1'. */
  protected readonly clock = computed(() => {
    const it = this.current();
    if (!it) return null;
    const now = this.state.nowMs();
    if (now < it.departUtc) {
      const day = relativeDay(it.dateKey, this.state.todayKey());
      return { text: `Departs ${day === 'Today' || day === 'Tomorrow' ? day.toLowerCase() : day} · ${countdown(it.departUtc - now)}`, live: it.departUtc - now < 86_400_000 };
    }
    if (now < it.arriveUtc) return { text: `In the air · lands ${countdown(it.arriveUtc - now)}`, live: true };
    return { text: `Departed ${shortDay(it.dateKey)}`, live: false };
  });

  protected readonly stripDots = computed(() =>
    weekKeys(this.weekStart()).map(k => {
      if (isOutside(k, this.state.coverage())) return false;
      const its = allItineraries(this.hub(), this.dest(), k, this.state.connect());
      return this.state.showConnections() ? its.length > 0 : its.some(i => !i.hubs.length);
    }));

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

  protected readonly backups = computed(() => {
    const it = this.current();
    if (!it) return [];
    return backupGroups(findAlternatives(it.origin, it.dest, it, this.state.connect()), it, this.state.timeFormat());
  });

  protected readonly nextDate = computed(() => {
    if (this.current()) return null;
    const key = nextFlightDate(this.hub(), this.dest(), this.dateKey(), false);
    return key ? { key, label: shortDay(key), link: flightPath(this.dest(), key) } : null;
  });

  protected readonly returnKey = computed(() => {
    const r = this.returnPick();
    return r ? itinKey(r) : null;
  });

  /** Params kept on in-page links: the global keys plus the return planner's. */
  protected readonly keepParams = computed<Params>(() => {
    const p: Params = { ...this.state.globalParams() };
    if (this.ret()) p['ret'] = this.ret();
    if (this.nights()) p['nights'] = this.nights();
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
    const holding = this.trips.activeTrips().find(t => t.legs.some(l => l.kind === 'flight' && l.refs.some(r => keys.has(instanceKey(r)))));
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
    if (!list.length) return { label: 'Start a trip', disabled: this.trips.readOnly() };
    if (list.length > 1) return { label: 'Add to trip', disabled: this.trips.readOnly() };
    const t = list[0];
    return tripTarget(t, it).kind === 'already'
      ? { label: `In ${t.name}`, disabled: true }
      : { label: `Add to ${t.name}`, disabled: this.trips.readOnly() };
  });

  protected readonly calendarLink = computed(() => calendarPath(this.dest()));
  protected readonly calendarParams = computed<Params>(() => ({ ...this.state.globalParams(), dep: this.dateKey() }));

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
    // A different outbound (day or option) or return date drops the picked return.
    const outKey = computed(() => {
      const it = this.current();
      return it ? itinKey(it) : null;
    });
    effect(() => {
      this.dateKey();
      outKey();
      this.ret();
      this.nights();
      untracked(() => {
        this.returnPick.set(null);
        this.allReturns.set(false);
      });
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

  /** Day chips and week arrows: same page, another date (the slug is dropped). */
  goDate(key: string | null): void {
    if (!key || !isDateKey(key) || key === this.dateKey()) return;
    void this.router.navigate(flightPath(this.dest(), key), { queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
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

  setNights(n: number): void {
    void this.router.navigate([], {
      queryParams: { nights: n, ret: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
      scroll: 'manual',
    });
  }

  pickReturn(it: Itinerary | null): void {
    this.returnPick.set(it);
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
    // Same return date the Return panel shows: an explicit ?ret= on/after arrival, else nights from arrival.
    const pick = this.returnPick();
    const retDate = this.ret();
    const homeDate = retDate && isDateKey(retDate) && retDate >= it.arrDateKey ? retDate : addDays(it.arrDateKey, this.nightCount());
    const trip = this.trips.create({
      goal: placeFromDestination(this.dest()),
      fromHub: this.hub(),
      outboundDate: it.dateKey,
      homeBy: pick ? homeByFor(pick) : { dateKey: homeDate, hhmm: '22:00' },
    });
    this.trips.addFlightLeg(trip.id, it, 'outbound');
    if (pick) this.trips.addFlightLeg(trip.id, pick, 'return');
    void this.router.navigate(tripPath(trip.id), { queryParams: this.state.globalParams() });
  }

  /** Adds the shown itinerary to a trip: as a backup of the leg leaving the same day, else as a new leg. */
  addTo(trip: Trip): void {
    this.pickerOpen.set(false);
    const it = this.current();
    if (!it) return;
    const target = tripTarget(trip, it);
    const flights = it.legs.map(l => l.flightNumber).join(' + ');
    const open = { label: 'Open', run: () => void this.router.navigate(tripPath(trip.id), { queryParams: this.state.globalParams() }) };
    if (target.kind === 'already') {
      this.state.flash(`${flights} is already in ${trip.name}`, open);
    } else if (target.kind === 'alternate') {
      this.trips.addAlternate(trip.id, target.legId, it);
      this.state.flash(`Added ${flights} to ${trip.name} as a backup for ${target.flight}`, open);
    } else {
      const first = target.role === 'outbound';
      const empty = !trip.legs.some(l => l.kind === 'flight');
      if (first && empty && trip.outboundDate !== it.dateKey) {
        // A trip started without a flight takes the chosen flight's day; its home-by moves by the same offset.
        const shift = diffDays(trip.outboundDate, it.dateKey);
        this.trips.update(trip.id, t => ({
          ...t, outboundDate: it.dateKey, homeBy: { ...t.homeBy, dateKey: addDays(t.homeBy.dateKey, shift) },
        }));
      }
      this.trips.addFlightLeg(trip.id, it, target.role);
      const pick = this.returnPick();
      const hasReturn = trip.legs.some(l => l.kind === 'flight' && l.role === 'return' && l.status !== 'abandoned');
      if (first && pick && !hasReturn) {
        this.trips.addFlightLeg(trip.id, pick, 'return');
        this.trips.update(trip.id, t => ({ ...t, homeBy: homeByFor(pick) }));
      }
      this.state.flash(`Added ${flights} to ${trip.name}`, open);
    }
  }

  exportIcs(round: boolean): void {
    const it = this.current();
    if (!it) return;
    const list = round ? roundTrip(it, this.returnPick()) : [it];
    downloadIcs(buildIcs(list, this.destCity()), icsFilename(list));
  }
}
