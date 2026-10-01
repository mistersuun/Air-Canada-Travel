import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { gatewaysNear } from '../../places/reach';
import { AppStateService } from '../../state/app-state.service';
import type { Trip } from '../../trips/model';
import { TripsService } from '../../trips/trips.service';
import { tripPath, tripQuery } from '../../ui/links';
import { WEEKDAY_SHORT, weekdayIndex } from '../../utils/time';
import { buildReturnView, returnGateway, triesLabel } from '../trips/return/return-model';

/** The first active trip that could fly home from `code`: its return gateway, the goal itself, or a gateway near the goal. */
export function tripHomeFrom(trips: readonly Trip[], code: string): Trip | null {
  return trips.find(t => code !== t.homeAirport && (
    returnGateway(t) === code || t.goal.acCode === code || gatewaysNear(t.goal).some(g => g.code === code)
  )) ?? null;
}

/**
 * Home-by tries in the destination page's Returns area (mockup g3, "Also on
 * /to/LIS"): when an active trip could fly home from this airport, the counts
 * of tries before its deadline and a link to the trip's Return tab. Renders
 * nothing otherwise.
 */
@Component({
  selector: 'app-dest-home-by',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (info(); as i) {
      <a class="hb" [routerLink]="i.link" [queryParams]="i.query" data-home-by>
        <span class="hb__ic" aria-hidden="true"><app-icon name="home" [size]="16" /></span>
        <span class="hb__b">
          <span class="ui-label">{{ i.name }}</span>
          <span class="hb__t tn">{{ i.deadline }}</span>
          <span class="hb__m tn">{{ i.counts }}</span>
        </span>
        <app-icon class="hb__chev" name="chevron-right" [size]="16" />
      </a>
    }
  `,
  styles: [`
    :host { display: block; }
    .hb {
      display: flex; align-items: center; gap: 12px; margin-top: 14px; padding: 12px 14px; min-height: 44px;
      border-radius: 16px; background: var(--fill); color: var(--ink);
    }
    .hb:hover .hb__t { color: var(--blue); }
    .hb__ic {
      width: 32px; height: 32px; border-radius: 10px; background: var(--surface); color: var(--blue);
      display: grid; place-items: center; flex: none;
    }
    .hb__b { flex: 1; min-width: 0; display: grid; gap: 1px; }
    .hb__t { font-weight: 650; font-size: 14px; }
    .hb__m { font-size: 12.5px; color: var(--ink-2); }
    .hb__chev { flex: none; color: var(--ink-3); }
  `],
})
export class DestHomeByComponent {
  readonly code = input.required<string>();

  private readonly state = inject(AppStateService);
  private readonly trips = inject(TripsService);

  protected readonly info = computed(() => {
    const code = this.code();
    const trip = tripHomeFrom(this.trips.activeTrips(), code);
    if (!trip) return null;
    const v = buildReturnView(trip, this.state.connect(), this.state.timeFormat(), code);
    const wd = (k: string) => WEEKDAY_SHORT[weekdayIndex(k)];
    const parts = [`${triesLabel(v.flyTries)} from ${code} if you fly ${wd(v.flyKey)}`];
    if (v.startKey && v.startTries !== null) parts.push(`${v.startTries} if you start ${wd(v.startKey)}`);
    return {
      name: trip.name,
      deadline: v.deadline,
      counts: v.covered ? parts.join(' · ') : `${parts.join(' · ')} · some days unknown`,
      link: tripPath(trip.id),
      query: { ...this.state.globalParams(), ...tripQuery('return') },
    };
  });
}
