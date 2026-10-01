import { ChangeDetectionStrategy, booleanAttribute, Component, computed, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Params, RouterLink } from '@angular/router';
import { AppStateService } from '../state/app-state.service';
import { findDestination } from '../utils/airports';
import { DestPhotoComponent } from './dest-photo.component';

/**
 * Photo card (`.pcard`): photo with a bottom gradient, an optional glass
 * badge top-left and a glass bar with the title and meta.
 *
 *   <app-photo-card code="LIS" meta="Portugal · 6h35 · 6× wk" badge="Tonight 21:45"
 *                   [link]="destPath('LIS')" />                       (pick: 3:4)
 *   <app-photo-card code="CUN" variant="wide" [height]="250" bigCode badge="Today · 08:40">
 *     <div footer>✈ Nonstop  ◷ Daily</div>
 *   </app-photo-card>
 */
@Component({
  selector: 'app-photo-card',
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet, DestPhotoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': "'is-' + variant()",
    '[style.height.px]': "variant() === 'wide' ? height() : null",
  },
  template: `
    <ng-template #body>
      <app-dest-photo class="ph" [code]="code()" size="card" />
      @if (badge()) { <span class="bdg ui-glass-photo ui-glass-photo--badge tn">{{ badge() }}</span> }
      <div class="glassbar ui-glass-photo">
        <div class="gb-row">
          <div class="gb-tx">
            <div class="t">{{ displayTitle() }}</div>
            @if (meta()) { <div class="m tn">{{ meta() }}</div> }
          </div>
          @if (bigCode()) { <span class="code">{{ code() }}</span> }
        </div>
        <ng-content select="[footer]" />
      </div>
    </ng-template>
    @if (link(); as l) {
      <a class="pcard" [routerLink]="l" [queryParams]="params()" [attr.aria-label]="ariaLabel()">
        <ng-container [ngTemplateOutlet]="body" />
      </a>
    } @else {
      <div class="pcard"><ng-container [ngTemplateOutlet]="body" /></div>
    }
  `,
  styles: [`
    :host { display: block; flex: none; }
    .pcard {
      position: relative; display: block; overflow: hidden; isolation: isolate;
      border-radius: var(--radius-photo); background: var(--fill); color: #FFFFFF;
      aspect-ratio: 3 / 4; width: 100%;
    }
    :host(.is-wide) .pcard { aspect-ratio: auto; height: 100%; }
    .ph { position: absolute; inset: 0; z-index: -1; }
    .pcard::after {
      content: ''; position: absolute; inset: 0; z-index: 0; pointer-events: none;
      background: linear-gradient(180deg, rgba(0, 0, 0, .05) 50%, rgba(0, 0, 0, .6));
    }
    a.pcard:focus-visible { outline-offset: 3px; }
    a.pcard .ph { transition: transform .5s var(--ease-out); }
    a.pcard:hover .ph { transform: scale(1.03); }
    .bdg {
      position: absolute; top: 12px; left: 12px; z-index: 2;
      font-size: 11px; font-weight: 600; padding: 5px 10px; border-radius: 999px;
    }
    .glassbar {
      position: absolute; left: 10px; right: 10px; bottom: 10px; z-index: 2;
      border-radius: 16px; padding: 10px 12px;
    }
    .gb-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .gb-tx { min-width: 0; }
    .t { font-size: 18px; font-weight: 650; letter-spacing: -.01em; line-height: 1.25; }
    .m { font-size: 12px; opacity: .9; margin-top: 2px; }
    .code { font-family: var(--cond); font-size: 26px; font-weight: 600; line-height: 1; flex: none; }
    @media (max-width: 719px) {
      .m, .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    }
  `],
})
export class PhotoCardComponent {
  private readonly state = inject(AppStateService);

  readonly code = input.required<string>();
  /** Defaults to the destination's city. */
  readonly title = input<string | null>(null);
  readonly meta = input<string | null>(null);
  readonly badge = input<string | null>(null);
  readonly variant = input<'pick' | 'wide'>('pick');
  /** Height in px for the wide variant. */
  readonly height = input<number | null>(null);
  /** Condensed code on the right of the glass bar (Saved cards). */
  readonly bigCode = input(false, { transform: booleanAttribute });
  readonly link = input<string | readonly unknown[] | null>(null);
  readonly queryParams = input<Params | null | undefined>(undefined);

  protected readonly displayTitle = computed(() => this.title() ?? findDestination(this.code())?.city ?? this.code());
  protected readonly params = computed(() => this.queryParams() ?? this.state.globalParams());
  protected readonly ariaLabel = computed(() =>
    [this.displayTitle(), this.meta(), this.badge()].filter(Boolean).join(', '),
  );
}
