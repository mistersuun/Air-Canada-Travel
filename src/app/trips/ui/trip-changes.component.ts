import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { AppStateService } from '../../state/app-state.service';
import { tripPath, tripQuery } from '../../ui/links';
import { formatKey } from '../../utils/time';
import { deadlineUtc } from '../engine/homeby';
import { refArrUtc, refDepUtc } from '../engine/legs';
import { FlightLeg, FlightRef, PendingChange, Trip } from '../model';
import { TripsService } from '../trips.service';

/** 'Tue Oct 13'. */
function day(key: string): string {
  return formatKey(key, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
}

export interface ChangeCard {
  id: string;
  kind: PendingChange['kind'];
  legId: string;
  /** 'AC813 retimed in the new schedules'. */
  title: string;
  /** 'Tue Oct 13: 11:25 → 11:10. Still home by your deadline.' */
  body: string;
  /** The new times break the plan (after the deadline or a missed connection). */
  warn: boolean;
  /** 'return' opens the Return tab; anything else opens the leg sheet. */
  backups: 'return' | 'leg';
}

/**
 * One open change as a card. Retimes say what moved and whether the plan
 * still holds: home by the deadline (for a leg that ends at the home
 * airport) and every connection inside the leg at least `minConnect`. Never
 * "cancelled": a flight missing from new data is "not found".
 */
export function changeCard(trip: Trip, c: PendingChange, minConnect: number): ChangeCard | null {
  const leg = trip.legs.find((l): l is FlightLeg => l.id === c.legId && l.kind === 'flight');
  if (!leg) return null;
  const old = c.old;
  const fn = old.flightNumber;
  const backups = leg.role === 'return' ? 'return' : 'leg';
  const base = { id: c.id, kind: c.kind, legId: leg.id, backups } as const;
  if (c.kind === 'outsideCoverage') {
    return {
      ...base, warn: false,
      title: `Schedules for ${day(old.dateKey)} aren't published yet`,
      body: `${fn} stays as you planned it. We check again each time you open the app.`,
    };
  }
  if (c.kind === 'notFound' || !c.next) {
    return {
      ...base, warn: true,
      title: `${fn} not found in the latest schedules · ${day(old.dateKey)}`,
      body: 'Your plan keeps the old times until you choose.',
    };
  }
  const next = c.next;
  const moved: string[] = [];
  if (next.depLocal !== old.depLocal) moved.push(`${old.depLocal} → ${next.depLocal}`);
  if (next.arrLocal !== old.arrLocal || next.arrDateKey !== old.arrDateKey) {
    const offset = next.arrDateKey !== old.arrDateKey ? ` (${day(next.arrDateKey)})` : '';
    moved.push(`${moved.length ? 'lands' : 'Lands'} ${old.arrLocal} → ${next.arrLocal}${offset}`);
  }
  const refs: FlightRef[] = leg.refs.map((r, i) => (i === c.refIndex ? { ...next, flightNumber: r.flightNumber } : r));
  const notes: string[] = [];
  let warn = false;
  for (let i = 1; i < refs.length; i++) {
    if (i !== c.refIndex && i - 1 !== c.refIndex) continue;
    const gap = (refDepUtc(refs[i]) - refArrUtc(refs[i - 1])) / 60_000;
    if (gap < minConnect) {
      warn = true;
      notes.push(gap < 0
        ? `Now lands after ${refs[i].flightNumber} leaves.`
        : `Leaves ${Math.round(gap)} min to connect to ${refs[i].flightNumber}, under your ${minConnect} min.`);
    }
  }
  const last = refs[refs.length - 1];
  if (last.dest === trip.homeAirport) {
    const late = refArrUtc(last) > deadlineUtc(trip.homeBy, trip.homeAirport);
    if (late) warn = true;
    notes.push(late ? 'Now lands after your deadline.' : 'Still home by your deadline.');
  }
  return {
    ...base, warn,
    title: `${fn} retimed in the new schedules`,
    body: `${day(old.dateKey)}: ${moved.join(', ') || 'times changed'}.${notes.length ? ` ${notes.join(' ')}` : ''}`,
  };
}

/** The open change cards of a trip, in leg order. */
export function changeCards(trip: Trip, minConnect: number): ChangeCard[] {
  const order = new Map(trip.legs.map((l, i) => [l.id, i]));
  return trip.changes
    .filter(c => c.state === 'open')
    .sort((a, b) => (order.get(a.legId) ?? 0) - (order.get(b.legId) ?? 0) || a.refIndex - b.refIndex)
    .map(c => changeCard(trip, c, minConnect))
    .filter((c): c is ChangeCard => !!c);
}

/**
 * Schedule change cards (mockup g7). Each open change shows old and new
 * times; nothing in the plan moves until the traveller taps Accept. A flight
 * not found offers "Keep my plan"; a day outside the published schedules is
 * an info card with no action. `compact` (Plan tab) leaves out the info
 * cards and the incomplete-data notice.
 */
@Component({
  selector: 'app-trip-changes',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.display]': "visible() ? 'block' : 'none'" },
  template: `
    @if (!compact() && trips.scheduleNotice(); as n) {
      <p class="tc__info" data-notice><app-icon name="info" [size]="16" /><span>{{ n }}</span></p>
    }
    @for (c of cards(); track c.id) {
      @if (c.kind === 'outsideCoverage') {
        <div class="tc__info" data-change [attr.data-kind]="c.kind">
          <app-icon name="info" [size]="16" />
          <span><b>{{ c.title }}</b> {{ c.body }}</span>
        </div>
      } @else {
        <article class="ui-card tc" data-change [attr.data-kind]="c.kind">
          <div class="tc__top">
            <span class="tc__ic" [class.is-warn]="c.warn" aria-hidden="true">
              <app-icon [name]="c.kind === 'notFound' ? 'warning' : 'clock'" [size]="16" [strokeWidth]="2" />
            </span>
            <div class="tc__rt">
              <b>{{ c.title }}</b>
              <span class="tc__m tn" [class.is-warn]="c.warn">{{ c.body }}</span>
            </div>
          </div>
          <div class="tc__acts">
            @if (c.kind === 'retimed') {
              <button type="button" class="ui-btn ui-btn--dark ui-btn--sm" data-accept (click)="accept(c.id)">Accept</button>
            } @else {
              <button type="button" class="ui-btn ui-btn--dark ui-btn--sm" data-keep (click)="keep(c.id)">Keep my plan</button>
            }
            <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" data-backups (click)="seeBackups(c)">See backups</button>
          </div>
        </article>
      }
    }
  `,
  styles: [`
    :host { display: block; }
    :host > * + * { margin-top: 12px; }
    .tc { padding: 16px; }
    .tc__top { display: flex; gap: 12px; align-items: flex-start; }
    .tc__ic {
      flex: none; width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center;
      background: color-mix(in srgb, var(--amber) 15%, transparent); color: var(--amber);
    }
    .tc__ic.is-warn { background: color-mix(in srgb, var(--red) 12%, transparent); color: var(--red); }
    .tc__rt { min-width: 0; display: grid; gap: 3px; }
    .tc__rt b { font-size: 15px; font-weight: 650; line-height: 1.3; }
    .tc__m { font-size: 13px; color: var(--ink-2); line-height: 1.4; }
    .tc__m.is-warn { color: var(--red-ink); }
    .tc__acts { display: flex; gap: 8px; margin-top: 12px; }
    .tc__acts .ui-btn { flex: 1; min-height: 44px; }
    .tc__info {
      display: flex; gap: 10px; align-items: flex-start; margin: 0; padding: 11px 12px; border-radius: 14px; font-size: 13px;
      line-height: 1.4; background: color-mix(in srgb, var(--blue) 10%, transparent); color: var(--blue-ink);
    }
    .tc__info app-icon { flex: none; margin-top: 1px; color: var(--blue); }
    .tc__info b { font-weight: 650; }
  `],
})
export class TripChangesComponent {
  protected readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  private readonly router = inject(Router);

  readonly trip = input.required<Trip>();
  readonly compact = input<boolean>(false);

  protected readonly cards = computed(() => {
    const all = changeCards(this.trip(), this.state.connect().minConnect ?? 60);
    return this.compact() ? all.filter(c => c.kind !== 'outsideCoverage') : all;
  });
  protected readonly visible = computed(() => this.cards().length > 0 || (!this.compact() && !!this.trips.scheduleNotice()));

  protected accept(changeId: string): void {
    this.trips.acceptChange(this.trip().id, changeId);
  }

  protected keep(changeId: string): void {
    this.trips.keepChange(this.trip().id, changeId);
  }

  protected seeBackups(c: ChangeCard): void {
    const q = c.backups === 'return' ? tripQuery('return') : tripQuery('plan', c.legId);
    void this.router.navigate(tripPath(this.trip().id), {
      queryParams: { tab: null, leg: null, ...q }, queryParamsHandling: 'merge', replaceUrl: true,
    });
  }
}
