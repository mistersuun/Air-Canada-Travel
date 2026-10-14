import { ChangeDetectionStrategy, Component, DOCUMENT, computed, inject, input, output, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { t } from '../../../i18n/t';
import { IconComponent } from '../../../components/shared/icons.component';
import { SCHEDULES_URL, getCoverage, getSchedulesMeta, scheduleVersion } from '../../../data/schedule-index';
import { PhotoService } from '../../../state/photo.service';
import { AppStateService } from '../../../state/app-state.service';
import { buildTripIcs, tripIcsFilename } from '../../../trips/engine/trip-ics';
import { PrefsService } from '../../../state/prefs.service';
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
    <app-glass-sheet [title]="t('trips.menu.title', { name: trip().name })" [open]="true" (closed)="closed.emit()">
      <div class="tm">
        <section class="grp" data-offline>
          <div>
            <h3 class="ui-h3">{{ t('trips.menu.ready') }}</h3>
            <p class="ui-sub tn">{{ savedText() }}</p>
          </div>
          <ul class="chk">
            <li>
              <span class="box on" aria-hidden="true"><app-icon name="check" [size]="13" [strokeWidth]="3" /></span>
              <span class="rt"><b>{{ t('trips.menu.plan') }}</b><span class="m">{{ t('trips.menu.kept') }}</span></span>
              <span class="ui-visually-hidden">{{ t('trips.menu.readyS') }}</span>
            </li>
            <li data-schedules>
              <span class="box" [class.on]="schedulesReady()" aria-hidden="true">
                @if (schedulesReady()) { <app-icon name="check" [size]="13" [strokeWidth]="3" /> }
              </span>
              <span class="rt"><b>{{ t('trips.menu.backups') }}</b><span class="m tn">{{ airports() }}{{ airports() ? ' · ' : '' }}{{ t('trips.menu.until', { date: until() }) }}</span></span>
              <span class="ui-visually-hidden">{{ t(schedulesReady() ? 'trips.menu.readyS' : 'trips.menu.notSaved') }}</span>
            </li>
            <li>
              <span class="box" aria-hidden="true"></span>
              <span class="rt"><b>{{ t('trips.menu.directions') }}</b><span class="m">{{ t('trips.menu.needsNet') }}</span></span>
              <span class="ui-visually-hidden">{{ t('trips.menu.notOffline') }}</span>
            </li>
          </ul>
          <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost tm__save" data-save-offline [disabled]="saving()" (click)="saveOffline()">
            <app-icon name="download" [size]="16" /> {{ t(trip().offlineSavedAt ? 'trips.menu.saveAgain' : 'trips.menu.save') }}
          </button>
          @if (reportText()) { <p class="ui-sub tm__fine" data-offline-report>{{ reportText() }}</p> }
        </section>

        <section class="grp" data-calendar-sec>
          <div>
            <h3 class="ui-h3">{{ t('trips.menu.calendar') }}</h3>
            <p class="ui-sub">{{ t('trips.menu.calendarText') }}</p>
          </div>
          <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost tm__save" data-calendar (click)="calendar()">
            <app-icon name="calendar" [size]="16" /> {{ t('trips.menu.export') }}
          </button>
          @if (trip().calendarExportedAt) {
            <p class="ui-sub tm__fine">{{ t('trips.menu.calendarFine') }}</p>
          }
        </section>

        <button type="button" class="tm__del" data-delete (click)="remove()">{{ t('trips.edit.delete') }}</button>
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
  protected readonly t = t;
  private readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  protected readonly prefs = inject(PrefsService);
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
    savedAtLabel(this.trip().offlineSavedAt, this.trip().homeAirport, this.state.timeFormat()) ?? t('trips.menu.notSavedYet'));
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
    this.state.flash(t(this.cached() ? 'trips.off.saved' : 'trips.off.planSaved'));
  }

  protected calendar(): void {
    const tr = this.trip();
    const ok = downloadIcs(buildTripIcs(tr, this.state.nowMs(), this.prefs.listingHours()), tripIcsFilename(tr), this.doc);
    if (!ok) {
      this.state.flash(t('trips.menu.noCalendar'));
      return;
    }
    this.trips.markCalendarExported(tr.id);
    this.state.flash(t('trips.menu.calendarDone'));
  }

  protected remove(): void {
    this.trips.remove(this.trip().id);
    this.deleted.emit();
  }
}
