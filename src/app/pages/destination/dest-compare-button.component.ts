import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { t } from '../../i18n/t';
import { AppStateService } from '../../state/app-state.service';
import { DestPickerComponent } from '../../ui/dest-picker.component';
import { findDestination } from '../../utils/airports';
import { compareParam } from '../compare/compare-model';

/**
 * "Compare" on the destination page: opens a small picker to choose a second
 * destination, then goes to /compare?c=THIS,OTHER (keeping hub, week and day).
 */
@Component({
  selector: 'app-dest-compare-button',
  standalone: true,
  imports: [IconComponent, DestPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="ui-btn ui-btn--ghost b" data-compare [attr.aria-expanded]="open()"
            [attr.aria-label]="t('compare.buttonAria', { city: city() })" (click)="open.set(!open())">
      <app-icon name="swap" [size]="18" />{{ t('compare.button') }}</button>
    @if (open()) {
      <app-dest-picker class="pick" [heading]="t('compare.pickTitle', { city: city() })" [exclude]="[code()]"
                       (picked)="go($event)" (closed)="open.set(false)" />
    }
  `,
  styles: [`
    :host { display: block; }
    .b { width: 100%; }
    .pick { margin-top: 8px; }
  `],
})
export class DestCompareButtonComponent {
  protected readonly t = t;
  readonly code = input.required<string>();

  private readonly state = inject(AppStateService);
  private readonly router = inject(Router);

  protected readonly open = signal(false);
  protected readonly city = computed(() => findDestination(this.code())?.city ?? this.code());

  protected go(other: string): void {
    this.open.set(false);
    void this.router.navigate(['/compare'], { queryParams: { ...this.state.globalParams(), c: compareParam([this.code(), other]) } });
  }
}
