import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { TravelProfile, TripLength, TripStyle } from '../recs/model';
import { TRIP_STYLES } from '../recs/profile';
import { ProfileService } from '../recs/profile.service';
import { AppStateService } from '../state/app-state.service';
import { DAY_LETTERS, LENGTH_OPTIONS, toggled } from '../recs/profile-options';
import { GlassSheetComponent } from '../ui/glass-sheet.component';
import { HubPickerComponent } from '../ui/hub-picker.component';
import { SegComponent } from '../ui/seg.component';
import { WEEKDAY_LONG } from '../utils/time';

/**
 * One-time, skippable 3-step setup: home airport, how you like to travel
 * (saved to the travel profile on this phone) and a note that the app works
 * offline. Rendered with @if; emits (closed) when finished or skipped.
 */
@Component({
  selector: 'app-onboarding-sheet',
  standalone: true,
  imports: [GlassSheetComponent, HubPickerComponent, SegComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-glass-sheet title="Welcome" [open]="true" (closed)="done()">
      <p class="ob__step tn" data-step>Step {{ step() }} of 3</p>
      @switch (step()) {
        @case (1) {
          <h3 class="ob__h">Where do you usually fly from?</h3>
          <p class="ob__p">We show every Air Canada flight from your home airport.</p>
          <app-hub-picker size="lg" [hub]="state.hub()" (hubChange)="state.setHub($event)" />
        }
        @case (2) {
          <h3 class="ob__h">How do you like to travel?</h3>
          <p class="ob__p">Optional. This only helps pick suggestions and stays on this phone.</p>
          <div class="ob__chips" role="group" aria-label="I like">
            @for (s of styles; track s) {
              <button type="button" class="pick" [class.on]="picked().includes(s)" [attr.aria-pressed]="picked().includes(s)"
                      [attr.data-style]="s" (click)="picked.set(toggle(picked(), s))">{{ s }}</button>
            }
          </div>
          <app-seg stretch ariaLabel="Usual trip length" data-length [options]="lengthOptions"
                   [value]="length() ?? ''" (valueChange)="setLength($event)" />
          <p class="ob__lbl" id="ob-days">Days I can usually leave or come back</p>
          <div class="dow" role="group" aria-labelledby="ob-days">
            @for (l of dayLetters; track $index) {
              <button type="button" [class.on]="days().includes($index + 1)" [attr.aria-pressed]="days().includes($index + 1)"
                      [attr.aria-label]="dayNames[$index]" [attr.data-day]="$index + 1"
                      (click)="days.set(toggle(days(), $index + 1))">{{ l }}</button>
            }
          </div>
        }
        @default {
          <h3 class="ob__h">Works offline</h3>
          <p class="ob__p">Schedules, your trips and boarding passes are saved on this phone, so they open without a signal.</p>
          <p class="ob__p">Add it to your Home Screen to open it like an app: in your browser's share or menu, choose Add to Home Screen.</p>
        }
      }
      <div class="ob__row">
        <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" data-skip (click)="done()">{{ step() === 3 ? 'Close' : 'Skip' }}</button>
        <button type="button" class="ui-btn ui-btn--sm" data-next (click)="next()">{{ step() === 3 ? 'Done' : 'Next' }}</button>
      </div>
    </app-glass-sheet>
  `,
  styles: [`
    .ob__step { margin: 0 0 4px; font-size: 12px; color: var(--ink-3); }
    .ob__h { margin: 0 0 6px; font-size: 18px; font-weight: 650; }
    .ob__p { margin: 0 0 12px; font-size: 14px; color: var(--ink-2); line-height: 1.45; }
    .ob__lbl { margin: 16px 0 8px; font-size: 13px; font-weight: 650; }
    .ob__chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .pick {
      min-height: 44px; padding: 0 16px; border-radius: 999px; font-size: 14px; font-weight: 600;
      background: var(--fill); color: var(--ink); cursor: pointer;
    }
    .pick.on { background: var(--ink); color: var(--bg); }
    .dow { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px; }
    .dow button {
      height: 44px; border-radius: 11px; display: grid; place-items: center; font-weight: 650; font-size: 13px;
      background: var(--fill); color: var(--ink-2); cursor: pointer;
    }
    .dow button.on { background: color-mix(in srgb, var(--blue) 15%, transparent); color: var(--blue-ink); box-shadow: inset 0 0 0 1.5px var(--blue); }
    .ob__row { display: flex; justify-content: space-between; gap: 8px; margin-top: 20px; }
    .ob__row .ui-btn { min-height: 44px; }
  `],
})
export class OnboardingSheetComponent {
  protected readonly state = inject(AppStateService);
  private readonly profile = inject(ProfileService);
  readonly closed = output<void>();

  protected readonly step = signal(1);
  protected readonly styles = TRIP_STYLES;
  protected readonly lengthOptions = LENGTH_OPTIONS;
  protected readonly dayLetters = DAY_LETTERS;
  protected readonly dayNames = WEEKDAY_LONG;
  protected readonly picked = signal<TripStyle[]>([]);
  protected readonly length = signal<TripLength | null>(null);
  protected readonly days = signal<number[]>([]);
  protected readonly toggle = toggled;

  protected setLength(v: string | null | undefined): void {
    this.length.set(v === 'day' || v === 'weekend' || v === 'week' ? v : null);
  }

  protected next(): void {
    if (this.step() === 2) this.saveProfile();
    if (this.step() >= 3) this.done();
    else this.step.update(s => s + 1);
  }

  protected done(): void {
    this.saveProfile();
    this.closed.emit();
  }

  /** Writes the profile only when something was picked, so skipping leaves it "Not set up". */
  private saveProfile(): void {
    const patch: Partial<Omit<TravelProfile, 'v' | 'updatedAt'>> = {};
    if (this.picked().length) patch.styles = this.picked();
    if (this.length()) patch.length = this.length();
    if (this.days().length) patch.days = this.days();
    if (Object.keys(patch).length) this.profile.update(patch);
  }
}
