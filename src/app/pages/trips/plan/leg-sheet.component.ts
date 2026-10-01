import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../../components/shared/icons.component';
import { airportEnd, groundEstimate, onwardLinks } from '../../../places/ground';
import { GroundTimetableService } from '../../../places/ground-timetable.service';
import { AppStateService } from '../../../state/app-state.service';
import { shortAircraftName } from '../../../trips/engine/facts';
import { endTz, itineraryFromRefs, itineraryFromSnapshot, refsFromItinerary, sameRefs } from '../../../trips/engine/legs';
import {
  Alternate, FlightLeg, GROUND_MODES, GroundMode, LEG_STATUS_LABEL, LegStatus, Trip, isFinalStatus,
} from '../../../trips/model';
import { TripsService } from '../../../trips/trips.service';
import { ROUTE_ONLY_TEXT, networkListsAll } from '../../../data/route-network';
import { ProvenanceTagComponent } from '../../../trips/ui/provenance-tag.component';
import { GlassSheetComponent } from '../../../ui/glass-sheet.component';
import { flightPath } from '../../../ui/links';
import { findDestination, findHub } from '../../../utils/airports';
import { findAlternatives, type Itinerary } from '../../../utils/connections';
import { WEEKDAY_SHORT, toUtcMs, weekdayIndex } from '../../../utils/time';
import {
  MODE_LABEL, dayLabel, flightNumbers, groundLabel, legById, refsRoute, refsTimes,
} from '../trips-model';
import { groundTimetableLines } from '../../reach/reach-model';
import { LegFilesComponent } from '../../../files/ui/leg-files.component';
import { LegPassesComponent } from '../../../passes/ui/leg-passes.component';

/** Statuses the traveller can set on a flight leg (Dropped is set by a swap). */
export const SETTABLE_STATUSES: readonly LegStatus[] = ['planned', 'listed', 'checkedIn', 'boarded', 'notBoarded', 'didntTry'];

interface BackupRow { key: string; it: Itinerary; title: string; meta: string }

/**
 * The leg sheet on the Plan tab (/trips/:id?leg=<legId>). Flight legs: the
 * status you set, the backups folded under the leg ("Use instead" swaps,
 * with Undo), "Open flight details" and "Add a backup". Ground legs: the
 * estimate or your saved times, the corridor timetable for that day when
 * there is one (looked up now; the stored leg stays Estimated), the editor
 * ("Saved by you" on Save) and the onward links.
 */
@Component({
  selector: 'app-leg-sheet',
  standalone: true,
  imports: [RouterLink, IconComponent, GlassSheetComponent, ProvenanceTagComponent, LegPassesComponent, LegFilesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-glass-sheet [title]="title()" [open]="true" (closed)="closed.emit()">
      @if (flight(); as f) {
        <div class="ls" data-kind="flight">
          <p class="ls__fact tn">
            <span>{{ factLine() }}</span>
            <app-provenance-tag [value]="f.provenance" />
          </p>
          @if (f.provenance === 'unknown') {
            @if (routeListed()) {
              <p class="ls__warn ui-sub" data-route-only>{{ routeOnlyText }}. Check the Air Canada app before you go.
                <a class="ui-link" [href]="acUrl" target="_blank" rel="noopener">Open in aircanada.com</a></p>
            } @else {
              <p class="ls__warn ui-sub">Not found in the latest schedules. Check the Air Canada app before you go.</p>
            }
          }

          <fieldset class="ls__st">
            <legend class="ui-label">Your status</legend>
            <div class="st" role="group" aria-label="Leg status">
              @for (s of statuses; track s) {
                <button type="button" class="st__b" [class.on]="f.status === s" [attr.aria-pressed]="f.status === s"
                        [attr.data-status]="s" (click)="setStatus(s)">{{ statusLabel[s] }}</button>
              }
            </div>
            @if (f.status === 'abandoned') { <p class="ui-sub ls__hint">Dropped: you swapped to another flight.</p> }
            <p class="ui-sub ls__hint">Listing stays your own step, in your airline's app.</p>
          </fieldset>

          <app-leg-passes [trip]="trip()" [leg]="f" />
          <app-leg-files [trip]="trip()" [leg]="f" />

          <section class="ls__sec">
            <h3 class="ui-h3" tabindex="-1" data-backups-h>Backups</h3>
            @for (b of backups(); track b.alt.id) {
              <div class="opt" [attr.data-alt]="b.alt.id">
                <div class="opt__tx">
                  <b class="tn">{{ b.title }}</b>
                  <span class="tn">{{ b.meta }}</span>
                </div>
                @if (canSwap()) {
                  <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost" data-use (click)="useInstead(b.alt)">Use instead</button>
                }
                <button type="button" class="ui-circ ui-circ--glass opt__x" [attr.aria-label]="'Remove backup ' + b.title"
                        (click)="removeAlt(b.alt)"><app-icon name="close" [size]="16" /></button>
              </div>
            } @empty {
              <p class="ui-sub">No backups yet. A backup is another flight you could try if this one doesn't work out.</p>
            }

            @if (adding()) {
              <div class="add" data-add-list>
                @for (r of candidates(); track r.key) {
                  <div class="opt">
                    <div class="opt__tx"><b class="tn">{{ r.title }}</b><span class="tn">{{ r.meta }}</span></div>
                    <button type="button" class="ui-btn ui-btn--sm ui-btn--dark" data-add-one (click)="addAlt(r.it)">Add</button>
                  </div>
                } @empty {
                  <p class="ui-sub" tabindex="-1" data-add-empty>No later option found in our schedule data for this route.</p>
                }
              </div>
            } @else if (!isFinal()) {
              <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost ls__add" data-add (click)="openAdd()">Add a backup</button>
            }
          </section>

          @if (detailsLink(); as l) {
            <a class="ui-btn ui-btn--ghost ui-btn--block" [routerLink]="l.path" [queryParams]="l.query" data-details>
              <app-icon name="plane" [size]="16" /> Open flight details
            </a>
          }
        </div>
      } @else if (ground(); as g) {
        <div class="ls" data-kind="ground">
          <p class="ls__fact tn">
            <span>{{ groundFact() }}</span>
            <app-provenance-tag [value]="g.provenance" />
          </p>
          @if (timetable(); as t) {
            @if (t.source === 'timetable') {
              <p class="ls__fact tn" data-timetable-fact><span>{{ t.timetable?.operator }} timetable · {{ t.timetable?.rideText }} ride</span>
                <app-provenance-tag value="scheduled" /></p>
            }
            @if (timetableLines().length) {
              <p class="ui-sub ls__hint" data-timetable>
                @for (line of timetableLines(); track $index) { {{ line }}@if (!$last) {<br>} }
              </p>
            }
          }

          <app-leg-files [trip]="trip()" [leg]="g" />

          <form class="ed" novalidate (submit)="saveGround($event)" data-ground-editor>
            <h3 class="ui-h3">Your train or bus</h3>
            <label class="fld">
              <span class="ui-label">Mode</span>
              <select [value]="mode()" (change)="mode.set($any($event.target).value)" name="mode">
                @for (m of modes; track m) { <option [value]="m" [selected]="m === mode()">{{ modeLabel[m] }}</option> }
              </select>
            </label>
            <div class="row2">
              <label class="fld"><span class="ui-label">Leaves</span>
                <input type="date" name="depDate" required [value]="depDate()" (input)="depDate.set($any($event.target).value)"></label>
              <label class="fld"><span class="ui-label">At</span>
                <input type="time" name="depTime" required [value]="depTime()" (input)="depTime.set($any($event.target).value)"></label>
            </div>
            <div class="row2">
              <label class="fld"><span class="ui-label">Arrives</span>
                <input type="date" name="arrDate" required [value]="arrDate()" (input)="arrDate.set($any($event.target).value)"></label>
              <label class="fld"><span class="ui-label">At</span>
                <input type="time" name="arrTime" required [value]="arrTime()" (input)="arrTime.set($any($event.target).value)"></label>
            </div>
            <label class="fld"><span class="ui-label">Note</span>
              <input type="text" name="note" maxlength="200" placeholder="Booking code, station, platform…" [value]="note()"
                     (input)="note.set($any($event.target).value)"></label>
            @if (error()) { <p class="ed__err" role="alert">{{ error() }}</p> }
            <button type="submit" class="ui-btn ui-btn--dark ui-btn--block" data-save>Save</button>
          </form>

          <section class="ls__sec">
            <a class="ui-btn ui-btn--dark ui-btn--block" [href]="links().google" target="_blank" rel="noopener" data-onward>
              <app-icon name="external" [size]="16" /> Find onward transport
            </a>
            <p class="ui-sub ls__also">Also:
              <a class="ui-link" [href]="links().rome2rio" target="_blank" rel="noopener">Rome2Rio</a> ·
              <a class="ui-link" [href]="links().omio" target="_blank" rel="noopener">Omio</a> ·
              <a class="ui-link" [href]="links().skyscanner" target="_blank" rel="noopener">Skyscanner</a>
            </p>
          </section>
        </div>
      }
    </app-glass-sheet>
  `,
  styles: [`
    .ls { display: grid; gap: 16px; }
    .ls__fact { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13.5px; color: var(--ink-2); }
    .ls__warn { color: var(--amber-ink); }
    .ls__st { border: 0; margin: 0; padding: 0; display: grid; gap: 8px; min-width: 0; }
    .st { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3px; background: var(--fill); border-radius: 11px; padding: 3px; }
    .st__b {
      min-height: 40px; padding: 6px 4px; border-radius: 8px; font-size: 13px; font-weight: 600; color: var(--ink-2);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .st__b:hover:not(.on) { color: var(--ink); }
    .st__b.on { background: var(--surface); color: var(--ink); box-shadow: 0 1px 3px rgba(0, 0, 0, .1); }
    .ls__hint { font-size: 12.5px; }
    .ls__sec { display: grid; gap: 8px; }
    .opt { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--hair); min-width: 0; }
    .opt:last-child { border-bottom: 0; }
    .opt__tx { flex: 1; min-width: 0; display: grid; }
    .opt__tx b { font-size: 14px; font-weight: 650; }
    .opt__tx span { font-size: 12.5px; color: var(--ink-2); }
    .opt .ui-btn { flex: none; min-height: 40px; }
    .opt__x { width: 40px; height: 40px; }
    .add { background: var(--fill); border-radius: 14px; padding: 4px 12px; }
    .ls__add { justify-self: start; min-height: 40px; }
    .ed { display: grid; gap: 10px; background: var(--fill); border-radius: 18px; padding: 14px; }
    .fld { display: grid; gap: 4px; min-width: 0; }
    .fld input, .fld select {
      height: 44px; padding: 0 12px; border: 1px solid var(--hair); border-radius: 12px; background: var(--surface);
      color: var(--ink); font: 500 15px var(--sans); min-width: 0; width: 100%;
    }
    .row2 { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 8px; }
    .ed__err { color: var(--red-ink); font-size: 13px; }
    .ls__also { text-align: center; }
  `],
})
export class LegSheetComponent {
  private readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);

  readonly trip = input.required<Trip>();
  readonly legId = input.required<string>();
  readonly closed = output<void>();

  protected readonly statuses = SETTABLE_STATUSES;
  protected readonly statusLabel = LEG_STATUS_LABEL;
  protected readonly modes = GROUND_MODES;
  protected readonly modeLabel = MODE_LABEL;

  protected readonly leg = computed(() => legById(this.trip(), this.legId()));
  protected readonly routeOnlyText = ROUTE_ONLY_TEXT;
  protected readonly acUrl = 'https://www.aircanada.com/';
  /** The route network lists every segment: flown, times not in our data. */
  protected readonly routeListed = computed(() => {
    const f = this.flight();
    return !!f && networkListsAll(f.refs);
  });
  protected readonly flight = computed(() => {
    const l = this.leg();
    return l?.kind === 'flight' ? l : null;
  });
  protected readonly ground = computed(() => {
    const l = this.leg();
    return l?.kind === 'ground' ? l : null;
  });

  protected readonly title = computed(() => {
    const f = this.flight();
    if (f) return `${flightNumbers(f.refs)} · ${refsRoute(f.refs)}`;
    const g = this.ground();
    return g ? `${g.from.name} → ${g.to.name}` : 'Leg';
  });

  protected readonly isFinal = computed(() => {
    const f = this.flight();
    return !!f && isFinalStatus(f.status);
  });
  protected readonly canSwap = computed(() => {
    const f = this.flight();
    return !!f && (!isFinalStatus(f.status) || f.status === 'notBoarded');
  });

  /** 'Thu Oct 8 · 17:55 → 06:50⁺¹ · A330-300'. */
  protected readonly factLine = computed(() => {
    const f = this.flight();
    if (!f || !f.refs.length) return '';
    const ac = [...new Set(f.refs.map(r => r.aircraft).filter((a): a is string => !!a))].map(a => shortAircraftName(a).replace(/-/g, '\u2011'));
    return [dayLabel(f.refs[0].dateKey), refsTimes(f.refs, this.state.timeFormat()), ...ac].join(' · ');
  });

  protected readonly backups = computed(() => {
    const f = this.flight();
    if (!f) return [];
    return f.alternates.map(alt => ({ alt, ...this.describe(alt.refs) }));
  });

  protected readonly adding = signal(false);

  /** Later options on the same day, other hubs, then the next day's first (not already a backup). */
  protected readonly candidates = computed<BackupRow[]>(() => {
    const f = this.flight();
    if (!f || !this.adding() || !f.refs.length) return [];
    const it = itineraryFromRefs(f.refs) ?? itineraryFromSnapshot(f.refs);
    if (!it) return [];
    const alts = findAlternatives(it.origin, it.dest, it, this.state.connect());
    const all = [...alts.laterSameRoute, ...alts.otherHubsSameDay, ...(alts.nextDayFirst ? [alts.nextDayFirst] : [])];
    const out: BackupRow[] = [];
    for (const x of all) {
      const refs = refsFromItinerary(x);
      if (sameRefs(refs, f.refs) || f.alternates.some(a => sameRefs(a.refs, refs))) continue;
      const key = refs.map(r => `${r.flightNumber}${r.origin}${r.dateKey}`).join('_');
      if (out.some(o => o.key === key)) continue;
      out.push({ key, it: x, ...this.describe(refs) });
      if (out.length >= 6) break;
    }
    return out;
  });

  protected readonly detailsLink = computed(() => {
    const f = this.flight();
    if (!f || !f.refs.length) return null;
    const first = f.refs[0];
    const last = f.refs[f.refs.length - 1];
    if (!findHub(first.origin) || !findDestination(last.dest)) return null;
    const it = itineraryFromRefs(f.refs);
    return {
      path: flightPath(last.dest, first.dateKey, it),
      query: { ...this.state.globalParams(), from: first.origin },
    };
  });

  // ── Ground editor ─────────────────────────────────────────────────────────
  protected readonly mode = signal<GroundMode>('train');
  protected readonly depDate = signal('');
  protected readonly depTime = signal('');
  protected readonly arrDate = signal('');
  protected readonly arrTime = signal('');
  protected readonly note = signal('');
  protected readonly error = signal('');

  protected readonly groundFact = computed(() => {
    const g = this.ground();
    if (!g) return '';
    const day = dayLabel(g.userTimes?.depDateKey ?? g.dateKey);
    if (g.provenance === 'saved' && g.userTimes) {
      return `${day} · ${MODE_LABEL[g.mode]} ${g.userTimes.depLocal} → ${g.userTimes.arrLocal}`;
    }
    return `${day} · ${groundLabel(g)}`;
  });

  /** The corridor timetable for an unsaved ground leg's day, looked up at render time. */
  protected readonly timetable = computed(() => {
    const g = this.ground();
    if (!g || g.provenance === 'saved') return null;
    const from = g.from.code ? airportEnd(g.from.code) ?? g.from : g.from;
    const est = groundEstimate(from, g.to, { dateKey: g.dateKey });
    return est.timetable ? est : null;
  });
  protected readonly timetableLines = computed(() => {
    const t = this.timetable();
    return t ? groundTimetableLines(t) : [];
  });

  protected readonly links = computed(() => {
    const g = this.ground();
    return g ? onwardLinks(g.from, g.to) : { google: '', rome2rio: '', omio: '', skyscanner: '' };
  });

  constructor() {
    void inject(GroundTimetableService).ensureLoaded();
    // Fill the editor from the leg whenever another leg opens.
    effect(() => {
      const g = this.ground();
      if (!g) return;
      const t = g.userTimes;
      this.mode.set(g.mode);
      this.depDate.set(t?.depDateKey ?? g.dateKey);
      this.depTime.set(t?.depLocal ?? '');
      this.arrDate.set(t?.arrDateKey ?? g.dateKey);
      this.arrTime.set(t?.arrLocal ?? '');
      this.note.set(g.note);
      this.error.set('');
    });
  }

  protected setStatus(s: LegStatus): void {
    const f = this.flight();
    if (!f || f.status === s) return;
    this.trips.setLegStatus(this.trip().id, f.id, s);
  }

  protected useInstead(alt: Alternate): void {
    const f = this.flight();
    if (!f) return;
    const it = itineraryFromRefs(alt.refs) ?? itineraryFromSnapshot(alt.refs);
    if (!it) return;
    const end = airportEnd(it.dest);
    const ground = end ? groundEstimate(end, this.trip().goal) : null;
    this.trips.swapLeg(this.trip().id, f.id, it, ground);
    this.closed.emit();
  }

  protected removeAlt(alt: Alternate): void {
    const f = this.flight();
    if (!f) return;
    const id = this.trip().id;
    const before = f.alternates;
    const idx = before.findIndex(a => a.id === alt.id);
    this.trips.removeAlternate(id, f.id, alt.id);
    // The focused close button is gone: move to the next backup's, else the Backups heading.
    const next = before.filter(a => a.id !== alt.id)[Math.max(0, idx - (idx >= before.length - 1 ? 1 : 0))];
    this.focusAfterRender(next ? `[data-alt="${next.id}"] .opt__x` : '[data-backups-h]');
    this.state.flash(`Removed backup ${flightNumbers(alt.refs)}`, {
      label: 'Undo',
      run: () => this.trips.updateLeg(id, f.id, { alternates: before } as Partial<FlightLeg>),
    });
  }

  protected openAdd(): void {
    this.adding.set(true);
    this.focusAfterRender('[data-add-one], [data-add-empty]');
  }

  private focusAfterRender(selector: string): void {
    afterNextRender(() => {
      (this.host.nativeElement.querySelector(selector) as HTMLElement | null)?.focus();
    }, { injector: this.injector });
  }

  protected addAlt(it: Itinerary): void {
    const f = this.flight();
    if (!f) return;
    this.trips.addAlternate(this.trip().id, f.id, it);
    this.state.flash(`Added ${it.legs.map(l => l.flightNumber ?? 'an estimated leg').join(' + ')} as a backup`);
  }

  protected saveGround(e: Event): void {
    e.preventDefault();
    const g = this.ground();
    if (!g) return;
    const dd = this.depDate(), dt = this.depTime(), ad = this.arrDate(), at = this.arrTime();
    if (!dd || !dt || !ad || !at) {
      this.error.set('Add the departure and arrival dates and times.');
      return;
    }
    // Compare instants: a trip into an earlier zone (Spain → Portugal) can arrive at an earlier clock time.
    const fromTz = endTz(g.from) ?? 'UTC';
    const toTz = endTz(g.to) ?? fromTz;
    if (toUtcMs(ad, at, toTz) < toUtcMs(dd, dt, fromTz)) {
      this.error.set('The arrival is before the departure.');
      return;
    }
    this.error.set('');
    this.trips.saveGroundTimes(this.trip().id, g.id,
      { depDateKey: dd, depLocal: dt, arrDateKey: ad, arrLocal: at }, this.mode(), this.note().trim().slice(0, 200));
    this.state.flash('Saved · Saved by you');
  }

  private describe(refs: FlightLeg['refs']): { title: string; meta: string } {
    const last = refs[refs.length - 1];
    const city = last ? findDestination(last.dest)?.city ?? findHub(last.dest)?.name ?? last.dest : '';
    const first = refs[0];
    const day = first ? WEEKDAY_SHORT[weekdayIndex(first.dateKey)] : '';
    return {
      title: `${flightNumbers(refs)} · ${refsRoute(refs)}`,
      meta: [day, refsTimes(refs, this.state.timeFormat()), city].filter(Boolean).join(' · '),
    };
  }
}

