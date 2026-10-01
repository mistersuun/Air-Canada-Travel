import { ChangeDetectionStrategy, booleanAttribute, Component, computed, inject, input, linkedSignal } from '@angular/core';
import { findDestination } from '../utils/airports';
import { regionVar } from '../utils/region-color';
import { PhotoService } from '../state/photo.service';

export type DestPhotoSize = 'thumb' | 'card' | 'hero';

const SIZES: Record<DestPhotoSize, string> = {
  thumb: '44px',
  card: '(max-width: 719px) 60vw, 320px',
  hero: '100vw',
};

/**
 * A destination's photo, filling its host (give the host a size). Falls back
 * to a region-coloured monogram when there is no photo or it fails to load.
 *
 *   <app-dest-photo code="LIS" size="card" />
 *   <app-dest-photo code="NRT" size="hero" eager />   (LCP image: eager + high priority)
 */
@Component({
  selector: 'app-dest-photo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': "'is-' + size()",
    '[class.is-mono]': '!showPhoto()',
  },
  template: `
    @if (showPhoto()) {
      <img [src]="src()" [attr.srcset]="srcset()" [attr.sizes]="sizes()" [alt]="altText()"
           [attr.loading]="eager() ? 'eager' : 'lazy'" [attr.fetchpriority]="eager() ? 'high' : null"
           decoding="async" [style.object-position]="position()" (error)="failed.set(true)">
    } @else {
      <span class="ui-mono mono" [style.--mono]="tint()" [attr.role]="alt() ? 'img' : null"
            [attr.aria-label]="alt() || null">
        <span class="mono__code">{{ code() }}</span>
        @if (size() !== 'thumb' && city()) { <span class="mono__city">{{ city() }}</span> }
      </span>
    }
  `,
  styles: [`
    :host { display: block; position: relative; overflow: hidden; background: var(--fill); }
    :host(.is-thumb) { width: 44px; height: 44px; flex: none; border-radius: var(--radius-thumb); }
    img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .mono { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
    :host(:not(.is-thumb)) .mono__code { font-family: var(--cond); font-size: 64px; font-weight: 600; line-height: .95; letter-spacing: -.01em; }
    .mono__city { font-size: 14px; font-weight: 600; opacity: .9; }
    /* Cards carry a glass bar at the bottom: centre the monogram in the space above it. */
    :host(.is-card) .mono { padding-bottom: 34%; }
  `],
})
export class DestPhotoComponent {
  private readonly photos = inject(PhotoService);

  readonly code = input.required<string>();
  readonly size = input<DestPhotoSize>('card');
  /** Alt text; '' (default) marks the image decorative. */
  readonly alt = input<string>('');
  readonly eager = input(false, { transform: booleanAttribute });

  /** Load error for the current code (reset when the code changes). */
  protected readonly failed = linkedSignal({ source: this.code, computation: () => false });

  protected readonly showPhoto = computed(() => this.photos.has(this.code()) && !this.failed());
  protected readonly src = computed(() => this.photos.src(this.code(), this.size() === 'thumb' ? 400 : 960));
  protected readonly srcset = computed(() => (this.size() === 'thumb' ? null : this.photos.srcset(this.code())));
  protected readonly sizes = computed(() => (this.size() === 'thumb' ? null : SIZES[this.size()]));
  protected readonly position = computed(() => this.photos.position(this.code()));
  protected readonly altText = computed(() => this.alt());
  protected readonly city = computed(() => findDestination(this.code())?.city ?? '');
  protected readonly tint = computed(() => regionVar(findDestination(this.code())?.region));
}
