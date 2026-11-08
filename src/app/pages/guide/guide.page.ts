import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { t, type MsgKey } from '../../i18n/t';
import { AppStateService } from '../../state/app-state.service';

const key = (k: string): MsgKey => k as MsgKey;

/** Sections: heading key prefix and how many paragraphs it has. */
export const GUIDE_SECTIONS: readonly { id: string; paras: number }[] = [
  { id: 's1', paras: 3 },
  { id: 's2', paras: 3 },
  { id: 's3', paras: 4 },
  { id: 's4', paras: 3 },
  { id: 's5', paras: 2 },
];

export const GUIDE_TERMS = ['standby', 'nonrev', 'listing', 'load', 'priority', 'positive', 'zed', 'jumpseat', 'entry', 'checkin'] as const;

/**
 * Pass-rider guide (/guide): general, friendly standby advice for companions
 * and buddy-pass riders. No airline-specific rules, fees or links to internal portals.
 */
@Component({
  selector: 'app-guide-page',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page gd">
      <header class="gd__top">
        <button type="button" class="ui-circ ui-circ--glass" [attr.aria-label]="t('guide.back')" (click)="state.goBack(['/'])">
          <app-icon name="arrow-left" [size]="18" />
        </button>
        <h1 class="ui-h1 gd__h">{{ t('guide.title') }}</h1>
      </header>
      <p class="ui-sub">{{ t('guide.intro') }}</p>

      @for (s of sections; track s.id) {
        <section class="ui-card gd__sec" [attr.aria-labelledby]="'gd-' + s.id">
          <h2 class="ui-h3" [id]="'gd-' + s.id">{{ t(k('guide.' + s.id + '.h')) }}</h2>
          <ul>
            @for (n of range(s.paras); track n) {
              <li>{{ t(k('guide.' + s.id + '.p' + n)) }}</li>
            }
          </ul>
          @if (s.id === 's5') {
            <a class="ui-link" routerLink="/" [queryParams]="state.globalParams()">{{ t('guide.s5.cta') }}</a>
          }
        </section>
      }

      <section class="ui-card gd__sec" aria-labelledby="gd-g">
        <h2 class="ui-h3" id="gd-g">{{ t('guide.g.h') }}</h2>
        <dl>
          @for (g of terms; track g) {
            <dt>{{ t(k('guide.g.' + g + '.t')) }}</dt>
            <dd>{{ t(k('guide.g.' + g + '.d')) }}</dd>
          }
        </dl>
      </section>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .gd { max-width: 640px; margin-inline: auto; display: flex; flex-direction: column; gap: 12px; }
    .gd__top { display: flex; align-items: center; gap: 12px; }
    .gd__h { font-size: 26px; margin: 0; }
    .gd__sec { padding: 16px 18px; display: grid; gap: 10px; }
    .gd__sec h2 { margin: 0; }
    ul { margin: 0; padding-left: 20px; display: grid; gap: 6px; font-size: 14.5px; line-height: 1.45; color: var(--ink); }
    dl { margin: 0; display: grid; gap: 4px; }
    dt { font-weight: 600; margin-top: 8px; }
    dd { margin: 0; font-size: 14px; line-height: 1.45; color: var(--ink-2); }
    .ui-link { min-height: 44px; display: inline-flex; align-items: center; }
    @media (min-width: 720px) { .gd { padding-top: 28px; } }
  `],
})
export class GuidePage {
  protected readonly t = t;
  protected readonly k = key;
  protected readonly state = inject(AppStateService);
  protected readonly sections = GUIDE_SECTIONS;
  protected readonly terms = GUIDE_TERMS;
  protected range(n: number): number[] {
    return Array.from({ length: n }, (_, i) => i + 1);
  }
}
