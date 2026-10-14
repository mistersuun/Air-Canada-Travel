import { ChangeDetectionStrategy, Component, DOCUMENT, computed, inject, input, output, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { IconComponent } from '../../../components/shared/icons.component';
import { SCHEDULES_URL, getCoverage, getSchedulesMeta, scheduleVersion } from '../../../data/schedule-index';
import { PhotoService } from '../../../state/photo.service';
import { AppStateService } from '../../../state/app-state.service';
import { buildTripIcs, tripIcsFilename } from '../../../trips/engine/trip-ics';
import type { Trip } from '../../../trips/model';
import { TripsService } from '../../../trips/trips.service';
import { GlassSheetComponent } from '../../../ui/glass-sheet.component';
import { downloadIcs } from '../../../utils/ics';
import { monthDay, offlineAirportsLabel, offlineUntil, savedAtLabel } from '../trips-model';
import { offlineFlash, offlineItems, offlineReportLabel, warmOffline, type OfflineItemResult } from './offline-save';

/**
 * The "⋯" More menu (mockup g8): what is ready offline (honest ticks only),
 * "Save for offline", a calendar file that marks every flight "Tentative
 * standby", and Delete. Sharing lives in the Share sheet.
 */
@Component({
  selector: 'app-trip-menu',
  standalone: true,
  imports: [IconComponent, GlassSheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-glass-sheet [title]="'More: ' + trip().name" [open]="true" (closed)="closed.emit()">
      <div class="tm">
        <section class="grp" data-offline>
          <div>
            <h3 class="ui-h3">Ready offline</h3>
            <p class="ui-sub tn">{{ savedText() }}</p>
          </div>
          <ul class="chk">
            <li>
              <span class="box on" aria-hidden="true"><app-icon name="check" [size]="13" [strokeWidth]="3" /></span>
              <span class="rt"><b>Your plan and notes</b><span class="m">Kept on this device</span></span>
              <span class="ui-visually-hidden">Ready</span>
            </li>
            <li data-schedules>
              <span class="box" [class.on]="schedulesReady()" aria-hidden="true">
                @if (schedulesReady()) { <app-icon name="check" [size]="13" [strokeWidth]="3" /> }
              </span>
              <span class="rt"><b>Backups and return flights</b><span class="m tn">{{ airports() }}{{ airports() ? ' · ' : '' }}to {{ until() }}</span></span>
              <span class="ui-visually-hidden">{{ schedulesReady() ? 'Ready' : 'Not saved yet' }}</span>
            </li>
            <li>
              <span class="box" aria-hidden="true"></span>
              <span class="rt"><b>Onward directions</b><span class="m">Needs internet (Google Maps)</span></span>
              <span class="ui-visually-hidden">Not available offline</span>
            </li>
          </ul>
          <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost tm__save" data-save-offline [disabled]="saving()" (click)="saveOffline()">
            <app-icon name="download" [size]="16" /> {{ trip().offlineSavedAt ? 'Save again' : 'Save for offline' }}
          </button>
          @if (reportText()) { <p class="ui-sub tm__fine" data-offline-report>{{ reportText() }}</p> }
        </section>

        <section class="grp" data-calendar-sec>
          <div>
            <h3 class="ui-h3">Calendar</h3>
            <p class="ui-sub">A file for your calendar app. It marks every flight "Tentative standby". Stays on this device.</p>
          </div>
          <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost tm__save" data-calendar (click)="calendar()">
            <app-icon name="calendar" [size]="16" /> Export to calendar
          </button>
          @if (trip().calendarExportedAt) {
            <p class="ui-sub tm__fine">Calendar file has a reminder to list 48 hours before each flight.</p>
          }
        </section>

        <button type="button" class="tm__del" data-delete (click)="remove()">Delete this trip</button>
      </div>
    </app-glass-sheet>
  `,
  styles: [`
    .tm { display: grid; gap: 14px; }
    .grp { display: grid; gap: 12px; padding: 14px 16px; border-radius: 18px; background: var(--fill); }
    .grp .ui-sub { margin-top: 2px; }
    .chk { list-style: none; margin: 0; padding: 0; }
    .chk li { display: flex; gap: 12px; align-items: flex-start; padding: 11px 0; border-bottom: 1px solid var(--hair); }
    .chk li:first-child { padding-top: 0; }
    .chk li:last-child { border-bottom: 0; padding-bottom: 0; }
    .box {
      width: 22px; height: 22px; border-radius: 7px; box-shadow: inset 0 0 0 1.8px var(--hair); flex: none;
      display: grid; place-items: center; background: var(--surface);
    }
    .box.on { background: var(--teal); box-shadow: none; color: #FFFFFF; }
    .rt { flex: 1; min-width: 0; display: grid; }
    .rt b { font-weight: 650; font-size: 15px; }
    .rt .m { font-size: 12.5px; color: var(--ink-2); }
    .tm__save { justify-self: start; min-height: 40px; background: var(--surface); }
        .tm__fine { font-size: 12px; }
    .tm__del { justify-self: center; color: var(--red-ink); font-size: 14px; font-weight: 600; min-height: 44px; padding: 0 12px; }
  `],
})
export class TripMenuComponent {
  private readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  private readonly photos = inject(PhotoService);
  private readonly doc = inject(DOCUMENT);
  private readonly sw = inject(SwUpdate, { optional: true });

  readonly trip = input.required<Trip>();
  readonly closed = output<void>();
  /** Emitted after the trip is deleted (the page leaves). */
  readonly deleted = output<void>();

  /** True while "Save for offline" is fetching. */
  protected readonly saving = signal(false);
  /** True when the schedules file is in the service worker cache (or the worker is off and the data is loaded). */
  protected readonly cached = signal<boolean | null>(null);

  protected readonly savedText = computed(() =>
    savedAtLabel(this.trip().offlineSavedAt, this.trip().homeAirport, this.state.timeFormat()) ?? 'Not saved for offline yet');
  protected readonly airports = computed(() => offlineAirportsLabel(this.trip(), this.state.connect()));
  protected readonly until = computed(() => {
    scheduleVersion();
    return monthDay(offlineUntil(this.trip(), getCoverage(this.trip().fromHub).to));
  });
  /** Per-item result of the last "Save for offline" (null before the first). */
  protected readonly report = signal<OfflineItemResult[] | null>(null);
  protected readonly reportText = computed(() => { const r = this.report(); return r ? offlineReportLabel(r) : ''; });
  protected readonly schedulesReady = computed(() => this.cached() === true);

  constructor() {
    void this.checkCache();
  }

  /** Looks for the schedules in Cache Storage; with no service worker, loaded data counts. */
  async checkCache(): Promise<void> {
    const loaded = !!getSchedulesMeta();
    if (!this.sw?.isEnabled) {
      this.cached.set(loaded);
      return;
    }
    const caches = this.doc.defaultView?.caches;
    if (!caches) {
      this.cached.set(false);
      return;
    }
    try {
      const url = new URL(SCHEDULES_URL, this.doc.baseURI).href;
      this.cached.set(!!(await caches.match(url)));
    } catch {
      this.cached.set(false);
    }
  }

  protected async saveOffline(): Promise<void> {
    this.trips.markOfflineSaved(this.trip().id);
    // Ask for each file once so the service worker has it, then re-check the schedules.
    let results: OfflineItemResult[] | null = null;
    const win = this.doc.defaultView;
    if (this.sw?.isEnabled && win) {
      this.saving.set(true);
      try {
        const signal = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(15000) } : {});
        results = await warmOffline(offlineItems(this.trip(), c => this.photos.has(c), c => this.photos.hasHero(c)),
          u => win.fetch(u, signal()));
      } finally {
        this.saving.set(false);
      }
    }
    await this.checkCache();
    if (results) {
      // The schedules tick also needs the file to be in the cache, not just fetched.
      results = results.map(r => (r.id === 'schedules' ? { ...r, ok: r.ok && this.cached() === true } : r));
      this.report.set(results);
      this.state.flash(offlineFlash(results));
      return;
    }
    this.state.flash(this.cached() ? 'Saved for offline' : 'Plan saved. Schedules need a connection to download.');
  }

  protected calendar(): void {
    const t = this.trip();
    const ok = downloadIcs(buildTripIcs(t, this.state.nowMs()), tripIcsFilename(t), this.doc);
    if (!ok) {
      this.state.flash('Could not create the calendar file');
      return;
    }
    this.trips.markCalendarExported(t.id);
    this.state.flash('Calendar file downloaded · every flight marked Tentative');
  }

  protected remove(): void {
    this.trips.remove(this.trip().id);
    this.deleted.emit();
  }
}
