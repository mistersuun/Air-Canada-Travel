import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import type { Trip } from '../../../trips/model';
import { TripsService } from '../../../trips/trips.service';
import { GlassSheetComponent } from '../../../ui/glass-sheet.component';

/**
 * Who is travelling: the party count (1–9) and "stay together" (the same
 * flight, not adjacent seats). Opened from the party chip on the Plan tab.
 */
@Component({
  selector: 'app-party-sheet',
  standalone: true,
  imports: [GlassSheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-glass-sheet title="Travellers" [open]="true" (closed)="closed.emit()">
      <div class="ps">
        <div class="ps__row">
          <span class="ps__tx"><span class="nm">Travelling</span><span class="hint">Everyone on the same standby list</span></span>
          <span class="step">
            <button type="button" class="ui-circ ui-circ--glass" aria-label="One fewer traveller" [disabled]="trip().party.count <= 1"
                    (click)="setCount(trip().party.count - 1)">−</button>
            <b class="tn" aria-live="polite" data-count>{{ trip().party.count }}</b>
            <button type="button" class="ui-circ ui-circ--glass" aria-label="One more traveller" [disabled]="trip().party.count >= 9"
                    (click)="setCount(trip().party.count + 1)">+</button>
          </span>
        </div>
        <label class="ps__row" for="party-together">
          <span class="ps__tx"><span class="nm">Stay together</span><span class="hint">Only take a flight with seats for everyone</span></span>
          <input id="party-together" type="checkbox" role="switch" class="switch" [checked]="trip().party.stayTogether"
                 [disabled]="trip().party.count <= 1" (change)="setTogether($any($event.target).checked)">
        </label>
      </div>
    </app-glass-sheet>
  `,
  styles: [`
    .ps { display: grid; gap: 14px; padding: 14px 16px; border-radius: 18px; background: var(--fill); }
    .ps__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; }
    .ps__tx { display: grid; gap: 2px; }
    .nm { font-size: 15px; font-weight: 600; }
    .hint { font-size: 13px; color: var(--ink-2); }
    .step { display: inline-flex; align-items: center; gap: 10px; flex: none; }
    .step b { min-width: 20px; text-align: center; font-size: 17px; }
    .step .ui-circ { width: 44px; height: 44px; font-size: 20px; font-weight: 600; background: var(--surface); }
    .switch {
      appearance: none; flex: none; width: 50px; height: 30px; margin: 0; border-radius: 999px;
      background: color-mix(in srgb, var(--ink-2) 70%, var(--ink-3)); position: relative; cursor: pointer;
      transition: background var(--dur-fast) var(--ease-out);
    }
    .switch::after {
      content: ''; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%;
      background: var(--surface); box-shadow: 0 1px 3px rgba(0, 0, 0, .2); transition: transform var(--dur-fast) var(--ease-out);
    }
    .switch:checked { background: var(--teal); }
    .switch:checked::after { transform: translateX(20px); }
    .switch:disabled { opacity: .45; cursor: default; }
  `],
})
export class PartySheetComponent {
  private readonly trips = inject(TripsService);
  readonly trip = input.required<Trip>();
  readonly closed = output<void>();

  protected setCount(n: number): void {
    const count = Math.min(9, Math.max(1, n));
    this.trips.update(this.trip().id, t => ({ ...t, party: { ...t.party, count } }));
  }

  protected setTogether(on: boolean): void {
    this.trips.update(this.trip().id, t => ({ ...t, party: { ...t.party, stayTogether: on } }));
  }
}
