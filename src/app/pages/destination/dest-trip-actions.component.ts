import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { placeFromDestination } from '../../places/place';
import { AppStateService } from '../../state/app-state.service';
import { type FlightLeg, type Trip, isFinalStatus } from '../../trips/model';
import { TripsService } from '../../trips/trips.service';
import { prettyFlight } from '../../ui/format';
import { calendarPath, flightPath, tripUrl } from '../../ui/links';
import { airportTz } from '../../utils/airports';
import { Itinerary, directItineraries } from '../../utils/connections';
import { addDays, todayKey } from '../../utils/time';
import { DEFAULT_HOME_HHMM, DEFAULT_LEAD_DAYS, DEFAULT_STAY_DAYS } from '../reach/reach-model';

/** What "Add to … trip" would add on the selected day. */
export interface TripAddition {
  trip: Trip;
  it: Itinerary | null;               // null: nothing flies that day, the button just opens the trip
  role: FlightLeg['role'];
  /** Set when the flight joins an existing leg of the same day and origin as a backup. */
  backupOf: FlightLeg | null;
}

/** The trip whose dates cover `dayKey` (outbound date … home-by date), soonest first. */
export function coveringTrip(trips: readonly Trip[], dayKey: string | null): Trip | null {
  if (!dayKey) return null;
  return trips.find(t => t.outboundDate <= dayKey && dayKey <= t.homeBy.dateKey) ?? null;
}

/**
 * The flight to add for `code` on `dayKey`: on the outbound day hub → code;
 * later in the trip code → home (a return) when one flies, else hub → code. It folds in as a backup when
 * the trip already has an open flight leg from the same origin that day.
 */
export function tripAddition(trip: Trip, code: string, dayKey: string): TripAddition {
  // On the outbound day the flight goes out; later in the trip, home first.
  const out = directItineraries(trip.fromHub, code, dayKey);
  const home = code === trip.homeAirport ? [] : directItineraries(code, trip.homeAirport, dayKey);
  const preferHome = dayKey > trip.outboundDate && home.length > 0;
  const it = (preferHome ? home[0] : out[0] ?? home[0]) ?? null;
  const role: FlightLeg['role'] = it && it.origin === code ? 'return' : dayKey === trip.outboundDate ? 'outbound' : 'onward';
  const backupOf = it
    ? (trip.legs.find(l => l.kind === 'flight' && l.refs[0]?.origin === it.origin && l.refs[0]?.dateKey === it.dateKey
      && !isFinalStatus(l.status)) as FlightLeg | undefined) ?? null
    : null;
  return { trip, it, role, backupOf };
}

/**
 * "Start a trip to Lisbon" / "Add to Seville trip" on the destination page
 * (one ghost button). Start creates a trip to the destination with the
 * selected day and no flight: the user is sent to that day's flights (or the
 * day picker when nothing flies) to pick one, so a flight is never chosen for them.
 */
@Component({
  selector: 'app-dest-trip-actions',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (addition(); as a) {
      <button type="button" class="ui-btn ui-btn--ghost b" (click)="add(a)">
        <app-icon name="suitcase" [size]="18" />Add to {{ a.trip.name }}</button>
    } @else {
      <button type="button" class="ui-btn ui-btn--ghost b" (click)="start()">
        <app-icon name="suitcase" [size]="18" />Start a trip to {{ city() }}</button>
    }
  `,
  styles: [`
    :host { display: block; }
    .b { width: 100%; }
    @media (max-width: 719px) { :host { margin-top: 14px; } }
  `],
})
export class DestTripActionsComponent {
  readonly code = input.required<string>();

  private readonly state = inject(AppStateService);
  private readonly trips = inject(TripsService);
  private readonly router = inject(Router);

  protected readonly city = computed(() => placeFromDestination(this.code()).name);
  private readonly day = computed(() => this.state.selectedDateKey());

  /** The day "Add to … trip" looks at: the selected day, else today at the hub (so a trip under way is offered). */
  private readonly coverDay = computed(() => this.day() ?? todayKey(airportTz(this.state.hub()), this.state.nowMs()));

  readonly addition = computed<TripAddition | null>(() => {
    const day = this.coverDay();
    const trip = coveringTrip(this.trips.activeTrips(), day);
    return trip && day ? tripAddition(trip, this.code(), day) : null;
  });

  start(): void {
    const hub = this.state.hub();
    const code = this.code();
    const today = todayKey(airportTz(hub), this.state.nowMs());
    const dep = this.day() ?? addDays(today, DEFAULT_LEAD_DAYS);
    const trip = this.trips.create({
      goal: placeFromDestination(code), fromHub: hub, outboundDate: dep,
      homeBy: { dateKey: addDays(dep, DEFAULT_STAY_DAYS), hhmm: DEFAULT_HOME_HHMM },
    });
    // Never pick a flight for the user: send them to choose one (the day's flights, else the day picker).
    const flies = directItineraries(hub, code, dep).length > 0;
    this.state.flash('Trip started. Pick your flight to add it.');
    void this.router.navigate(flies ? flightPath(code, dep) : calendarPath(code), { queryParams: this.state.globalParams() });
  }

  add(a: TripAddition): void {
    if (a.it) {
      const nums = a.it.legs.map(l => prettyFlight(l.flightNumber)).join(' + ');
      if (a.backupOf) {
        const before = a.backupOf.alternates.length;
        this.trips.addAlternate(a.trip.id, a.backupOf.id, a.it);
        const added = (this.trips.trip(a.trip.id)?.legs.find(l => l.id === a.backupOf!.id) as FlightLeg | undefined)?.alternates.length ?? before;
        this.state.flash(added > before ? `${nums} added as a backup` : `${nums} is already in this trip`);
      } else {
        this.trips.addFlightLeg(a.trip.id, a.it, a.role);
        this.state.flash(`${nums} added to ${a.trip.name}`);
      }
    }
    void this.router.navigateByUrl(tripUrl(a.trip.id));
  }
}
