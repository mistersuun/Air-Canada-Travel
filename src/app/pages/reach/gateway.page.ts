import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IconComponent, IconName } from '../../components/shared/icons.component';
import { airportEnd, arrivalAtGoal, onwardLinks, placeEnd } from '../../places/ground';
import { GroundTimetableService } from '../../places/ground-timetable.service';
import { Gateway, reachGateways } from '../../places/reach';
import { AppStateService } from '../../state/app-state.service';
import { PhotoService } from '../../state/photo.service';
import { shortAircraftName } from '../../trips/engine/facts';
import { TripsService } from '../../trips/trips.service';
import { ProvenanceTagComponent } from '../../trips/ui/provenance-tag.component';
import { DestPhotoComponent } from '../../ui/dest-photo.component';
import { hm, prettyFlight } from '../../ui/format';
import { reachPath, tripUrl } from '../../ui/links';
import { airportTz } from '../../utils/airports';
import type { Itinerary } from '../../utils/connections';
import { todayKey } from '../../utils/time';
import {
  ReachParams, arrivalLine, dayLabel, foundLabel, gatewayRow, groundDetail, groundTimetableLines, groundTitle, itinFlights,
  lastTrainWarning,
  readReachParams, reachQueryParams, segmentLine, startTripFromGateway,
} from './reach-model';
import { reachPlace } from './reach-place';

/**
 * One gateway door to door (/reach/:place/:code, mockup g1 bottom): the
 * flight (Scheduled), the airport exit (Estimated) and the ground trip
 * (Scheduled from a timetable that covers the day, else Estimated), when
 * you'd likely reach the place, links to find the real train or bus, and
 * "Start this trip" (flight + ground leg + same-day backups).
 */
@Component({
  selector: 'app-gateway-page',
  standalone: true,
  imports: [RouterLink, IconComponent, DestPhotoComponent, ProvenanceTagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gw">
      <header class="hero">
        <app-dest-photo class="hero__img" [code]="code()" size="hero" eager [alt]="photoAlt()" (photoShown)="heroShown.set($event)" />
        <div class="hero__bar">
          <button type="button" class="ui-circ" aria-label="Back" (click)="back()"><app-icon name="arrow-left" [size]="18" /></button>
          <button type="button" class="ui-circ star" [attr.aria-pressed]="isFav()"
                  [attr.aria-label]="isFav() ? 'Remove ' + city() + ' from Saved' : 'Save ' + city()" (click)="state.toggleFavourite(code())">
            <app-icon name="star" [size]="18" [filled]="isFav()" />
          </button>
        </div>
        @if (heroShown() && credit(); as c) {
          <p class="credit">
            <a [href]="c.sourceUrl" target="_blank" rel="noopener">Photo</a> ·
            @if (c.authorUrl) { <a [href]="c.authorUrl" target="_blank" rel="noopener">{{ c.author }}</a> } @else { {{ c.author }} }
          </p>
        }
      </header>

      <div class="body">
        <p class="ui-sub tn">{{ city() }} → {{ placeName() || '…' }}</p>
        <h1 class="title"><span class="city">via {{ city() }}</span><span class="code ui-cond">{{ code() }}</span></h1>

        @switch (placeState().kind) {
          @case ('loading') { <p class="ui-sub" role="status">Loading places…</p> }
          @case ('error') {
            <section class="ui-card card" role="status">
              <p class="ui-sub">The list of places couldn't be loaded. It needs the internet the first time.</p>
              <button type="button" class="ui-btn ui-btn--dark ui-btn--sm" (click)="retry()">Try again</button>
            </section>
          }
          @case ('unknown') {
            <section class="ui-card card" role="status"><p class="ui-sub">This link doesn't match a place in our city list.</p></section>
          }
          @case ('ready') {
            @if (gateway(); as g) {
              @if (g.itineraries.length > 1) {
                <div class="opts" role="group" aria-label="Flights that day">
                  @for (it of g.itineraries; track $index) {
                    <button type="button" class="ui-tag opt tn" [class.ui-tag--blue]="$index === pick()" [class.ui-tag--neutral]="$index !== pick()"
                            [attr.aria-pressed]="$index === pick()" (click)="pick.set($index)">
                      {{ flights(it) }} {{ it.legs[0].depLocal }}</button>
                  }
                </div>
              }

              <section class="ui-card card" aria-label="Door to door">
                @if (itin(); as it) {
                  <ol class="chain">
                    @for (l of it.legs; track $index) {
                      <li class="leg">
                        <div class="leg__ic"><b><app-icon name="plane" [size]="12" [strokeWidth]="2.2" /></b><u></u></div>
                        <div class="leg__b">
                          <div class="leg__t tn">{{ seg(l) }}</div>
                          <div class="leg__m tn">{{ fno(l.flightNumber) }}@if (l.aircraft) { · {{ plane(l.aircraft) }}} ·
                            <app-provenance-tag [value]="it.estimated ? 'unknown' : 'scheduled'" /></div>
                          @if ($index > 0) { <div class="leg__m tn">{{ layover(it, $index) }} to connect in {{ l.origin }} · a second standby leg</div> }
                        </div>
                      </li>
                    }
                    @if (g.ground.mode !== 'unknown') {
                      <li class="leg">
                        <div class="leg__ic g"><b><app-icon name="clock" [size]="12" [strokeWidth]="2.2" /></b><u></u></div>
                        <div class="leg__b">
                          <div class="leg__t">{{ g.ground.exitLabel }}</div>
                          <div class="leg__m">allow about {{ hm(g.ground.exitMin) }} · <app-provenance-tag value="estimated" /></div>
                        </div>
                      </li>
                    }
                    <li class="leg">
                      <div class="leg__ic g"><b><app-icon [name]="groundIcon()" [size]="12" [strokeWidth]="2.2" /></b><u></u></div>
                      <div class="leg__b">
                        <div class="leg__t">{{ gTitle() }}</div>
                        <div class="leg__m">{{ gDetail() }} · <app-provenance-tag [value]="g.ground.provenance" /></div>
                        @for (line of gLines(); track $index) { <div class="leg__m" data-timetable>{{ line }}</div> }
                      </div>
                    </li>
                    <li class="end"><i><app-icon name="pin" [size]="12" [filled]="true" /></i><span class="tn">{{ arrival() }}</span>
                      <app-provenance-tag [value]="g.ground.mode === 'unknown' ? 'unknown' : 'estimated'" /></li>
                  </ol>
                  @if (warning(); as w) {
                    <p class="warn" role="note"><app-icon name="warning" [size]="16" />{{ w }}</p>
                  }
                } @else {
                  <p class="none tn">{{ idle() }}</p>
                  @if (g.nextDateKey) {
                    <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" (click)="goTo(g.nextDateKey)">Show {{ day(g.nextDateKey) }}</button>
                  }
                }
                <a class="ui-btn ui-btn--dark ui-btn--block find" [href]="links().google" target="_blank" rel="noopener">
                  <app-icon name="map" [size]="18" />Find onward transport</a>
                <p class="also">Also:
                  <a [href]="links().rome2rio" target="_blank" rel="noopener">Rome2Rio</a> ·
                  <a [href]="links().omio" target="_blank" rel="noopener">Omio</a> ·
                  <a [href]="links().skyscanner" target="_blank" rel="noopener">Skyscanner</a></p>
              </section>

              <div class="ui-card card acts">
                <button type="button" class="ui-btn ui-btn--ghost" [disabled]="!itin()" (click)="start(true)">{{ found() }}</button>
                <button type="button" class="ui-btn" [disabled]="!itin()" (click)="start(false)">Start this trip</button>
              </div>
              <p class="ui-sub foot">Listing stays your own step. Trains and buses here are timetables or estimates until you save the one you found.</p>
            } @else {
              <section class="ui-card card" role="status">
                <p class="ui-sub">{{ code() }} isn't one of the airports near {{ placeName() }}.</p>
                <a class="ui-btn ui-btn--dark ui-btn--sm" [routerLink]="reach()" [queryParams]="linkParams()">See ways to reach {{ placeName() }}</a>
              </section>
            }
          }
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100dvh; }
    .hero { position: relative; height: 280px; overflow: hidden; background: var(--fill); }
    .hero__img { position: absolute; inset: 0; }
    .hero::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, rgba(0, 0, 0, .22), rgba(0, 0, 0, 0) 32%); }
    .hero__bar {
      position: absolute; z-index: 2; top: calc(env(safe-area-inset-top) + 12px); left: 16px; right: 16px;
      display: flex; justify-content: space-between;
    }
    .hero .ui-circ { width: 44px; height: 44px; }
    .star[aria-pressed='true'] { color: #FFFFFF; background: var(--red); border-color: color-mix(in srgb, var(--red) 60%, #FFFFFF); }
    .credit {
      position: absolute; z-index: 2; right: 14px; bottom: 44px; max-width: calc(100% - 28px);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: 11px; color: #FFFFFF; background: rgba(0, 0, 0, .35); padding: 4px 9px; border-radius: 999px;
    }
    .credit a { color: inherit; }

    .body {
      position: relative; z-index: 1; margin-top: -34px; padding: 18px var(--gutter) calc(32px + env(safe-area-inset-bottom));
      border-radius: 30px 30px 0 0; background: var(--glass); border: 1px solid var(--glass-b); border-bottom: 0;
      -webkit-backdrop-filter: blur(24px) saturate(1.4); backdrop-filter: blur(24px) saturate(1.4);
    }
    .title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0; }
    .city { font-size: 30px; font-weight: 700; letter-spacing: -.03em; line-height: 1.15; min-width: 0; overflow-wrap: anywhere; }
    .code { font-size: 24px; color: var(--ink-3); flex: none; }

    .opts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .opt { position: relative; font-size: 12px; }
    .opt::after { content: ''; position: absolute; inset: -9px -3px; }
    .card { padding: 16px; margin-top: 14px; }
    .chain { list-style: none; display: grid; margin: 0; padding: 0; }
    .leg { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 10px; }
    .leg__ic { display: flex; flex-direction: column; align-items: center; }
    .leg__ic b { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; color: var(--blue);
      background: color-mix(in srgb, var(--blue) 14%, transparent); }
    .leg__ic.g b { color: var(--teal); background: color-mix(in srgb, var(--teal) 15%, transparent); }
    .leg__ic u { flex: 1; width: 2px; min-height: 14px; background: var(--hair); }
    .leg__ic.g u { background: repeating-linear-gradient(var(--hair) 0 4px, transparent 4px 8px); }
    .leg__b { padding-bottom: 12px; min-width: 0; }
    .leg__t { font-weight: 650; font-size: 14.5px; }
    .leg__m { font-size: 12.5px; color: var(--ink-2); margin-top: 1px; }
    .leg__m app-provenance-tag { display: inline-flex; vertical-align: middle; }
    .end { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-weight: 650; font-size: 14.5px; }
    .end i { width: 22px; height: 22px; flex: none; border-radius: 50%; background: var(--red); color: #FFFFFF; display: grid; place-items: center; }
    .warn {
      display: flex; gap: 8px; align-items: flex-start; margin: 12px 0 0; padding: 10px 12px; border-radius: 14px;
      background: color-mix(in srgb, var(--amber) 13%, transparent); color: var(--amber-ink); font-size: 13px; font-weight: 500;
    }
    .warn app-icon { flex: none; margin-top: 1px; }
    .none { margin: 0 0 10px; font-size: 14px; color: var(--ink-2); }
    .find { margin-top: 14px; }
    .also { margin: 10px 0 0; text-align: center; font-size: 13px; color: var(--ink-2); }
    .also a { color: var(--blue); font-weight: 500; display: inline-block; padding: 6px 2px; }
    .also a:hover { text-decoration: underline; }
    .acts { display: flex; gap: 10px; align-items: center; padding: 14px; }
    .acts .ui-btn { flex: 1; min-width: 0; padding-inline: 10px; }
    .foot { margin: 12px 4px 0; font-size: 12.5px; }

    @media (min-width: 720px) {
      .gw { max-width: 600px; margin: 0 auto; padding: 24px 0 48px; }
      .hero { height: 300px; border-radius: var(--radius-photo); }
      .hero__bar { top: 16px; }
      .body { margin-top: -40px; border-radius: var(--radius-card); border-bottom: 1px solid var(--glass-b); padding: 22px 24px 24px; box-shadow: var(--shadow); }
    }
  `],
})
export class GatewayPage {
  protected readonly state = inject(AppStateService);
  private readonly photos = inject(PhotoService);
  private readonly trips = inject(TripsService);
  private readonly router = inject(Router);

  constructor() {
    void inject(GroundTimetableService).ensureLoaded();
  }

  readonly place = input<string>('');
  readonly code = input<string>('');
  readonly dep = input<string | undefined>(undefined);
  readonly home = input<string | undefined>(undefined);
  readonly sort = input<string | undefined>(undefined);
  readonly hubs = input<string | undefined>(undefined);
  readonly hub = input<string | undefined>(undefined);

  protected readonly hm = hm;
  protected readonly heroShown = signal(true);

  private readonly resolved = reachPlace(this.place);
  protected readonly placeState = this.resolved.state;
  protected readonly retry = this.resolved.retry;

  private readonly today = computed(() => todayKey(airportTz(this.state.hub()), this.state.nowMs()));
  readonly p = computed<ReachParams>(() =>
    readReachParams({ dep: this.dep(), home: this.home(), sort: this.sort(), hubs: this.hubs(), hub: this.hub() }, this.today(), this.state.hub()),
  );

  protected readonly placeObj = computed(() => {
    const s = this.placeState();
    return s.kind === 'ready' ? s.place : null;
  });
  protected readonly placeName = computed(() => this.placeObj()?.name ?? '');
  protected readonly city = computed(() => airportEnd(this.code())?.name ?? this.code());
  protected readonly isFav = computed(() => this.state.favouriteSet().has(this.code()));
  protected readonly credit = computed(() => this.photos.credit(this.code()));
  protected readonly photoAlt = computed(() => this.credit()?.subject ?? '');

  /** Every gateway of this search (for backups) and the one on this page. */
  readonly result = computed(() => {
    const place = this.placeObj();
    if (!place) return { gateways: [] as Gateway[], unknownOnward: [] as Gateway[] };
    const p = this.p();
    return reachGateways({
      place, hub: p.hub, dateKey: p.dep, includeOtherHubs: p.hubs, sort: p.sort, connect: this.state.connect(), maxGateways: 50,
    });
  });
  readonly gateway = computed<Gateway | null>(() => {
    const r = this.result();
    const code = this.code().toUpperCase();
    return r.gateways.find(g => g.code === code) ?? r.unknownOnward.find(g => g.code === code) ?? null;
  });

  /** Which of that day's itineraries is shown (the best first). */
  protected readonly pick = linkedSignal({ source: () => this.gateway(), computation: () => 0 });
  readonly itin = computed<Itinerary | null>(() => this.gateway()?.itineraries[this.pick()] ?? this.gateway()?.itineraries[0] ?? null);

  /** The gateway's facts for the picked itinerary (arrival and warnings follow the pick). */
  private readonly picked = computed<Gateway | null>(() => {
    const g = this.gateway();
    const it = this.itin();
    if (!g || !it || it === g.itineraries[0]) return g;
    const a = arrivalAtGoal(it.arriveUtc, g.ground, airportTz(g.code));
    return {
      ...g, itineraries: [it, ...g.itineraries.filter(x => x !== it)],
      arriveGoalUtc: a.utc, overnightLikely: a.overnightLikely, lastDepMissed: a.lastDepMissed,
    };
  });

  protected readonly arrival = computed(() => {
    const g = this.picked();
    const place = this.placeObj();
    return g && place ? arrivalLine(place, g.arriveGoalUtc, airportTz(g.code)) : '';
  });
  protected readonly warning = computed(() => {
    const g = this.picked();
    return g ? lastTrainWarning(g) : null;
  });
  protected readonly idle = computed(() => {
    const g = this.gateway();
    return g ? gatewayRow(g, this.p().dep).idle : '';
  });
  protected readonly gTitle = computed(() => {
    const g = this.gateway();
    const place = this.placeObj();
    return g && place ? groundTitle(g.ground, place) : '';
  });
  /** The train or bus the picked flight would catch (timetable corridors only). */
  private readonly nextDep = computed(() => {
    const g = this.gateway();
    const it = this.itin();
    return g && it && g.ground.source === 'timetable' ? arrivalAtGoal(it.arriveUtc, g.ground, airportTz(g.code)).departure : null;
  });
  protected readonly gDetail = computed(() => {
    const g = this.gateway();
    return g ? groundDetail(g.ground, this.nextDep()) : '';
  });
  protected readonly gLines = computed(() => {
    const g = this.gateway();
    return g ? groundTimetableLines(g.ground) : [];
  });
  protected readonly groundIcon = computed<IconName>(() => {
    const m = this.gateway()?.ground.mode;
    return m === 'train' ? 'train' : m === 'bus' ? 'bus' : m === 'car' ? 'car' : 'map';
  });
  protected readonly found = computed(() => foundLabel(this.gateway()?.ground.mode ?? 'unknown'));

  protected readonly links = computed(() => {
    const from = airportEnd(this.code()) ?? { name: this.code(), lat: 0, lng: 0 };
    const place = this.placeObj();
    const to = place ? placeEnd(place) : from;
    return onwardLinks(from, to);
  });

  protected readonly linkParams = computed(() => ({ ...this.state.globalParams(), ...reachQueryParams(this.p()) }));

  // ── Helpers ───────────────────────────────────────────────────────────────
  protected seg(l: Itinerary['legs'][number]): string {
    return segmentLine(l);
  }
  protected fno(n: string | null): string {
    return prettyFlight(n) || 'Estimated flight';
  }
  protected plane(code: string): string {
    return shortAircraftName(code);
  }
  protected flights(it: Itinerary): string {
    return itinFlights(it);
  }
  protected day(key: string): string {
    return dayLabel(key);
  }
  protected layover(it: Itinerary, i: number): string {
    return hm(it.layovers[i - 1] ?? 0);
  }
  protected reach(): string[] {
    return reachPath(this.place());
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  protected goTo(dateKey: string): void {
    void this.router.navigate([], { queryParams: { dep: dateKey }, queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
  }

  /** Creates the trip and opens it (with the ground editor for "I found a train"). */
  start(foundIt: boolean): void {
    const g = this.picked();
    const it = this.itin();
    const place = this.placeObj();
    if (!g || !it || !place) return;
    const { tripId, groundLegId } = startTripFromGateway(this.trips, {
      place, params: this.p(), gateway: g, itinerary: it, others: this.result().gateways,
    });
    void this.router.navigateByUrl(tripUrl(tripId, null, foundIt ? groundLegId : null));
  }

  protected back(): void {
    this.state.goBack(reachPath(this.place()));
  }
}
