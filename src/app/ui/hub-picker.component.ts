import { ChangeDetectionStrategy, Component, InjectionToken, computed, inject, input, output, signal } from '@angular/core';
import { HUBS } from '../data/destinations';
import { AppStateService } from '../state/app-state.service';
import { formatKm, nearestTo } from '../utils/geo';
import { GlassSheetComponent } from './glass-sheet.component';
import { hubDisplayName } from './format';

/** The browser's geolocation, or null when it has none; specs replace it. */
export const GEOLOCATION = new InjectionToken<Pick<Geolocation, 'getCurrentPosition'> | null>('GEOLOCATION', {
  providedIn: 'root',
  factory: () => (typeof navigator !== 'undefined' && navigator.geolocation) || null,
});

/** How long to wait for a position, and how old a cached one may be (ms). */
export const LOCATE_TIMEOUT_MS = 10_000;

/**
 * Home-airport picker: a glass pill ('YUL Montréal ▾') that opens a sheet
 * listing the hubs.
 *
 *   <app-hub-picker [hub]="state.hub()" size="lg" (hubChange)="state.setHub($event)" />
 */
@Component({
  selector: 'app-hub-picker',
  standalone: true,
  imports: [GlassSheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-lg]': "size() === 'lg'" },
  template: `
    <button type="button" class="picker ui-glass" (click)="open.set(true)" aria-haspopup="dialog"
            [attr.aria-label]="'Home airport: ' + name() + ' (' + hub() + '). Change'">
      <span class="code">{{ hub() }}</span>{{ name() }}@if (size() === 'lg') {<span class="caret" aria-hidden="true">▾</span>}
    </button>
    <app-glass-sheet title="Flying from" [(open)]="open">
      @if (canLocate) {
        <button type="button" class="near" data-nearest [disabled]="locating()" (click)="locate()">
          {{ locating() ? 'Finding nearest hub…' : 'Nearest to me' }}
        </button>
        <p class="near__msg ui-sub" role="status" data-nearest-msg>{{ message() }}</p>
      }
      <ul class="hubs" role="list">
        @for (h of hubs; track h.code) {
          <li>
            <button type="button" class="hub" [class.on]="h.code === hub()" [attr.aria-current]="h.code === hub() ? 'true' : null"
                    (click)="choose(h.code)">
              <span class="code">{{ h.code }}</span>
              <span class="hub__name">{{ display(h.code) }}</span>
              @if (h.code === hub()) { <span class="hub__tick" aria-hidden="true">✓</span> }
            </button>
          </li>
        }
      </ul>
    </app-glass-sheet>
  `,
  styles: [`
    :host { display: inline-flex; min-width: 0; }
    .picker {
      display: inline-flex; align-items: center; gap: 8px; min-width: 0;
      padding: 8px 14px 8px 8px; border-radius: 999px;
      font-weight: 600; font-size: 14px; color: var(--ink); white-space: nowrap;
    }
    :host(.is-lg) .picker { font-size: 22px; padding: 6px 18px 6px 8px; letter-spacing: -.01em; }
    .code {
      background: var(--ink); color: var(--bg); font-size: 11px; font-weight: 700;
      border-radius: 999px; padding: 4px 8px; letter-spacing: .04em; flex: none;
    }
    :host(.is-lg) .picker .code { font-size: 13px; padding: 6px 10px; }
    .caret { font-size: .8em; margin-left: 2px; }
    .picker:hover { border-color: var(--hair); }
    .picker:focus-visible { border-radius: 999px; }
    .near { display: block; width: 100%; padding: 10px 12px; margin-bottom: 4px; border-radius: 14px; background: var(--fill); font-size: 14px; font-weight: 600; text-align: left; color: var(--blue); }
    .near:disabled { opacity: .6; }
    .near__msg { margin: 0 0 8px; padding: 0 4px; min-height: 0; }
    .near__msg:empty { display: none; }
    .hubs { list-style: none; display: grid; gap: 2px; }
    .hub {
      display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 8px;
      border-radius: 14px; text-align: left; font-size: 15px; font-weight: 600;
    }
    .hub:hover { background: var(--fill); }
    .hub.on { background: color-mix(in srgb, var(--blue) 10%, transparent); }
    .hub .code { min-width: 44px; text-align: center; }
    .hub__name { flex: 1; }
    .hub__tick { color: var(--blue); }
  `],
})
export class HubPickerComponent {
  readonly hub = input.required<string>();
  readonly size = input<'lg' | 'sm'>('sm');
  readonly hubChange = output<string>();

  private readonly state = inject(AppStateService);
  private readonly geo = inject(GEOLOCATION);
  protected readonly canLocate = !!this.geo;
  protected readonly locating = signal(false);
  protected readonly message = signal('');

  protected readonly hubs = HUBS;
  protected readonly open = signal(false);
  protected readonly name = computed(() => hubDisplayName(this.hub()));

  protected display(code: string): string {
    return hubDisplayName(code);
  }

  /**
   * On tap only: asks the browser for one position, picks the closest hub and
   * forgets the position. It is never stored or sent anywhere.
   */
  protected locate(): void {
    if (!this.geo || this.locating()) return;
    this.locating.set(true);
    this.message.set('');
    this.geo.getCurrentPosition(
      pos => {
        this.locating.set(false);
        const near = nearestTo({ lat: pos.coords.latitude, lng: pos.coords.longitude }, HUBS);
        if (!near) return;
        this.open.set(false);
        if (near.place.code !== this.hub()) this.hubChange.emit(near.place.code);
        this.state.flash(`Nearest hub: ${near.place.code} · ${formatKm(near.km)}`);
      },
      err => {
        this.locating.set(false);
        this.message.set(err.code === 1 ? 'Location is off for this site, so pick a hub from the list.'
          : err.code === 3 ? 'Location took too long. Pick a hub from the list.'
          : 'Location is not available right now. Pick a hub from the list.');
      },
      { enableHighAccuracy: false, timeout: LOCATE_TIMEOUT_MS, maximumAge: 10 * 60_000 },
    );
  }

  protected choose(code: string): void {
    this.open.set(false);
    if (code !== this.hub()) this.hubChange.emit(code);
  }
}
