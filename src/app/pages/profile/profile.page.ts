import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { logbookPath } from '../../extras/links';
import { IconComponent } from '../../components/shared/icons.component';
import type { TravelProfile, TripLength, TripStyle } from '../../recs/model';
import { TRIP_STYLES } from '../../recs/profile';
import { ProfileService } from '../../recs/profile.service';
import { AppStateService } from '../../state/app-state.service';
import { SegComponent, SegOption } from '../../ui/seg.component';
import { WEEKDAY_LONG } from '../../utils/time';

export const LENGTH_OPTIONS: SegOption[] = [
  { value: 'day', label: 'Day trip' },
  { value: 'weekend', label: 'Long weekend' },
  { value: 'week', label: 'A week+' },
];
export const ONWARD_OPTIONS: SegOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'any', label: 'Any' },
];
export const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
/** Default slider position when "Any" is unticked. */
export const DEFAULT_MAX_HOURS = 7;

/** Toggle a value in a list (kept in its natural order by sanitizeProfile). */
export function toggled<T>(list: readonly T[], v: T): T[] {
  return list.includes(v) ? list.filter(x => x !== v) : [...list, v];
}

/**
 * Travel profile (/profile, mock x12): what you like, trip length, longest
 * flight, travellers, onward budget and the days you can usually travel.
 * Changes save immediately to this phone (localStorage 'ac.profile.v1').
 * Used only to pick suggestions; never in share links or backups.
 */
@Component({
  selector: 'app-profile-page',
  standalone: true,
  imports: [IconComponent, SegComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = profile.profile();
    <div class="ui-page ui-page--bare pf">
      <header class="pf__head">
        <button type="button" class="ui-circ ui-circ--glass" aria-label="Back" (click)="back()"><app-icon name="arrow-left" [size]="18" /></button>
        <h1 class="ui-h3">Travel profile</h1>
        <span class="pf__sp" aria-hidden="true"></span>
      </header>

      <h2 class="ui-label pf__lbl" id="pf-like">I like</h2>
      <div class="ui-card pf__card">
        <div class="chips" role="group" aria-labelledby="pf-like">
          @for (s of styles; track s) {
            <button type="button" class="pick" [class.on]="p.styles.includes(s)" [attr.aria-pressed]="p.styles.includes(s)"
                    [attr.data-style]="s" (click)="toggleStyle(s)">
              @if (p.styles.includes(s)) { <app-icon name="check" [size]="14" [strokeWidth]="2.6" /> }{{ s }}
            </button>
          }
        </div>
        <p class="hint">None picked means any kind of trip.</p>
      </div>

      <h2 class="ui-label pf__lbl">Usual trip</h2>
      <div class="ui-card pf__card">
        <div class="fl">
          <span class="fl__t" id="pf-len">Length</span>
          <app-seg stretch ariaLabel="Usual trip length" data-length [options]="lengthOptions"
                   [value]="p.length ?? 'weekend'" (valueChange)="setLength($event)" />
        </div>
        <div class="fl fl--gap">
          <div class="fl__row">
            <label class="fl__t" for="pf-max">Longest flight</label>
            <span class="fl__v tn" data-max-text>@if (p.maxFlightHours === null) { <b>Any length</b> } @else { Up to <b>{{ p.maxFlightHours }}h</b> }</span>
          </div>
          <input id="pf-max" type="range" min="1" max="12" step="1" class="range" data-max
                 [value]="p.maxFlightHours ?? sliderDefault" [disabled]="p.maxFlightHours === null"
                 [style.--pct]="pct(p.maxFlightHours ?? sliderDefault)"
                 [attr.aria-valuetext]="p.maxFlightHours === null ? 'Any length' : 'Up to ' + p.maxFlightHours + ' hours'"
                 (input)="setMax($event)">
          <div class="ticks tn" aria-hidden="true"><span>1h</span><span>6h</span><span>12h</span></div>
          <label class="ck" for="pf-any">
            <input id="pf-any" type="checkbox" data-any [checked]="p.maxFlightHours === null" (change)="setAny($event)">
            <span>Any length</span>
          </label>
        </div>
      </div>

      <div class="ui-card pf__card pf__card--rows">
        <div class="srow">
          <div class="srow__tx"><span class="fl__t" id="pf-party">Travellers</span>
            <span class="hint">Used to prefer days with more departures, never to guess seats.</span></div>
          <div class="stepper" role="group" aria-labelledby="pf-party">
            <button type="button" aria-label="Fewer travellers" data-party-minus [disabled]="p.party <= 1" (click)="setParty(p.party - 1)">−</button>
            <b class="tn" aria-live="polite" data-party>{{ p.party }}</b>
            <button type="button" aria-label="More travellers" data-party-plus [disabled]="p.party >= 9" (click)="setParty(p.party + 1)">+</button>
          </div>
        </div>
        <div class="srow srow--col">
          <div class="srow__line">
            <span class="fl__t">Onward travel budget</span>
            <app-seg class="onw" ariaLabel="Onward travel budget" data-onward [options]="onwardOptions"
                     [value]="p.onwardBudget" (valueChange)="setOnward($event)" />
          </div>
          <span class="hint">Any lets ideas include a train or bus past the airport.</span>
        </div>
      </div>

      <h2 class="ui-label pf__lbl" id="pf-days">Days I can usually leave or come back</h2>
      <div class="ui-card pf__card">
        <div class="dow" role="group" aria-labelledby="pf-days">
          @for (l of dayLetters; track $index) {
            <button type="button" [class.on]="p.days.includes($index + 1)" [attr.aria-pressed]="p.days.includes($index + 1)"
                    [attr.aria-label]="dayNames[$index]" [attr.data-day]="$index + 1" (click)="toggleDay($index + 1)">{{ l }}</button>
          }
        </div>
        <p class="hint">Mondays that are holidays count too.@if (!p.days.length) { None picked means any day. }</p>
      </div>

      <p class="note"><app-icon name="lock" [size]="16" />
        <span>Stays on this phone. Used only to pick suggestions. Not in share links.</span></p>

      <button type="button" class="lb" data-logbook (click)="openLogbook()">
        <span>Your logbook</span><span aria-hidden="true">›</span>
      </button>

      <div class="reset">
        @if (confirming()) {
          <span class="reset__q">Reset your travel profile?</span>
          <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" data-reset-cancel (click)="confirming.set(false)">Cancel</button>
          <button type="button" class="ui-btn ui-btn--sm" data-reset-yes (click)="reset()">Reset</button>
        } @else {
          <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm reset__b" data-reset [disabled]="profile.isEmpty()"
                  (click)="confirming.set(true)">Reset profile</button>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pf { max-width: 600px; margin-inline: auto; display: flex; flex-direction: column; }
    .pf__head { display: grid; grid-template-columns: 40px 1fr 40px; align-items: center; gap: 12px; margin-bottom: 4px; }
    .pf__head h1 { margin: 0; text-align: center; }
    .pf__lbl { margin: 18px 4px 8px; font-size: 10.5px; }
    .pf__card { padding: 16px; margin-top: 0; }
    .pf__card + .pf__card { margin-top: 12px; }
    .pf__card--rows { padding: 4px 16px; }
    .hint { margin: 8px 0 0; font-size: 12.5px; color: var(--ink-2); }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .pick {
      display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 16px; border-radius: 999px;
      font-size: 14px; font-weight: 600; background: var(--fill); color: var(--ink); cursor: pointer;
      transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
    }
    .pick.on { background: var(--ink); color: var(--bg); }
    .fl { display: grid; gap: 8px; }
    .fl--gap { margin-top: 16px; gap: 4px; }
    .fl__t { font-weight: 650; font-size: 14px; }
    .fl__row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .fl__v { font-size: 14px; color: var(--ink-2); }
    .fl__v b { color: var(--ink); font-weight: 650; }
    .range {
      --pct: 50%;
      -webkit-appearance: none; appearance: none; width: 100%; height: 30px; margin: 4px 0 0; background: none; cursor: pointer;
    }
    .range:disabled { opacity: .45; cursor: default; }
    .range::-webkit-slider-runnable-track {
      height: 4px; border-radius: 2px;
      background: linear-gradient(to right, var(--blue) 0 var(--pct), var(--fill) var(--pct) 100%);
    }
    .range::-moz-range-track { height: 4px; border-radius: 2px; background: var(--fill); }
    .range::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--blue); }
    .range::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none; width: 26px; height: 26px; margin-top: -11px; border-radius: 50%;
      background: var(--surface); box-shadow: 0 1px 4px rgba(0, 0, 0, .25), inset 0 0 0 1px var(--hair);
    }
    .range::-moz-range-thumb {
      width: 26px; height: 26px; border: 0; border-radius: 50%;
      background: var(--surface); box-shadow: 0 1px 4px rgba(0, 0, 0, .25), inset 0 0 0 1px var(--hair);
    }
    .range:focus-visible { outline: none; }
    .range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 40%, transparent), 0 1px 4px rgba(0, 0, 0, .25); }
    .ticks { display: flex; justify-content: space-between; font-size: 11px; color: var(--ink-3); }
    .ck { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; font-size: 14px; color: var(--ink); cursor: pointer; justify-self: start; }
    .ck input { width: 18px; height: 18px; margin: 0; accent-color: var(--blue); }
    .srow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--hair); }
    .srow:last-child { border-bottom: 0; }
    .srow--col { display: grid; gap: 0; }
    .srow__tx { display: grid; min-width: 0; }
    .srow__tx .hint { margin-top: 2px; }
    .srow__line { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .stepper { display: flex; align-items: center; gap: 2px; background: var(--fill); border-radius: 12px; padding: 2px; flex: none; }
    .stepper button {
      width: 44px; height: 40px; display: grid; place-items: center; font-weight: 700; font-size: 18px; color: var(--ink);
      border-radius: 10px; cursor: pointer;
    }
    .stepper button:disabled { color: var(--ink-3); cursor: default; }
    .stepper b { min-width: 22px; text-align: center; font-weight: 650; }
    .onw { width: 128px; flex: none; }
    .onw ::ng-deep .seg__b { flex: 1; min-height: 38px; }
    .dow { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px; }
    .dow button {
      height: 44px; border-radius: 11px; display: grid; place-items: center; font-weight: 650; font-size: 13px;
      background: var(--fill); color: var(--ink-2); cursor: pointer;
    }
    .dow button.on { background: color-mix(in srgb, var(--blue) 15%, transparent); color: var(--blue-ink); box-shadow: inset 0 0 0 1.5px var(--blue); }
    .note {
      display: flex; gap: 10px; align-items: flex-start; padding: 11px 12px; border-radius: 14px; font-size: 12.5px; margin: 16px 0 0;
      background: color-mix(in srgb, var(--blue) 10%, transparent); color: var(--blue-ink);
    }
    .note app-icon { color: var(--blue); flex: none; margin-top: 1px; }
    .lb {
      display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; margin-top: 10px;
      font-size: 13.5px; font-weight: 600; color: var(--blue-ink); cursor: pointer;
    }
    .reset { display: flex; justify-content: center; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 14px; min-height: 44px; }
    .reset__b { color: var(--red-ink); min-height: 44px; }
    .reset__q { font-size: 13.5px; color: var(--ink-2); width: 100%; text-align: center; }
    .reset .ui-btn { min-height: 44px; }
    @media (min-width: 720px) {
      .pf { padding-top: 24px; }
    }
  `],
})
export class ProfilePage {
  protected readonly profile = inject(ProfileService);
  private readonly state = inject(AppStateService);
  private readonly router = inject(Router);

  protected readonly styles = TRIP_STYLES;
  protected readonly lengthOptions = LENGTH_OPTIONS;
  protected readonly onwardOptions = ONWARD_OPTIONS;
  protected readonly dayLetters = DAY_LETTERS;
  protected readonly dayNames = WEEKDAY_LONG;
  protected readonly sliderDefault = DEFAULT_MAX_HOURS;
  protected readonly confirming = signal(false);
  private readonly p = computed(() => this.profile.profile());

  protected pct(h: number): string {
    return `${((h - 1) / 11) * 100}%`;
  }

  private save(patch: Partial<Omit<TravelProfile, 'v' | 'updatedAt'>>): void {
    this.profile.update(patch);
  }

  protected toggleStyle(s: TripStyle): void {
    this.save({ styles: toggled(this.p().styles, s) });
  }

  protected setLength(v: string | null | undefined): void {
    if (v === 'day' || v === 'weekend' || v === 'week') this.save({ length: v as TripLength });
  }

  protected setMax(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(v)) this.save({ maxFlightHours: v });
  }

  protected setAny(e: Event): void {
    this.save({ maxFlightHours: (e.target as HTMLInputElement).checked ? null : DEFAULT_MAX_HOURS });
  }

  protected setParty(n: number): void {
    this.save({ party: Math.min(9, Math.max(1, n)) });
  }

  protected setOnward(v: string | null | undefined): void {
    if (v === 'low' || v === 'any') this.save({ onwardBudget: v });
  }

  protected toggleDay(d: number): void {
    this.save({ days: toggled(this.p().days, d) });
  }

  protected reset(): void {
    this.profile.reset();
    this.confirming.set(false);
    this.state.flash('Travel profile reset');
  }

  protected openLogbook(): void {
    void this.router.navigate(logbookPath(), { queryParams: this.state.globalParams() });
  }

  protected back(): void {
    this.state.goBack(['/']);
  }
}
