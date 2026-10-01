import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { addPassPath, filesPath, passPath } from '../../extras/links';
import { PassesService } from '../../passes/passes.service';
import type { Trip } from '../../trips/model';
import { FilesService } from '../files.service';

/** The chip texts: 'Passes · 2' / 'Add pass', 'Files · 7' / 'Files'. */
export function extrasLabels(passes: number, files: number): { passes: string; files: string } {
  return { passes: passes ? `Passes · ${passes}` : 'Add pass', files: files ? `Files · ${files}` : 'Files' };
}

/**
 * Trip detail chips under the header (extras spec §2.2): "Passes · 2" opens
 * the first pass (or the add-pass page when there is none) and "Files · 7"
 * opens /trips/:id/files. Counts come from this phone only.
 */
@Component({
  selector: 'app-trip-extras',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="tx" aria-label="Passes and files">
      <a class="tx__chip" [routerLink]="passLink()" data-chip="passes"
         [attr.aria-label]="passAria()">
        <app-icon name="barcode" [size]="16" /><span class="tn">{{ labels().passes }}</span>
      </a>
      <a class="tx__chip" [routerLink]="filesLink()" data-chip="files">
        <app-icon name="paperclip" [size]="16" /><span class="tn">{{ labels().files }}</span>
      </a>
    </nav>
  `,
  styles: [`
    :host { display: block; }
    .tx { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
    .tx__chip {
      display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 16px; border-radius: 999px;
      background: var(--glass); border: 1px solid var(--glass-b); color: var(--ink); font-size: 13.5px; font-weight: 600;
      text-decoration: none; -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px);
      transition: transform var(--dur-fast) var(--ease-out);
    }
    .tx__chip:active { transform: scale(.97); }
    .tx__chip app-icon { color: var(--ink-2); }
  `],
})
export class TripExtrasComponent {
  private readonly files = inject(FilesService);
  private readonly passes = inject(PassesService);
  readonly trip = input.required<Trip>();

  private readonly tripPasses = computed(() => this.passes.passes().filter(p => p.tripId === this.trip().id));
  protected readonly passCount = computed(() => this.tripPasses().length);
  protected readonly fileCount = computed(() => this.files.attachments().filter(a => a.tripId === this.trip().id).length);
  protected readonly labels = computed(() => extrasLabels(this.passCount(), this.fileCount()));
  /** Starts with the visible label (WCAG 2.5.3): 'Passes · 2 boarding passes', 'Add pass (boarding pass)'. */
  protected readonly passAria = computed(() => {
    const n = this.passCount();
    return n ? `${this.labels().passes} boarding ${n === 1 ? 'pass' : 'passes'}` : `${this.labels().passes} (boarding pass)`;
  });
  protected readonly passLink = computed(() => {
    const first = this.tripPasses()[0];
    return first ? passPath(this.trip().id, first.id) : addPassPath(this.trip().id);
  });
  protected readonly filesLink = computed(() => filesPath(this.trip().id));

  constructor() {
    void this.files.ensureReady().catch(() => undefined);
  }
}
