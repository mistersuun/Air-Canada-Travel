import { ChangeDetectionStrategy, Component, DOCUMENT, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { HUBS } from '../../data/destinations';
import { reachGateways } from '../../places/reach';
import { AppStateService } from '../../state/app-state.service';
import { ProvenanceTagComponent } from '../../trips/ui/provenance-tag.component';
import { DestPhotoComponent } from '../../ui/dest-photo.component';
import { hubDisplayName } from '../../ui/format';
import { GlassSheetComponent } from '../../ui/glass-sheet.component';
import { destPath, gatewayPath } from '../../ui/links';
import { SegComponent, SegOption } from '../../ui/seg.component';
import { airportTz } from '../../utils/airports';
import { todayKey } from '../../utils/time';
import { GatewayRow, ReachParams, dayLabel, formatHome, gatewayRow, parseHome, readReachParams, reachQueryParams } from './reach-model';
import { reachPlace } from './reach-place';

const SORT_OPTIONS: SegOption[] = [
  { value: 'onward', label: 'Shorter onward trip' },
  { value: 'flights', label: 'More flights' },
];

type Editing = 'dep' | 'home' | 'hub';

/**
 * Ways to reach a place AC does not fly to (/reach/:place, mockup g1 top):
 * the place, the dates and hub of this search, a sort, and one row per
 * nearby AC gateway with that day's flights and the estimated onward trip.
 * Facts only: counts and times, every onward leg labelled Estimated or Unknown.
 */
@Component({
  selector: 'app-reach-page',
  standalone: true,
  imports: [RouterLink, IconComponent, SegComponent, GlassSheetComponent, DestPhotoComponent, ProvenanceTagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare reach">
      <div class="col">
        <div class="top">
          <button type="button" class="ui-circ ui-circ--glass back" aria-label="Back" (click)="back()">
            <app-icon name="arrow-left" [size]="18" />
          </button>
          <label class="ui-search ui-glass search">
            <app-icon name="search" [size]="18" [strokeWidth]="2" />
            <span class="ui-visually-hidden">Search another place</span>
            <input type="search" autocomplete="off" enterkeyhint="search" placeholder="Search a city"
                   [value]="placeName()" (input)="toExplore($event)">
          </label>
        </div>

        @switch (placeState().kind) {
          @case ('loading') {
            <p class="ui-sub status" role="status">Loading places…</p>
          }
          @case ('error') {
            <section class="ui-card empty" role="status">
              <h1 class="ui-h3">City search isn't available right now</h1>
              <p class="ui-sub">The list of places couldn't be loaded. It needs the internet the first time.</p>
              <button type="button" class="ui-btn ui-btn--dark ui-btn--sm" (click)="retry()">Try again</button>
            </section>
          }
          @case ('unknown') {
            <section class="ui-card empty" role="status">
              <h1 class="ui-h3">Place not found</h1>
              <p class="ui-sub">This link doesn't match a place in our city list. Search again from Explore.</p>
              <a class="ui-btn ui-btn--dark ui-btn--sm" routerLink="/" [queryParams]="state.globalParams()">Back to Explore</a>
            </section>
          }
          @case ('ready') {
            @if (served(); as code) {
              <section class="ui-card empty" role="status">
                <h1 class="ui-h3">Air Canada flies to {{ placeName() }}</h1>
                <p class="ui-sub">No need to go through another airport.</p>
                <a class="ui-btn ui-btn--dark ui-btn--sm" [routerLink]="dest(code)" [queryParams]="state.globalParams()">Open {{ placeName() }}</a>
              </section>
            } @else {
              <div class="ui-card chips" role="group" aria-label="This search">
                <button type="button" class="ui-tag ui-tag--neutral chip tn" (click)="edit('dep')" aria-haspopup="dialog">Leave {{ depLabel() }}</button>
                <button type="button" class="ui-tag ui-tag--neutral chip tn" (click)="edit('home')" aria-haspopup="dialog">Home by {{ homeLabel() }}</button>
                <button type="button" class="ui-tag ui-tag--neutral chip" (click)="edit('hub')" aria-haspopup="dialog">From {{ p().hub }}</button>
              </div>

              <app-seg class="sort" stretch glass ariaLabel="Sort gateways" [options]="sortOptions"
                       [value]="p().sort" (valueChange)="set({ sort: $event === 'flights' ? 'flights' : 'onward' })" />

              <div class="head">
                <h1 class="ui-h3 h">Ways to reach {{ placeName() }}</h1>
                <span class="ui-sub nn">Not in our schedule data</span>
              </div>
              <p class="ui-sub cov" data-coverage>Air Canada may still fly there on routes this app doesn't cover, such as some domestic or regional flights.</p>

              @if (!rows().length) {
                <section class="ui-card empty" role="status">
                  @if (unknownRows().length) {
                    <h2 class="ui-h3">No AC airport near {{ placeName() }} with a known onward trip</h2>
                    <p class="ui-sub">Airports nearby have flights, but we can't estimate the trip from them.</p>
                  } @else {
                    <h2 class="ui-h3">No AC airport found near {{ placeName() }}</h2>
                    <p class="ui-sub">Nothing within about 900 km in our schedule data.</p>
                  }
                </section>
              }

              @if (rows().length || (showUnknown() && unknownRows().length)) {
                <div class="ui-card list">
                  @for (r of rows(); track r.code) {
                    @if (r.flight) {
                      <a class="row" [routerLink]="gw(r.code)" [queryParams]="linkParams()">
                        <app-dest-photo class="th" [code]="r.code" size="thumb" />
                        <div class="rt">
                          <div class="nm"><b>via {{ r.city }}</b><span class="c">{{ r.code }}</span></div>
                          <span class="m tn">{{ r.flight }}</span>
                          @if (r.standby) { <span class="m tn">{{ r.standby }}</span> }
                          <span class="m g">{{ r.ground }} <app-provenance-tag [value]="r.provenance" />
                            @if (r.night) { <span class="ui-tag ui-tag--amber">Night on the way likely</span> }</span>
                        </div>
                        <app-icon class="chev" name="chevron-right" [size]="16" />
                      </a>
                    } @else if (r.nextDateKey) {
                      <a class="row idle" [routerLink]="gw(r.code)" [queryParams]="paramsOn(r.nextDateKey)">
                        <app-dest-photo class="th" [code]="r.code" size="thumb" />
                        <div class="rt">
                          <div class="nm"><b>via {{ r.city }}</b><span class="c">{{ r.code }}</span></div>
                          <span class="m tn">{{ r.idle }}</span>
                        </div>
                        <app-icon class="chev" name="chevron-right" [size]="16" />
                      </a>
                    } @else {
                      <div class="row idle">
                        <app-dest-photo class="th" [code]="r.code" size="thumb" />
                        <div class="rt">
                          <div class="nm"><b>via {{ r.city }}</b><span class="c">{{ r.code }}</span></div>
                          <span class="m tn">{{ r.idle }}</span>
                        </div>
                      </div>
                    }
                  }
                  @if (showUnknown()) {
                    @for (r of unknownRows(); track r.code) {
                      @if (r.flight || r.nextDateKey) {
                        <a class="row idle" [routerLink]="gw(r.code)" [queryParams]="r.flight ? linkParams() : paramsOn(r.nextDateKey!)">
                          <app-dest-photo class="th" [code]="r.code" size="thumb" />
                          <div class="rt">
                            <div class="nm"><b>via {{ r.city }}</b><span class="c">{{ r.code }}</span></div>
                            @if (r.flight) { <span class="m tn">{{ r.flight }}</span> } @else { <span class="m tn">{{ r.idle }}</span> }
                            <span class="m g">Onward travel unknown <app-provenance-tag value="unknown" /></span>
                          </div>
                          <app-icon class="chev" name="chevron-right" [size]="16" />
                        </a>
                      } @else {
                        <div class="row idle">
                          <app-dest-photo class="th" [code]="r.code" size="thumb" />
                          <div class="rt">
                            <div class="nm"><b>via {{ r.city }}</b><span class="c">{{ r.code }}</span></div>
                            <span class="m tn">{{ r.idle }}</span>
                            <span class="m g">Onward travel unknown <app-provenance-tag value="unknown" /></span>
                          </div>
                        </div>
                      }
                    }
                  }
                </div>
              }

              @if (unknownRows().length) {
                <button type="button" class="ui-link more" (click)="showUnknown.set(!showUnknown())" [attr.aria-expanded]="showUnknown()">
                  {{ showUnknown() ? 'Hide airports with unknown onward travel' : unknownLabel() }}</button>
              }

              <label class="inc">
                <input type="checkbox" [checked]="p().hubs" (change)="set({ hubs: $any($event.target).checked })">
                Include trips via other Canadian hubs
              </label>
            }
          }
        }
      </div>
    </div>

    <app-glass-sheet [title]="sheetTitle()" [(open)]="sheetOpen">
      @switch (editing()) {
        @case ('dep') {
          <label class="fld"><span class="ui-label">Leave on</span>
            <input type="date" [value]="p().dep" [min]="today()" (change)="setDep($event)"></label>
          <button type="button" class="ui-btn ui-btn--dark ui-btn--block done" (click)="sheetOpen.set(false)">Done</button>
        }
        @case ('home') {
          <label class="fld"><span class="ui-label">Home by</span>
            <input type="datetime-local" [value]="homeValue()" [min]="p().dep + 'T00:00'" (change)="setHome($event)"></label>
          <p class="ui-sub hint">Time at {{ hubName(p().hub) }}.</p>
          <button type="button" class="ui-btn ui-btn--dark ui-btn--block done" (click)="sheetOpen.set(false)">Done</button>
        }
        @case ('hub') {
          <p class="ui-sub hint">Only for this search. Your Explore hub stays {{ state.hub() }}.</p>
          <ul class="hubs" role="list">
            @for (h of hubList; track h.code) {
              <li><button type="button" class="hub" [class.on]="h.code === p().hub" [attr.aria-current]="h.code === p().hub ? 'true' : null"
                          (click)="setHub(h.code)">
                <span class="code">{{ h.code }}</span><span class="hub__name">{{ hubName(h.code) }}</span>
                @if (h.code === p().hub) { <app-icon name="check" [size]="16" /> }
              </button></li>
            }
          </ul>
        }
      }
    </app-glass-sheet>
  `,
  styles: [`
    :host { display: block; }
    .col { max-width: 600px; margin: 0 auto; }
    .top { display: flex; align-items: center; gap: 10px; }
    .back { width: 44px; height: 44px; }
    .search { flex: 1; }
    .status { margin: 24px 4px; }
    .chips { display: flex; flex-wrap: wrap; gap: 10px; padding: 12px 14px; margin-top: 12px; }
    .chip { position: relative; font-size: 12px; padding: 4px 9px; }
    .chip::after { content: ''; position: absolute; inset: -9px -4px; }
    .chip:hover { color: var(--ink); }
    .sort { margin-top: 12px; }
    .head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 22px 2px 10px; }
    .h { font-size: 19px; margin: 0; }
    .nn { font-size: 13px; text-align: right; }
    .list { padding: 4px 14px; }
    .row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--hair); min-width: 0; color: var(--ink); }
    .row:last-child { border-bottom: 0; }
    a.row:hover b { color: var(--blue); }
    a.row:focus-visible { outline-offset: -2px; border-radius: 12px; }
    .th { width: 46px; height: 46px; flex: none; border-radius: var(--radius-thumb); overflow: hidden; }
    .rt { flex: 1; min-width: 0; }
    .nm b { font-weight: 650; font-size: 15px; }
    .c { color: var(--ink-3); font-size: 12px; font-weight: 600; margin-left: 5px; }
    .m { display: block; font-size: 12.5px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
    .m.g { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; white-space: normal; }
    .m .ui-tag { font-size: 10.5px; padding: 2px 7px; }
    .chev { color: var(--ink-3); flex: none; }
    /* Idle rows still carry facts: only the photo is muted, the text keeps full contrast. */
    .idle .th { opacity: .55; }
    .idle .m { white-space: normal; }
    .cov { margin: -4px 2px 10px; font-size: 12.5px; }
    .more { display: block; margin: 10px 4px 0; padding: 12px 0; font-size: 13.5px; text-align: left; }
    .inc { display: flex; align-items: center; gap: 12px; min-height: 44px; margin: 8px 4px 0; font-size: 14px; color: var(--ink-2); cursor: pointer; }
    .inc input { width: 22px; height: 22px; flex: none; margin: 0; accent-color: var(--teal); cursor: pointer; }
    .empty { display: grid; gap: 8px; justify-items: start; padding: 22px; margin-top: 16px; }
    .empty .ui-h3, .empty .ui-sub { margin: 0; }
    .empty .ui-btn { margin-top: 6px; }

    .fld { display: grid; gap: 8px; }
    .fld input {
      height: 48px; padding: 0 14px; border-radius: var(--radius-field); border: 1px solid var(--hair);
      background: var(--surface); color: var(--ink); font-size: 16px; color-scheme: light dark;
    }
    .hint { margin: 10px 0 0; }
    .done { margin-top: 16px; }
    .hubs { list-style: none; display: grid; gap: 2px; margin-top: 10px; }
    .hub { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 8px; border-radius: 14px; text-align: left; font-size: 15px; font-weight: 600; }
    .hub:hover { background: var(--fill); }
    .hub.on { background: color-mix(in srgb, var(--blue) 10%, transparent); color: var(--ink); }
    .hub .code { min-width: 44px; text-align: center; background: var(--ink); color: var(--bg); font-size: 11px; font-weight: 700; border-radius: 999px; padding: 4px 8px; }
    .hub__name { flex: 1; }
    .hub app-icon { color: var(--blue); }

    @media (min-width: 720px) {
      .col { padding-top: 24px; }
    }
  `],
})
export class ReachPage {
  protected readonly state = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);

  /** Route param ('gn-2510911') and query keys (withComponentInputBinding). */
  readonly place = input<string>('');
  readonly dep = input<string | undefined>(undefined);
  readonly home = input<string | undefined>(undefined);
  readonly sort = input<string | undefined>(undefined);
  readonly hubs = input<string | undefined>(undefined);
  readonly hub = input<string | undefined>(undefined);

  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly hubList = HUBS;
  protected readonly showUnknown = signal(false);
  protected readonly editing = signal<Editing>('dep');
  protected readonly sheetOpen = signal(false);

  private readonly resolved = reachPlace(this.place);
  protected readonly placeState = this.resolved.state;
  protected readonly retry = this.resolved.retry;

  readonly today = computed(() => todayKey(airportTz(this.state.hub()), this.state.nowMs()));

  /** The search's params, defaults filled in. */
  readonly p = computed<ReachParams>(() =>
    readReachParams({ dep: this.dep(), home: this.home(), sort: this.sort(), hubs: this.hubs(), hub: this.hub() }, this.today(), this.state.hub()),
  );

  protected readonly placeObj = computed(() => {
    const s = this.placeState();
    return s.kind === 'ready' ? s.place : null;
  });
  protected readonly placeName = computed(() => this.placeObj()?.name ?? '');
  protected readonly served = computed(() => this.placeObj()?.acCode ?? null);

  readonly result = computed(() => {
    const place = this.placeObj();
    if (!place || place.acCode) return { gateways: [], unknownOnward: [] };
    const p = this.p();
    return reachGateways({ place, hub: p.hub, dateKey: p.dep, includeOtherHubs: p.hubs, sort: p.sort, connect: this.state.connect() });
  });

  readonly rows = computed<GatewayRow[]>(() => this.result().gateways.map(g => gatewayRow(g, this.p().dep)));
  readonly unknownRows = computed<GatewayRow[]>(() => this.result().unknownOnward.map(g => gatewayRow(g, this.p().dep)));
  protected readonly unknownLabel = computed(() => {
    const n = this.unknownRows().length;
    return `${n} more airport${n === 1 ? '' : 's'}, onward travel unknown`;
  });

  protected readonly depLabel = computed(() => dayLabel(this.p().dep));
  protected readonly homeLabel = computed(() => dayLabel(this.p().home.dateKey));
  protected readonly homeValue = computed(() => formatHome(this.p().home));
  protected readonly linkParams = computed(() => ({ ...this.state.globalParams(), ...reachQueryParams(this.p()) }));
  protected readonly sheetTitle = computed(() =>
    this.editing() === 'dep' ? 'Leave' : this.editing() === 'home' ? 'Home by' : 'Flying from');

  protected hubName(code: string): string {
    return hubDisplayName(code);
  }

  protected gw(code: string): string[] {
    return gatewayPath(this.place(), code);
  }

  /** Link params for the gateway page on another departure day. */
  protected paramsOn(dep: string): Record<string, string | null> {
    const p = this.p();
    const home = p.home.dateKey < dep ? { ...p.home, dateKey: dep } : p.home;
    return { ...this.state.globalParams(), ...reachQueryParams({ ...p, dep, home }) };
  }

  protected dest(code: string): string[] {
    return destPath(code);
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Writes the search params to the URL (replace, so Back leaves the page). */
  set(patch: Partial<ReachParams>): void {
    const next = { ...this.p(), ...patch };
    if (next.home.dateKey < next.dep) next.home = { ...next.home, dateKey: next.dep };
    void this.router.navigate([], { queryParams: reachQueryParams(next), queryParamsHandling: 'merge', replaceUrl: true, scroll: 'manual' });
  }

  protected edit(what: Editing): void {
    this.editing.set(what);
    this.sheetOpen.set(true);
  }

  protected setDep(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    if (v) this.set({ dep: v });
  }

  protected setHome(e: Event): void {
    const h = parseHome((e.target as HTMLInputElement).value);
    if (h) this.set({ home: h });
  }

  protected setHub(code: string): void {
    this.sheetOpen.set(false);
    this.set({ hub: code });
  }

  /** Typing in the field goes back to Explore's search with that text. */
  protected toExplore(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.state.setQuery(v);
    void this.router.navigate(['/'], { queryParams: this.state.globalParams() }).then(ok => {
      if (!ok) return;
      const field = this.doc.querySelector<HTMLInputElement>('input[data-search-input]');
      field?.focus();
      field?.setSelectionRange?.(field.value.length, field.value.length);
    });
  }

  protected back(): void {
    this.state.goBack(['/']);
  }
}
