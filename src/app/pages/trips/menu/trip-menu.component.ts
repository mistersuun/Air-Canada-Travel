import { ChangeDetectionStrategy, Component, DOCUMENT, computed, inject, input, output, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { IconComponent } from '../../../components/shared/icons.component';
import { getCoverage, getSchedulesMeta, scheduleVersion } from '../../../data/schedule-index';
import { AppStateService } from '../../../state/app-state.service';
import { buildTripIcs, tripIcsFilename } from '../../../trips/engine/trip-ics';
import type { Trip } from '../../../trips/model';
import { TripsService } from '../../../trips/trips.service';
import { GlassSheetComponent } from '../../../ui/glass-sheet.component';
import { downloadIcs } from '../../../utils/ics';
import { monthDay, offlineAirportsLabel, offlineUntil, savedAtLabel } from '../trips-model';

/** The schedules file the service worker caches (ngsw-config "schedules" group). */
export const SCHEDULES_URL = 'data/schedules.json';

/**
 * Trip menu (mockup g8): what is ready offline (honest ticks only), "Save
 * for offline", and sharing with a companion: the "If we split up" note,
 * "Copy link" (Web Share when present, else the clipboard) and a calendar
 * file that marks every flight "Tentative standby".
 */
@Component({
  selector: 'app-trip-menu',
  standalone: true,
  imports: [IconComponent, GlassSheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-glass-sheet [title]="trip().name" [open]="true" (closed)="closed.emit()">
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
          <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost tm__save" data-save-offline (click)="saveOffline()">
            <app-icon name="download" [size]="16" /> {{ trip().offlineSavedAt ? 'Save again' : 'Save for offline' }}
          </button>
        </section>

        <section class="grp" data-share>
          <div>
            <h3 class="ui-h3">Share with your companion</h3>
            <p class="ui-sub">They get the plan, the backups and your notes. Changes need a new share.</p>
          </div>
          <label class="split">
            <span class="ui-label">If we split up</span>
            <textarea rows="2" maxlength="400" placeholder="Where you meet, who books the room…" data-split
                      [value]="trip().party.splitNote" (change)="saveSplit($any($event.target).value)"></textarea>
          </label>
          <div class="acts">
            <button type="button" class="ui-btn ui-btn--sm ui-btn--dark" data-copy (click)="copyLink()" [disabled]="busy()">Copy link</button>
            <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost" data-calendar (click)="calendar()">
              <app-icon name="calendar" [size]="16" /> Calendar
            </button>
          </div>
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
    .split { display: grid; gap: 4px; background: var(--surface); border-radius: 14px; padding: 10px 12px; }
    .split textarea {
      border: 0; background: none; resize: vertical; min-height: 44px; color: var(--ink);
      font: 400 14px/1.45 var(--sans); padding: 0; outline: none;
    }
    .split:focus-within { box-shadow: 0 0 0 2px var(--blue); }
    .acts { display: flex; gap: 8px; }
    .acts .ui-btn { flex: 1; min-height: 44px; }
    .acts .ui-btn--ghost { background: var(--surface); }
    .tm__fine { font-size: 12px; }
    .tm__del { justify-self: center; color: var(--red-ink); font-size: 14px; font-weight: 600; min-height: 44px; padding: 0 12px; }
  `],
})
export class TripMenuComponent {
  private readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  private readonly doc = inject(DOCUMENT);
  private readonly sw = inject(SwUpdate, { optional: true });

  readonly trip = input.required<Trip>();
  readonly closed = output<void>();
  /** Emitted after the trip is deleted (the page leaves). */
  readonly deleted = output<void>();

  protected readonly busy = signal(false);
  /** True when the schedules file is in the service worker cache (or the worker is off and the data is loaded). */
  protected readonly cached = signal<boolean | null>(null);

  protected readonly savedText = computed(() =>
    savedAtLabel(this.trip().offlineSavedAt, this.trip().homeAirport, this.state.timeFormat()) ?? 'Not saved for offline yet');
  protected readonly airports = computed(() => offlineAirportsLabel(this.trip(), this.state.connect()));
  protected readonly until = computed(() => {
    scheduleVersion();
    return monthDay(offlineUntil(this.trip(), getCoverage(this.trip().fromHub).to));
  });
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
    // Ask for the schedules once so the service worker has them, then re-check.
    if (this.sw?.isEnabled) {
      try {
        await this.doc.defaultView?.fetch(SCHEDULES_URL);
      } catch {
        // offline: the cache check below tells the truth
      }
    }
    await this.checkCache();
    this.state.flash(this.cached() ? 'Saved for offline' : 'Plan saved. Schedules need a connection to download.');
  }

  protected saveSplit(text: string): void {
    const splitNote = text.trim().slice(0, 400);
    if (splitNote === this.trip().party.splitNote) return;
    this.trips.update(this.trip().id, t => ({ ...t, party: { ...t.party, splitNote } }));
  }

  protected async copyLink(): Promise<void> {
    this.busy.set(true);
    try {
      let url: string;
      try {
        url = await this.trips.shareLink(this.trip().id);
      } catch {
        this.state.flash('This trip is too large to share as a link · use Export trips in Settings');
        return;
      }
      if (!url) return;
      const nav = this.doc.defaultView?.navigator;
      if (nav?.share) {
        try {
          await nav.share({ title: this.trip().name, text: `${this.trip().name}: our standby plan`, url });
          return;
        } catch (e) {
          if ((e as DOMException)?.name === 'AbortError') return;
        }
      }
      try {
        if (!nav?.clipboard) throw new Error('no clipboard');
        await nav.clipboard.writeText(url);
        this.state.flash('Link copied');
      } catch {
        this.state.flash('Could not copy the link');
      }
    } finally {
      this.busy.set(false);
    }
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
