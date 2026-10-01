import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { IconComponent, type IconName } from '../../components/shared/icons.component';
import { GlassSheetComponent } from '../../ui/glass-sheet.component';

export type PlansChangedChoice = 'pick' | 'dates' | 'drop';

const CHOICES: { value: PlansChangedChoice; icon: IconName; title: string; detail: string }[] = [
  { value: 'pick', icon: 'retry', title: 'Pick another flight', detail: 'What you can still reach from here, starting now' },
  { value: 'dates', icon: 'calendar', title: 'Change dates', detail: 'Your home-by deadline and return tries' },
  { value: 'drop', icon: 'close', title: 'Drop this trip', detail: 'Moves it to Past trips. You can undo it.' },
];

/**
 * "Plans changed" on /today: pick another flight (recover), change dates
 * (the trip's Return tab) or drop the trip (archive, with Undo).
 *
 *   @if (open()) { <app-plans-changed-sheet (choose)="…" (closed)="open.set(false)" /> }
 */
@Component({
  selector: 'app-plans-changed-sheet',
  standalone: true,
  imports: [GlassSheetComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-glass-sheet title="Plans changed" [open]="true" (closed)="closed.emit()">
      <div class="pc">
        @for (c of choices; track c.value) {
          <button type="button" class="pc__row" [class.is-drop]="c.value === 'drop'" [attr.data-choice]="c.value" (click)="choose.emit(c.value)">
            <span class="pc__ic" aria-hidden="true"><app-icon [name]="c.icon" [size]="18" /></span>
            <span class="pc__txt"><b>{{ c.title }}</b><small>{{ c.detail }}</small></span>
            <app-icon class="pc__chev" name="chevron-right" [size]="16" />
          </button>
        }
      </div>
    </app-glass-sheet>
  `,
  styles: [`
    .pc { display: flex; flex-direction: column; }
    .pc__row {
      display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 10px 0; text-align: left;
      color: var(--ink); border-bottom: 1px solid var(--hair);
    }
    .pc__row:last-child { border-bottom: 0; }
    .pc__ic { flex: none; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--fill); color: var(--ink); }
    .pc__row.is-drop .pc__ic { color: var(--red-ink); }
    .pc__txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pc__txt b { font-size: 15px; font-weight: 600; }
    .pc__txt small { font-size: 12.5px; color: var(--ink-2); }
    .pc__chev { flex: none; color: var(--ink-3); }
  `],
})
export class PlansChangedSheetComponent {
  protected readonly choices = CHOICES;
  readonly choose = output<PlansChangedChoice>();
  readonly closed = output<void>();
}
