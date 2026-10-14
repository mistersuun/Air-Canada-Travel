import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';

import { PlaceSearchComponent } from '../../../places/ui/place-search.component';
import { AppStateService } from '../../../state/app-state.service';
import {
  EndOption, defaultStopDate, endOptions, flightsOn, groundLegBetween, replanOutbound, roleForNewFlight,
} from '../../../trips/engine/edit';
import { refsFromItinerary } from '../../../trips/engine/legs';
import { GROUND_MODES, GroundMode, Place, Trip } from '../../../trips/model';
import { tripStops } from '../../../trips/stops';
import { TripsService } from '../../../trips/trips.service';
import { itinKey, prettyFlight } from '../../../ui/format';
import type { Itinerary } from '../../../utils/connections';
import { addDays, todayKey } from '../../../utils/time';
import { tripAwayAirports } from '../../flight/flight-model';
import { MODE_LABEL, dayLabel, legRows, refsTimes } from '../trips-model';
import { airportTz } from '../../../utils/airports';

type AddKind = 'flight' | 'ground';

/**
 * Edit mode of the Plan tab: rename the trip, move the outbound date (the
 * outbound flight is re-planned for the new day), add or remove stops, add a
 * flight (picked from the schedule for a day between two places) or a ground
 * leg, remove a leg (with Undo), and delete the trip. Every change goes
 * through TripsService, which saves and shows the Undo toast.
 */
@Component({
  selector: 'app-trip-edit',
  standalone: true,
  imports: [PlaceSearchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ui-card te" data-edit aria-label="Edit trip">
      <form class="te__row" (submit)="saveName($event)">
        <label class="fld"><span class="ui-label">Trip name</span>
          <input type="text" name="name" data-name maxlength="120" [value]="name()" (input)="name.set($any($event.target).value)"></label>
        <button type="submit" class="ui-btn ui-btn--sm ui-btn--dark" data-name-save>Rename</button>
      </form>

      <div class="te__row">
        <label class="fld"><span class="ui-label">Outbound date</span>
          <input type="date" name="outbound" data-outbound [min]="today()" [value]="outDate()" (input)="outDate.set($any($event.target).value)"></label>
        <button type="button" class="ui-btn ui-btn--sm ui-btn--dark" data-outbound-save
                [disabled]="!outDate() || outDate() === trip().outboundDate" (click)="saveDate()">Change date</button>
      </div>

      <section class="te__sec">
        <h3 class="ui-h3">Stops</h3>
        <ol class="te__l" data-stops>
          @for (s of stops(); track s.id; let i = $index) {
            <li class="te__it" [attr.data-stop]="s.id">
              <span class="te__tx"><b>{{ s.place.name }}</b><span class="ui-sub tn">{{ i === 0 ? 'First stop' : 'Arrive ' + day(s.arriveDate) }}</span></span>
              @if (i > 0) {
                <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost" data-stop-remove
                        [attr.aria-label]="'Remove ' + s.place.name" (click)="removeStop(s.id)">Remove</button>
              }
            </li>
          }
        </ol>
        @if (stopOpen()) {
          <div class="te__box" data-stop-form>
            @if (newStop(); as p) {
              <p><b>{{ p.name }}</b> <button type="button" class="te__lnk" (click)="newStop.set(null)">Change</button></p>
              <label class="fld"><span class="ui-label">You get there on</span>
                <input type="date" name="stopDate" data-stop-date [min]="trip().outboundDate" [value]="stopDate()" (input)="stopDate.set($any($event.target).value)"></label>
              <button type="button" class="ui-btn ui-btn--dark ui-btn--block" data-stop-add (click)="addStop(p)">Add stop</button>
            } @else {
              <app-place-search label="Search the next stop" (picked)="pickStop($event)" />
            }
            <button type="button" class="te__lnk" (click)="closeStop()">Cancel</button>
          </div>
        } @else {
          <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost te__add" data-stop-open (click)="openStop()">Add a stop</button>
        }
      </section>

      <section class="te__sec">
        <h3 class="ui-h3">Legs</h3>
        <ol class="te__l" data-legs>
          @for (r of rows(); track r.id) {
            <li class="te__it" [attr.data-leg-edit]="r.id" [class.is-done]="r.done">
              <span class="te__tx"><b>{{ r.title }}</b><span class="ui-sub tn">{{ r.meta }}</span></span>
              <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost" data-leg-remove
                      [attr.aria-label]="'Remove ' + r.title" (click)="removeLeg(r.id)">Remove</button>
            </li>
          } @empty {
            <li class="ui-sub">No legs yet.</li>
          }
        </ol>

        @if (adding(); as kind) {
          <div class="te__box" data-leg-form [attr.data-kind]="kind">
            <div class="te__seg" role="group" aria-label="Kind of leg">
              <button type="button" [class.on]="kind === 'flight'" [attr.aria-pressed]="kind === 'flight'" data-kind-flight (click)="adding.set('flight')">Flight</button>
              <button type="button" [class.on]="kind === 'ground'" [attr.aria-pressed]="kind === 'ground'" data-kind-ground (click)="adding.set('ground')">Ground</button>
            </div>
            <div class="te__2">
              <label class="fld"><span class="ui-label">From</span>
                <select name="from" data-from (change)="from.set($any($event.target).value)">
                  @for (o of ends(kind); track o.key) { <option [value]="o.key" [selected]="o.key === from()">{{ o.label }}</option> }
                </select></label>
              <label class="fld"><span class="ui-label">To</span>
                <select name="to" data-to (change)="to.set($any($event.target).value)">
                  @for (o of ends(kind); track o.key) { <option [value]="o.key" [selected]="o.key === to()">{{ o.label }}</option> }
                </select></label>
            </div>
            <label class="fld"><span class="ui-label">Day</span>
              <input type="date" name="legDate" data-leg-date [value]="legDate()" (input)="legDate.set($any($event.target).value)"></label>

            @if (kind === 'flight') {
              <div data-flights>
                @for (it of flights(); track key(it)) {
                  <div class="te__fl">
                    <span class="te__tx"><b class="tn">{{ numbers(it) }}</b><span class="ui-sub tn">{{ it.origin }} → {{ it.dest }} · {{ times(it) }}</span></span>
                    <button type="button" class="ui-btn ui-btn--sm ui-btn--dark" data-flight-add (click)="addFlight(it)">Add</button>
                  </div>
                } @empty {
                  <p class="ui-sub" data-flights-none>No flight found in our schedule data for that day between those places.</p>
                }
              </div>
            } @else {
              <label class="fld"><span class="ui-label">How</span>
                <select name="mode" data-mode (change)="mode.set($any($event.target).value)">
                  <option value="" [selected]="!mode()">Best guess</option>
                  @for (m of modes; track m) { <option [value]="m" [selected]="m === mode()">{{ modeLabel[m] }}</option> }
                </select></label>
              <div class="te__2">
                <label class="fld"><span class="ui-label">Leaves (optional)</span>
                  <input type="time" name="depTime" data-dep-time [value]="depTime()" (input)="depTime.set($any($event.target).value)"></label>
                <label class="fld"><span class="ui-label">Arrives (optional)</span>
                  <input type="time" name="arrTime" data-arr-time [value]="arrTime()" (input)="arrTime.set($any($event.target).value)"></label>
              </div>
              @if (error()) { <p class="te__err" role="alert">{{ error() }}</p> }
              <button type="button" class="ui-btn ui-btn--dark ui-btn--block" data-ground-add (click)="addGround()">Add ground leg</button>
            }
            <button type="button" class="te__lnk" (click)="adding.set(null)">Cancel</button>
          </div>
        } @else {
          <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost te__add" data-leg-open (click)="openAdd('flight')">Add a leg</button>
        }
      </section>

      <button type="button" class="te__del" data-edit-delete (click)="deleteTrip()">Delete this trip</button>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .te { display: grid; gap: 18px; padding: 16px; }
    .te__row { display: flex; gap: 10px; align-items: flex-end; }
    .te__row .fld { flex: 1; }
    .te__row .ui-btn { flex: none; min-height: 44px; }
    .te__sec { display: grid; gap: 8px; }
    .te__l { list-style: none; margin: 0; padding: 0; display: grid; }
    .te__it, .te__fl { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--hair); min-width: 0; }
    .te__it.is-done { opacity: .6; }
    .te__tx { flex: 1; min-width: 0; display: grid; }
    .te__tx b { font-size: 14px; font-weight: 650; overflow-wrap: anywhere; }
    .te__tx span { font-size: 12.5px; color: var(--ink-2); }
    .te__it .ui-btn, .te__fl .ui-btn { flex: none; min-height: 44px; }
    .te__box { display: grid; gap: 10px; background: var(--fill); border-radius: 16px; padding: 12px; }
    .te__2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .te__seg { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px; background: var(--surface); border-radius: 11px; padding: 3px; }
    .te__seg button { min-height: 44px; border-radius: 8px; font-weight: 600; color: var(--ink-2); }
    .te__seg button.on { background: var(--fill); color: var(--ink); }
    .fld { display: grid; gap: 4px; min-width: 0; }
    .fld input, .fld select {
      height: 44px; padding: 0 12px; border: 1px solid var(--hair); border-radius: 12px; background: var(--surface);
      color: var(--ink); font: 500 15px var(--sans); min-width: 0; width: 100%;
    }
    .te__add { justify-self: start; }
    .te__lnk { justify-self: start; min-height: 44px; padding: 0 4px; font: inherit; font-weight: 600; text-decoration: underline; color: var(--ink-2); cursor: pointer; }
    .te__err { color: var(--red-ink); font-size: 13px; }
    .te__del { min-height: 44px; color: var(--red-ink); font-weight: 600; justify-self: start; cursor: pointer; }
  `],
})
export class TripEditComponent {
  private readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);

  readonly trip = input.required<Trip>();
  /** Emitted after "Delete this trip" (the page leaves). */
  readonly deleted = output<void>();

  protected readonly modes = GROUND_MODES;
  protected readonly modeLabel = MODE_LABEL;

  protected readonly name = linkedSignal(() => this.trip().name);
  protected readonly outDate = linkedSignal(() => this.trip().outboundDate);

  protected readonly stopOpen = signal(false);
  protected readonly newStop = signal<Place | null>(null);
  protected readonly stopDate = signal('');

  protected readonly adding = signal<AddKind | null>(null);
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly legDate = signal('');
  protected readonly mode = signal<GroundMode | ''>('');
  protected readonly depTime = signal('');
  protected readonly arrTime = signal('');
  protected readonly error = signal('');

  protected readonly today = computed(() => todayKey(airportTz(this.state.hub()), this.state.nowMs()));
  protected readonly stops = computed(() => tripStops(this.trip()));
  protected readonly rows = computed(() => legRows(this.trip(), this.state.timeFormat()));
  private readonly options = computed(() => endOptions(this.trip(), [...tripAwayAirports(this.trip())]));

  /** Places for the pickers; flights need an airport code. */
  protected ends(kind: AddKind): EndOption[] {
    const all = this.options();
    return kind === 'flight' ? all.filter(o => o.code) : all;
  }

  protected readonly flights = computed<Itinerary[]>(() => {
    if (this.adding() !== 'flight') return [];
    const a = this.optionFor(this.from())?.code;
    const b = this.optionFor(this.to())?.code;
    return a && b ? flightsOn(a, b, this.legDate(), this.state.connect(), this.state.showConnections()).slice(0, 8) : [];
  });

  protected times(it: Itinerary): string {
    return refsTimes(refsFromItinerary(it), this.state.timeFormat());
  }

  protected readonly key = itinKey;

  protected day(key: string): string {
    return dayLabel(key);
  }

  protected numbers(it: Itinerary): string {
    return it.legs.map(l => prettyFlight(l.flightNumber)).join(' + ');
  }

  private optionFor(key: string): EndOption | null {
    return this.options().find(o => o.key === key) ?? null;
  }

  // ── Name and date ─────────────────────────────────────────────────────────

  protected saveName(e: Event): void {
    e.preventDefault();
    const n = this.name().trim();
    if (!n) return;
    this.trips.rename(this.trip().id, n);
    this.state.flash('Trip renamed');
  }

  protected saveDate(): void {
    const t = this.trip();
    const date = this.outDate();
    if (!date || date === t.outboundDate) return;
    const it = replanOutbound(t, date, this.state.connect(), this.state.showConnections());
    this.trips.setOutboundDate(t.id, date, it);
  }

  // ── Stops ─────────────────────────────────────────────────────────────────

  protected openStop(): void {
    this.newStop.set(null);
    this.stopDate.set(defaultStopDate(this.trip()));
    this.stopOpen.set(true);
  }

  protected closeStop(): void {
    this.stopOpen.set(false);
    this.newStop.set(null);
  }

  protected pickStop(p: Place): void {
    this.newStop.set(p);
  }

  protected addStop(p: Place): void {
    const t = this.trip();
    const date = this.stopDate();
    if (!date) return;
    const prev = tripStops(t)[tripStops(t).length - 1].place;
    this.trips.addStop(t.id, p, date);
    this.closeStop();
    this.state.flash(`${p.name} added as a stop`);
    // Offer the way there: a ground leg from the last stop, with the flight tab one tap away.
    this.openAdd('ground', `place:${prev.id}`, `place:${p.id}`, date);
  }

  protected removeStop(stopId: string): void {
    this.trips.removeStop(this.trip().id, stopId);
  }

  // ── Legs ──────────────────────────────────────────────────────────────────

  protected removeLeg(legId: string): void {
    this.trips.removeLeg(this.trip().id, legId);
  }

  protected openAdd(kind: AddKind, from?: string, to?: string, date?: string): void {
    const all = this.ends(kind);
    this.adding.set(kind);
    this.from.set(from ?? all[0]?.key ?? '');
    this.to.set(to ?? all.find(o => o.key !== (from ?? all[0]?.key))?.key ?? '');
    this.legDate.set(date ?? this.trip().outboundDate);
    this.mode.set('');
    this.depTime.set('');
    this.arrTime.set('');
    this.error.set('');
  }

  protected addFlight(it: Itinerary): void {
    const t = this.trip();
    this.trips.addFlightLeg(t.id, it, roleForNewFlight(t, it));
    this.state.flash(`${this.numbers(it)} added`);
    this.adding.set(null);
  }

  protected addGround(): void {
    const f = this.optionFor(this.from());
    const dest = this.optionFor(this.to());
    const date = this.legDate();
    if (!f || !dest || f.key === dest.key) {
      this.error.set('Pick two different places.');
      return;
    }
    if (!date) {
      this.error.set('Pick the day.');
      return;
    }
    const dep = this.depTime(), arr = this.arrTime();
    if (!!dep !== !!arr) {
      this.error.set('Add both times, or leave both empty.');
      return;
    }
    const times = dep && arr
      ? { depDateKey: date, depLocal: dep, arrDateKey: arr < dep ? addDays(date, 1) : date, arrLocal: arr }
      : null;
    this.trips.addGroundLeg(this.trip().id, groundLegBetween(f.end, dest.end, date, this.mode() || null, times));
    this.state.flash(`Ground leg ${f.end.name} → ${dest.end.name} added`);
    this.adding.set(null);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  protected deleteTrip(): void {
    this.trips.remove(this.trip().id);
    this.deleted.emit();
  }
}
