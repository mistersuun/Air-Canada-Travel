import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { IconComponent } from '../../components/shared/icons.component';
import { AppStateService } from '../../state/app-state.service';
import type { TimeFormat } from '../../state/prefs.service';
import { instanceKey } from '../../trips/model';
import { TripsService } from '../../trips/trips.service';
import { type NoteFlight, noteRow } from './flight-model';
import { NoteSheetComponent } from './note-sheet.component';

/**
 * "Your load notes" (mockup g6): what the traveller read in their load tool
 * for the day's flights, each with the time they wrote it ("You checked at
 * 14:05 · 3h ago") so a morning note doesn't pass for a 17:00 one. A check or
 * an x compares the open seats with the party size, always with words for
 * screen readers. Notes stay on this device.
 */
@Component({
  selector: 'app-load-notes',
  standalone: true,
  imports: [IconComponent, NoteSheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ln" aria-labelledby="ln-h" data-load-notes>
      <div class="ui-sec-h ln__h">
        <h2 class="ui-h3" id="ln-h">Your load notes</h2>
        @if (flights().length) {
          <button type="button" class="ui-link ln__add" data-add (click)="sheetOpen.set(true)">Add</button>
        }
      </div>
      <div class="ui-card ln__list">
        @for (r of rows(); track r.id) {
          <div class="ln__row" data-note>
            @if (r.mark) {
              <span class="ln__res" [class.is-ok]="r.mark === 'ok'" [class.is-short]="r.mark === 'short'" [attr.title]="r.markLabel">
                <app-icon [name]="r.mark === 'ok' ? 'check' : 'close'" [size]="14" [strokeWidth]="2.25" />
                <span class="ui-visually-hidden">{{ r.markLabel }}.</span>
              </span>
            } @else {
              <span class="ln__res"><app-icon name="note" [size]="14" /></span>
            }
            <div class="ln__rt">
              <b class="tn">{{ r.title }}</b>
              @if (r.text) { <span class="ln__tx">{{ r.text }}</span> }
              <span class="ln__m tn">{{ r.when }}</span>
            </div>
            <button type="button" class="ln__rm" [attr.aria-label]="'Remove note ' + r.title" (click)="trips.removeLoadNote(r.id)">
              <app-icon name="close" [size]="15" />
            </button>
          </div>
        } @empty {
          <p class="ln__empty" data-empty>Write down what you see in your load tool. Notes stay on this device.</p>
        }
      </div>
    </section>
    @if (sheetOpen()) {
      <app-note-sheet [flights]="flights()" [selected]="selected()" (closed)="sheetOpen.set(false)" />
    }
  `,
  styles: [`
    :host { display: block; }
    .ln__h { margin-bottom: 8px; align-items: center; }
    .ln__h h2 { margin: 0; font-size: 19px; }
    .ln__add { font-size: 14px; font-weight: 600; min-height: 44px; padding: 0 2px; }
    .ln__list { padding: 4px 14px; }
    .ln__row { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
    .ln__row + .ln__row { border-top: 1px solid var(--hair); }
    .ln__res {
      flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
      background: var(--fill); color: var(--ink-2);
    }
    .ln__res.is-ok { background: color-mix(in srgb, var(--teal) 15%, transparent); color: var(--teal-ink); }
    .ln__res.is-short { background: color-mix(in srgb, var(--red) 12%, transparent); color: var(--red-ink); }
    .ln__rt { flex: 1; min-width: 0; display: grid; gap: 2px; }
    .ln__rt b { font-size: 15px; font-weight: 650; }
    .ln__tx { font-size: 13.5px; color: var(--ink); overflow-wrap: anywhere; }
    .ln__m { font-size: 12.5px; color: var(--ink-2); }
    .ln__rm {
      flex: none; width: 44px; height: 44px; margin-right: -12px; display: grid; place-items: center;
      border-radius: 12px; color: var(--ink-3); cursor: pointer;
    }
    .ln__rm:hover { color: var(--ink); }
    .ln__empty { margin: 0; padding: 14px 0; font-size: 13.5px; color: var(--ink-2); }
    @media (min-width: 1024px) {
      .ln__h h2 { font-size: 22px; letter-spacing: -.02em; }
      .ln__list { padding: 6px 22px; }
    }
  `],
})
export class LoadNotesComponent {
  protected readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);

  /** The day's flights that can carry a note (see noteFlights). */
  readonly flights = input.required<NoteFlight[]>();
  /** The flight the page shows (pre-selected in the sheet). */
  readonly selected = input<string | null>(null);
  readonly partySize = input<number>(1);
  readonly timeFormat = input<TimeFormat>('24h');

  protected readonly sheetOpen = signal(false);

  protected readonly rows = computed(() => {
    const keys = new Set(this.flights().map(f => f.key));
    const now = this.state.nowMs();
    return this.trips.notes()
      .filter(n => keys.has(instanceKey(n)))
      .sort((a, b) => b.at.localeCompare(a.at))
      .map(n => noteRow(n, this.partySize(), now, this.timeFormat()));
  });
}
