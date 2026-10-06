import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IconComponent } from '../../components/shared/icons.component';
import { aroundEarthLabel, boardedFlights, statsOf, type DetailResolver } from '../../logbook/logbook';
import { achievements, inspirationStamps, placeStamps, stampAngle } from '../../logbook/stamps';
import { AppStateService } from '../../state/app-state.service';
import { PrefsService } from '../../state/prefs.service';
import { resolveRef } from '../../trips/engine/legs';
import { TripsService } from '../../trips/trips.service';
import { hubDisplayName } from '../../ui/format';
import { airportName } from '../../utils/airports';
import { regionVar } from '../../utils/region-color';
import { formatKey } from '../../utils/time';

/**
 * Logbook (/logbook): what you have flown, counted from boarded flights
 * only, and a passport-style page of stamps. Everything is computed from the
 * trips and flight log on this phone each time; nothing extra is stored.
 * Facts and counts only: no streaks, points or targets. Achievement stamps
 * are listed apart, and only once earned.
 */
@Component({
  selector: 'app-logbook-page',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare lb">
      <header class="lb__head">
        <button type="button" class="ui-circ ui-circ--glass" aria-label="Back" (click)="back()"><app-icon name="arrow-left" [size]="18" /></button>
        <h1 class="ui-h3">Logbook</h1>
        <span class="lb__sp" aria-hidden="true"></span>
      </header>

      @let s = stats();
      @if (s.flights === 0) {
        <section class="ui-card lb__empty" data-empty>
          <h2 class="ui-h3">Nothing here yet</h2>
          <p class="ui-sub">Flights you board are added here, from your trips and your flight log. It stays on this phone.</p>
        </section>
      } @else {
        <section class="tiles" aria-label="Totals" data-stats>
          <div class="tile" data-flights><b class="tn">{{ s.flights }}</b>{{ ' ' }}<span>{{ s.flights === 1 ? 'flight' : 'flights' }}</span></div>
          <div class="tile" data-km>
            <b class="tn">{{ s.km.toLocaleString('en-CA') }}</b>{{ ' ' }}<span>km</span>
            @if (earth()) { <small data-earth>{{ earth() }}</small> }
          </div>
          <div class="tile" data-countries><b class="tn">{{ s.countries.length }}</b>{{ ' ' }}<span>{{ s.countries.length === 1 ? 'country' : 'countries' }}</span></div>
          <div class="tile" data-cities><b class="tn">{{ s.cities.length }}</b>{{ ' ' }}<span>{{ s.cities.length === 1 ? 'city' : 'cities' }}</span></div>
        </section>

        <section class="ui-card facts">
          @if (s.longest; as l) {
            <div class="fact" data-longest>
              <span class="fact__k">Longest flight</span>
              <span class="fact__v tn">{{ l.origin }} → {{ l.dest }} · {{ l.km.toLocaleString('en-CA') }} km</span>
            </div>
          }
          @if (s.mostFlownRoute; as r) {
            <div class="fact" data-route>
              <span class="fact__k">Most-flown route</span>
              <span class="fact__v tn">{{ r.a }} – {{ r.b }} · {{ r.count }} times</span>
            </div>
          }
          @if (s.aircraft.length) {
            <div class="fact fact--col" data-aircraft>
              <span class="fact__k">Aircraft</span>
              <ul class="air">
                @for (a of s.aircraft; track a.code) {
                  <li><span>{{ a.name }}</span><span class="tn">{{ a.count }}</span></li>
                }
              </ul>
            </div>
          }
        </section>
      }

      <h2 class="ui-label lb__lbl">Stamps</h2>
      @if (stamps().length) {
        <ul class="grid" data-stamps>
          @for (st of stamps(); track st.code) {
            <li class="stamp" [style.color]="color(st.region)">
              <svg viewBox="0 0 120 120" width="112" height="112" role="img"
                   [attr.aria-label]="st.city + (st.count > 1 ? ', ' + st.count + ' times' : '')"
                   [style.transform]="'rotate(' + angle(st.code) + 'deg)'">
                <rect x="4" y="4" width="112" height="112" rx="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="7 5" />
                <text x="60" y="62" text-anchor="middle" class="code">{{ st.code }}</text>
                <text x="60" y="82" text-anchor="middle" class="city">{{ st.city }}</text>
                <text x="60" y="100" text-anchor="middle" class="meta">{{ stampMeta(st) }}</text>
              </svg>
            </li>
          }
        </ul>
      } @else {
        <p class="ui-sub lb__ideas" data-ideas-caption>
          Places you could go: a few of the nonstop flights from {{ hubName() }}, just for ideas.
        </p>
        <ul class="grid grid--faint" data-ideas>
          @for (st of ideas(); track st.code) {
            <li class="stamp stamp--faint" [style.color]="color(st.region)">
              <svg viewBox="0 0 120 120" width="112" height="112" role="img" [attr.aria-label]="st.city + ', an idea'"
                   [style.transform]="'rotate(' + angle(st.code) + 'deg)'">
                <rect x="4" y="4" width="112" height="112" rx="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="7 5" />
                <text x="60" y="66" text-anchor="middle" class="code">{{ st.code }}</text>
                <text x="60" y="88" text-anchor="middle" class="city">{{ st.city }}</text>
              </svg>
            </li>
          }
        </ul>
      }

      @if (marks().length) {
        <h2 class="ui-label lb__lbl">Marks</h2>
        <ul class="ach" data-achievements>
          @for (a of marks(); track a.id) {
            <li class="ach__i" [attr.data-ach]="a.id"><b>{{ a.label }}</b><span class="tn">{{ a.detail }}</span></li>
          }
        </ul>
      }

      <p class="lb__foot">Counted from flights marked boarded. Distances are great-circle. On this phone only.</p>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .lb { max-width: 600px; margin-inline: auto; display: flex; flex-direction: column; }
    .lb__head { display: grid; grid-template-columns: 40px 1fr 40px; align-items: center; gap: 12px; margin-bottom: 4px; }
    .lb__head h1 { margin: 0; text-align: center; }
    .lb__lbl { margin: 22px 4px 8px; font-size: 10.5px; }
    .lb__empty { padding: 16px; margin-top: 12px; display: grid; gap: 4px; }
    .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
    .tile {
      background: var(--surface); border-radius: var(--radius-card); box-shadow: var(--shadow); padding: 14px 16px;
      display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px;
    }
    .tile b { font-family: var(--cond); font-size: 40px; line-height: 1; font-weight: 700; letter-spacing: -.01em; }
    .tile span { font-size: 13.5px; color: var(--ink-2); }
    .tile small { flex-basis: 100%; font-size: 12px; color: var(--ink-2); }
    .facts { margin-top: 10px; padding: 4px 16px; }
    .fact { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--hair); }
    .fact:last-child { border-bottom: 0; }
    .fact--col { display: grid; gap: 6px; justify-content: stretch; }
    .fact__k { font-size: 13.5px; color: var(--ink-2); }
    .fact__v { font-size: 14.5px; font-weight: 650; text-align: right; }
    .air { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 14.5px; font-weight: 600; }
    .air li { display: flex; justify-content: space-between; gap: 12px; }
    .grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px 4px; justify-items: center; }
    .stamp { display: grid; place-items: center; padding: 6px 0; }
    .stamp svg { display: block; overflow: visible; }
    .stamp .code { font-family: var(--cond); font-size: 34px; font-weight: 700; fill: currentColor; letter-spacing: .02em; }
    .stamp .city { font-family: var(--sans); font-size: 10.5px; font-weight: 600; fill: var(--ink); }
    .stamp .meta { font-family: var(--sans); font-size: 9px; fill: var(--ink-2); }
    .stamp--faint { opacity: .38; }
    .lb__ideas { margin: 0 4px 6px; }
    .ach { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
    .ach__i {
      display: grid; gap: 1px; padding: 9px 14px; border-radius: 14px; background: var(--fill); font-size: 12.5px; color: var(--ink-2);
    }
    .ach__i b { font-size: 14px; color: var(--ink); font-weight: 650; }
    .lb__foot { margin: 20px 8px 0; font-size: 12px; color: var(--ink-2); text-align: center; }
    @media (min-width: 720px) {
      .lb { padding-top: 24px; }
      .tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }
  `],
})
export class LogbookPage {
  private readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  private readonly prefs = inject(PrefsService);

  /** Times and equipment for an outcome, from the schedules when they still list the flight. */
  private readonly resolve: DetailResolver = f => {
    const i = resolveRef({ ...f, depLocal: '', arrLocal: '', arrDateKey: f.dateKey, aircraft: null });
    return i ? { aircraft: i.aircraft ?? null, depLocal: i.depLocal, arrLocal: i.arrLocal, arrDateKey: i.arrDateKey } : null;
  };

  private readonly flights = computed(() => boardedFlights({ outcomes: this.trips.outcomes() }, this.trips.trips(), this.resolve));
  protected readonly stats = computed(() => statsOf(this.flights()));
  protected readonly earth = computed(() => aroundEarthLabel(this.stats().aroundEarth));
  protected readonly stamps = computed(() => placeStamps(this.flights()));
  protected readonly marks = computed(() => achievements(this.flights()));
  protected readonly hubName = computed(() => hubDisplayName(this.prefs.hub()) || airportName(this.prefs.hub()));
  protected readonly ideas = computed(() => inspirationStamps(this.prefs.hub(), 8));

  protected color(region: string): string {
    return regionVar(region);
  }

  protected angle(code: string): number {
    return stampAngle(code);
  }

  protected stampMeta(st: { count: number; firstDateKey: string }): string {
    const when = formatKey(st.firstDateKey, { month: 'short', year: 'numeric' });
    return st.count > 1 ? `${when} · ×${st.count}` : when;
  }

  protected back(): void {
    this.state.goBack(['/profile']);
  }
}
