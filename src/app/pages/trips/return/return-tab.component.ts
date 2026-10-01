import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../../components/shared/icons.component';
import { AppStateService } from '../../../state/app-state.service';
import { hubDisplayName } from '../../../ui/format';
import type { Trip } from '../../../trips/model';
import { TripsService } from '../../../trips/trips.service';
import { ProvenanceTagComponent } from '../../../trips/ui/provenance-tag.component';
import { GlassSheetComponent } from '../../../ui/glass-sheet.component';
import { DestPhotoComponent } from '../../../ui/dest-photo.component';
import { destPath } from '../../../ui/links';
import type { Itinerary } from '../../../utils/connections';
import { WEEKDAY_SHORT, isDateKey, weekdayIndex } from '../../../utils/time';
import { MissChainComponent } from './miss-chain.component';
import { buildReturnView, triesLabel } from './return-model';

/** Parses a datetime-local value ('2026-10-13T22:00') into a homeBy, or null. */
export function parseDeadline(value: string): { dateKey: string; hhmm: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value.trim());
  if (!m || !isDateKey(m[1])) return null;
  const [h, min] = m[2].split(':').map(Number);
  if (h > 23 || min > 59) return null;
  return { dateKey: m[1], hhmm: m[2] };
}

/**
 * Return tab of a trip (mockup g3): the deadline with Change, the tries
 * counts if you fly on the return day or start the day before, the miss-one
 * chain for the return day, a note on what starting a day earlier adds, and
 * other airports near the goal with flights home.
 */
@Component({
  selector: 'app-return-tab',
  standalone: true,
  imports: [RouterLink, IconComponent, ProvenanceTagComponent, GlassSheetComponent, DestPhotoComponent, MissChainComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let v = view();
    <div class="rt">
      <header class="rt__ctx">
        <h2 class="ui-h3">Getting home</h2>
        <p class="ui-sub tn" data-context>{{ v.context }}</p>
      </header>

      <section class="ui-card rt__card" aria-label="Deadline">
        <div class="ui-label">Deadline</div>
        <div class="rt__dl">
          <span class="ui-h3 tn" data-deadline>{{ v.deadline }}</span>
          <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm rt__chg" data-change
                  [disabled]="trips.readOnly()" (click)="openSheet()">Change</button>
        </div>
        @if (v.gateway) {
          <div class="rt__stats tn">
            <div class="rt__stat" data-fly><b>{{ tries(v.flyTries) }}</b><small>if you fly {{ wd(v.flyKey) }}</small></div>
            @if (v.startKey && v.startTries !== null) {
              <div class="rt__stat" data-start><b>{{ tries(v.startTries) }}</b><small>if you start {{ wd(v.startKey) }}</small></div>
            }
          </div>
          @if (!v.covered) {
            <p class="rt__unk" data-unknown><app-provenance-tag value="unknown" />
              <span>Some of these days aren't in the published schedules yet, so there may be more tries.</span></p>
          }
        }
      </section>

      @if (v.gateway) {
        <div class="ui-sec-h rt__h">
          <h3 class="ui-h3">{{ v.chainTitle }}</h3>
          <app-provenance-tag [value]="v.covered ? 'scheduled' : 'unknown'" />
        </div>
        <section class="ui-card rt__card" data-chain>
          <app-miss-chain [steps]="v.steps" [actionLabel]="v.hasReturn || trips.readOnly() ? null : 'Use as return'"
                          (pick)="useAsReturn($event)" />
        </section>

        @if (v.info) {
          <p class="note note--blue" data-info><app-icon name="info" [size]="16" /><span>{{ v.info }}</span></p>
        }

        @if (v.others.length) {
          <div class="ui-sec-h rt__h"><h3 class="ui-h3">Other airports home</h3></div>
          <section class="ui-card rt__others">
            @for (o of v.others; track o.code) {
              <a class="rt__row" [routerLink]="destLink(o.code)" [queryParams]="state.globalParams()" [attr.data-other]="o.code">
                <app-dest-photo class="rt__th" [code]="o.code" size="thumb" />
                <span class="rt__rt">
                  <span class="rt__nm"><b>{{ o.city }}</b>&ngsp;<span class="rt__code">{{ o.code }}</span></span>
                  <span class="ui-visually-hidden"> · </span><span class="rt__m tn">{{ o.text }}</span>
                </span>
                <app-icon class="rt__chev" name="chevron-right" [size]="16" />
              </a>
            }
          </section>
        }
      } @else {
        <p class="note" data-nogw><app-icon name="info" [size]="16" />
          <span>No airport near {{ trip().goal.name }} was found in our schedule data, so there are no flights home to count.</span></p>
      }
    </div>

    @if (sheetOpen()) {
      <app-glass-sheet title="Home by" [open]="true" (closed)="sheetOpen.set(false)">
        <form class="ds" (submit)="$event.preventDefault(); saveDeadline()">
          <label class="ds__f">
            <span class="ui-label">Deadline</span>
            <input type="datetime-local" class="ds__in" data-deadline-input [value]="draft()" [min]="minValue()"
                   (input)="draft.set($any($event.target).value)" required>
          </label>
          <p class="ui-sub ds__hint">Local time in {{ homeName() }} ({{ trip().homeAirport }}). Tries count flights that land by then.</p>
          <button type="submit" class="ui-btn ui-btn--dark ui-btn--block" data-save [disabled]="!parsed()">Save</button>
        </form>
      </app-glass-sheet>
    }
  `,
  styles: [`
    :host { display: block; }
    .rt { display: grid; gap: 12px; }
    .rt__ctx { padding: 2px 2px 0; }
    .rt__ctx p { margin-top: 1px; font-size: 12.5px; }
    .rt__card { padding: 16px; }
    .rt__dl { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 2px; }
    .rt__chg { flex: none; min-height: 40px; }
    .rt__stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
    .rt__stat { background: var(--fill); border-radius: 14px; padding: 11px 12px; min-width: 0; }
    .rt__stat b { display: block; font-size: 20px; font-weight: 650; letter-spacing: -.02em; }
    .rt__stat small { display: block; font-size: 11.5px; color: var(--ink-2); margin-top: 2px; }
    .rt__unk { display: flex; gap: 8px; align-items: flex-start; margin-top: 10px; font-size: 12.5px; color: var(--ink-2); }
    .rt__unk app-provenance-tag { flex: none; }
    .rt__h { margin: 10px 2px 0; align-items: center; }
    .note { display: flex; gap: 10px; align-items: flex-start; padding: 11px 12px; border-radius: 14px; font-size: 13px;
            background: var(--fill); color: var(--ink-2); line-height: 1.45; }
    .note app-icon { flex: none; margin-top: 1px; }
    .note--blue { background: color-mix(in srgb, var(--blue) 11%, transparent); color: var(--blue-ink); }
    .note--blue app-icon { color: var(--blue); }
    .rt__others { padding: 4px 14px; }
    .rt__row { display: flex; align-items: center; gap: 12px; padding: 10px 0; min-height: 44px; color: var(--ink); }
    .rt__row + .rt__row { border-top: 1px solid var(--hair); }
    .rt__row:hover b { color: var(--blue); }
    .rt__rt { flex: 1; min-width: 0; display: block; }
    .rt__nm { font-size: 14px; }
    .rt__nm b { font-weight: 650; }
    .rt__code { font-size: 12px; color: var(--ink-3); font-weight: 600; }
    .rt__m { display: block; font-size: 12.5px; color: var(--ink-2); margin-top: 1px; line-height: 1.4; }
    .rt__chev { flex: none; color: var(--ink-3); }
    .ds { display: grid; gap: 12px; }
    .ds__f { display: grid; gap: 6px; }
    .ds__in {
      height: 48px; border-radius: 12px; border: 1px solid var(--hair); background: var(--fill); color: var(--ink);
      padding: 0 12px; font: inherit; font-size: 15px; min-width: 0; width: 100%;
    }
    .ds__in:focus { outline: 2px solid var(--blue); outline-offset: 1px; }
    .ds__hint { font-size: 12.5px; }
  `],
})
export class ReturnTabComponent {
  protected readonly state = inject(AppStateService);
  protected readonly trips = inject(TripsService);

  readonly trip = input.required<Trip>();

  protected readonly view = computed(() => buildReturnView(this.trip(), this.state.connect(), this.state.timeFormat()));
  protected readonly homeName = computed(() => hubDisplayName(this.trip().homeAirport));

  protected readonly sheetOpen = signal(false);
  protected readonly draft = signal('');
  protected readonly parsed = computed(() => {
    const p = parseDeadline(this.draft());
    return p && p.dateKey >= this.trip().outboundDate ? p : null;
  });
  protected readonly minValue = computed(() => `${this.trip().outboundDate}T00:00`);

  protected tries(n: number): string {
    return triesLabel(n);
  }

  protected wd(key: string): string {
    return WEEKDAY_SHORT[weekdayIndex(key)];
  }

  protected destLink(code: string): string[] {
    return destPath(code);
  }

  protected openSheet(): void {
    const t = this.trip();
    this.draft.set(`${t.homeBy.dateKey}T${t.homeBy.hhmm}`);
    this.sheetOpen.set(true);
  }

  protected saveDeadline(): void {
    const homeBy = this.parsed();
    if (!homeBy) return;
    this.trips.update(this.trip().id, t => ({ ...t, homeBy }));
    this.sheetOpen.set(false);
  }

  protected useAsReturn(it: Itinerary): void {
    const t = this.trip();
    const legId = this.trips.addFlightLeg(t.id, it, 'return');
    if (!legId) return;
    const num = it.legs.map(l => l.flightNumber).filter(Boolean).join(' + ');
    this.state.flash(`Added ${num} as your return · Listing is still your step`, {
      label: 'Undo',
      run: () => this.trips.update(t.id, cur => ({ ...cur, legs: cur.legs.filter(l => l.id !== legId) })),
    });
  }
}
