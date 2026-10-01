import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formatKey } from '../../utils/time';
import { OUTCOME_LABEL, Outcome } from '../model';
import { TripsService } from '../trips.service';

export interface HistoryRoute {
  key: string;
  /** 'YUL → LHR'. */
  route: string;
  /** 'Boarded 3 of 4 recorded' (Didn't try is not counted). */
  summary: string;
  /** 'Some of us 1' when any; '' otherwise. */
  some: string;
  /** "Didn't try 2" when any; '' otherwise. */
  skipped: string;
  records: { id: string; text: string }[];
}

/**
 * Standby history per route, as counts (never percentages). Everyone and
 * Some of us both count as boarded; Didn't try is left out of the total.
 */
export function historyRoutes(outcomes: readonly Outcome[]): HistoryRoute[] {
  const groups = new Map<string, Outcome[]>();
  for (const o of outcomes) {
    const k = `${o.origin}-${o.dest}`;
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const tried = list.filter(o => o.kind !== 'didntTry');
      const boarded = tried.filter(o => o.kind === 'allBoarded' || o.kind === 'someBoarded').length;
      const some = list.filter(o => o.kind === 'someBoarded').length;
      const skipped = list.length - tried.length;
      const sorted = [...list].sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.recordedAt.localeCompare(a.recordedAt));
      return {
        key,
        route: `${list[0].origin} → ${list[0].dest}`,
        summary: tried.length ? `Boarded ${boarded} of ${tried.length} recorded` : 'No tries recorded',
        some: some ? `Some of us ${some}` : '',
        skipped: skipped ? `Didn't try ${skipped}` : '',
        records: sorted.map(o => ({
          id: o.id,
          text: `${o.flightNumber} · ${formatKey(o.dateKey, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')} · ${OUTCOME_LABEL[o.kind]}`,
        })),
        last: sorted[0].dateKey,
      };
    })
    .sort((a, b) => b.last.localeCompare(a.last))
    .map(({ last: _l, ...r }) => r);
}

/**
 * Settings "Standby history": per route, "YUL → LHR · Boarded 3 of 4
 * recorded", with every record listed under it and a delete for each. Kept
 * on this device; exported with Trips.
 */
@Component({
  selector: 'app-settings-history',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="grp" data-settings-history>
      <p class="ui-label">Standby history</p>
      @for (r of routes(); track r.key) {
        <details class="rt" data-route>
          <summary class="rt__s">
            <span class="rt__m">
              <b class="tn">{{ r.route }}</b>
              <span class="tn" data-summary>{{ r.summary }}@if (r.some) {<span> · {{ r.some }}</span>}@if (r.skipped) {<span> · {{ r.skipped }}</span>}</span>
            </span>
            <span class="chev" aria-hidden="true">›</span>
          </summary>
          <ul class="rec">
            @for (x of r.records; track x.id) {
              <li>
                <span class="tn">{{ x.text }}</span>
                <button type="button" class="rec__rm" [attr.aria-label]="'Delete ' + x.text" (click)="trips.removeOutcome(x.id)">Delete</button>
              </li>
            }
          </ul>
        </details>
      } @empty {
        <p class="hint" data-empty>After a flight, the app asks how it went. Your answers show here as counts per route.</p>
      }
      <p class="hint">Kept on this device. Export from Trips.</p>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .grp { display: grid; gap: 10px; padding: 14px 16px; border-radius: 18px; background: var(--fill); }
    .hint { margin: 0; font-size: 13px; color: var(--ink-2); }
    .rt { background: var(--surface); border-radius: 12px; }
    .rt__s { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 8px 12px; cursor: pointer; list-style: none; }
    .rt__s::-webkit-details-marker { display: none; }
    .rt__m { display: grid; gap: 1px; min-width: 0; }
    .rt__m b { font-size: 14.5px; font-weight: 650; }
    .rt__m > span { font-size: 13px; color: var(--ink-2); }
    .chev { color: var(--ink-3); font-size: 18px; transition: transform var(--dur-fast) var(--ease-out); }
    .rt[open] .chev { transform: rotate(90deg); }
    .rec { list-style: none; margin: 0; padding: 0 12px 6px; }
    .rec li { display: flex; align-items: center; justify-content: space-between; gap: 10px; border-top: 1px solid var(--hair); font-size: 13px; color: var(--ink-2); }
    .rec__rm { min-height: 40px; padding: 0 6px; color: var(--red-ink); font-size: 13px; font-weight: 600; cursor: pointer; }
  `],
})
export class SettingsHistoryComponent {
  protected readonly trips = inject(TripsService);
  protected readonly routes = computed(() => historyRoutes(this.trips.outcomes()));
}
