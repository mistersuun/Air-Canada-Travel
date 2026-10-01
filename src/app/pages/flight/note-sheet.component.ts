import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { GlassSheetComponent } from '../../ui/glass-sheet.component';
import { TripsService } from '../../trips/trips.service';
import type { NoteFlight } from './flight-model';

/** Largest seat or list count a note accepts. */
export const MAX_NOTE_COUNT = 999;
export const MAX_NOTE_TEXT = 140;

/** '14' → 14; '' or junk → null; clamped to 0..999. */
export function parseCount(v: string): number | null {
  const t = v.trim();
  if (!/^\d+$/.test(t)) return null;
  return Math.min(MAX_NOTE_COUNT, Number(t));
}

/**
 * "Add a load note" sheet: which flight, seats open and people listed as the
 * traveller read them in their load tool, and a short note. The note is
 * stamped with the time it was written and stays on this device.
 *
 *   @if (open()) { <app-note-sheet [flights]="flights" [selected]="key" (closed)="open.set(false)" /> }
 *
 * Exported for the Today page (read-only import).
 */
@Component({
  selector: 'app-note-sheet',
  standalone: true,
  imports: [GlassSheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-glass-sheet title="Add a load note" [open]="true" (closed)="closed.emit()">
      <form class="ns" (submit)="save($event)">
        @if (flights().length > 1) {
          <label class="ns__f">
            <span class="ns__l">Flight</span>
            <select class="ns__in" data-flight [value]="key()" (change)="key.set(value($event))">
              @for (f of flights(); track f.key) { <option [value]="f.key" [selected]="f.key === key()">{{ f.label }}</option> }
            </select>
          </label>
        } @else if (flights().length === 1) {
          <p class="ns__one tn">{{ flights()[0].label }}</p>
        }
        <div class="ns__row">
          <label class="ns__f">
            <span class="ns__l">Seats open</span>
            <input class="ns__in tn" data-open type="number" inputmode="numeric" min="0" [max]="max" placeholder="—"
                   [value]="open()" (input)="open.set(value($event))">
          </label>
          <label class="ns__f">
            <span class="ns__l">People listed</span>
            <input class="ns__in tn" data-listed type="number" inputmode="numeric" min="0" [max]="max" placeholder="—"
                   [value]="listed()" (input)="listed.set(value($event))">
          </label>
        </div>
        <label class="ns__f">
          <span class="ns__l">Note</span>
          <input class="ns__in" data-text type="text" [maxLength]="maxText" autocomplete="off" placeholder="Gate 52, list moving"
                 [value]="text()" (input)="text.set(value($event))">
        </label>
        <p class="ns__hint">As you read it in your load tool. Notes stay on this device, with the time you wrote them.</p>
        <button type="submit" class="ui-btn ui-btn--dark ui-btn--block" data-save [disabled]="!canSave()">Save note</button>
      </form>
    </app-glass-sheet>
  `,
  styles: [`
    .ns { display: grid; gap: 14px; }
    .ns__row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .ns__f { display: grid; gap: 6px; min-width: 0; }
    .ns__l { font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
    .ns__in {
      width: 100%; min-width: 0; min-height: 46px; padding: 0 12px; border-radius: 12px; border: 1px solid var(--hair);
      background: var(--fill); color: var(--ink); font: inherit; font-size: 15px;
    }
    .ns__in:focus-visible { outline: 2px solid var(--blue); outline-offset: 1px; }
    .ns__one { margin: 0; font-size: 14px; font-weight: 600; }
    .ns__hint { margin: 0; font-size: 12.5px; color: var(--ink-2); }
  `],
})
export class NoteSheetComponent {
  private readonly trips = inject(TripsService);

  readonly flights = input.required<NoteFlight[]>();
  /** instanceKey of the flight selected first (default: the first one). */
  readonly selected = input<string | null>(null);
  readonly closed = output<void>();
  readonly saved = output<string>();

  protected readonly max = MAX_NOTE_COUNT;
  protected readonly maxText = MAX_NOTE_TEXT;
  protected readonly key = linkedSignal(() => {
    const want = this.selected();
    const list = this.flights();
    return list.find(f => f.key === want)?.key ?? list[0]?.key ?? '';
  });
  protected readonly open = signal('');
  protected readonly listed = signal('');
  protected readonly text = signal('');
  protected readonly canSave = computed(() =>
    !!this.flights().find(f => f.key === this.key())
    && (parseCount(this.open()) !== null || parseCount(this.listed()) !== null || !!this.text().trim()));

  protected value(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected save(e: Event): void {
    e.preventDefault();
    const f = this.flights().find(x => x.key === this.key());
    if (!f || !this.canSave()) return;
    const r = f.ref;
    this.trips.addLoadNote({
      flightNumber: r.flightNumber, origin: r.origin, dest: r.dest, dateKey: r.dateKey,
      open: parseCount(this.open()), listed: parseCount(this.listed()), text: this.text().trim().slice(0, MAX_NOTE_TEXT),
    });
    this.saved.emit(f.key);
    this.closed.emit();
  }
}
