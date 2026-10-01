import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { IconComponent } from '../../components/shared/icons.component';
import type { Attachment } from '../../files/model';
import { formatBytes } from '../../files/quota';
import { GlassSheetComponent } from '../../ui/glass-sheet.component';

/**
 * A section's photos, one at a time, read from this phone (offline):
 * Previous / Next, "2 of 3", and "⋯" for Rename, Move and Delete.
 */
@Component({
  selector: 'app-photo-viewer',
  standalone: true,
  imports: [GlassSheetComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-glass-sheet #sheet [title]="current()?.title ?? 'Photo'" [open]="true" (closed)="closed.emit()">
      @if (current(); as p) {
        <figure class="pv">
          @if (urls()[p.blobId ?? '']; as src) {
            <img class="pv__img" [src]="src" [alt]="p.title" data-viewer-img>
          } @else {
            <div class="pv__img pv__img--empty">Loading…</div>
          }
          <figcaption class="pv__cap tn">
            <span>{{ index() + 1 }} of {{ photos().length }} · {{ size() }}</span>
            <button type="button" class="ui-circ ui-circ--glass pv__more" aria-label="Photo actions" data-viewer-more
                    (click)="more.emit(p); sheet.close()">
              <app-icon name="more" [size]="18" />
            </button>
          </figcaption>
        </figure>
        @if (photos().length > 1) {
          <div class="pv__nav">
            <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" data-prev [disabled]="index() === 0" (click)="go(-1)">
              <app-icon name="chevron-left" [size]="16" />Previous
            </button>
            <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" data-next [disabled]="index() >= photos().length - 1" (click)="go(1)">
              Next<app-icon name="chevron-right" [size]="16" />
            </button>
          </div>
        }
      }
    </app-glass-sheet>
  `,
  styles: [`
    .pv { margin: 0; display: grid; gap: 10px; }
    .pv__img { width: 100%; max-height: 62dvh; object-fit: contain; border-radius: 16px; background: var(--fill); }
    .pv__img--empty { height: 240px; display: grid; place-items: center; color: var(--ink-2); font-size: 13px; }
    .pv__cap { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; color: var(--ink-2); }
    .pv__more { width: 44px; height: 44px; }
    .pv__nav { display: flex; justify-content: space-between; gap: 10px; margin-top: 10px; }
    .pv__nav .ui-btn { min-height: 44px; }
  `],
})
export class PhotoViewerComponent {
  readonly photos = input.required<Attachment[]>();
  readonly start = input(0);
  /** blobId → object URL (the page owns and revokes them). */
  readonly urls = input.required<Record<string, string>>();
  readonly closed = output<void>();
  readonly more = output<Attachment>();

  protected readonly index = linkedSignal(() => Math.min(Math.max(0, this.start()), Math.max(0, this.photos().length - 1)));
  protected readonly current = computed<Attachment | null>(() => this.photos()[this.index()] ?? null);
  protected readonly size = computed(() => formatBytes(this.current()?.bytes ?? 0));

  protected go(step: number): void {
    this.index.update(i => Math.min(Math.max(0, i + step), this.photos().length - 1));
  }
}
