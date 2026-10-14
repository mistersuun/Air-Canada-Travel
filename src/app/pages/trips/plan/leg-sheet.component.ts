import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { t, type MsgKey } from '../../../i18n/t';
import { IconComponent } from '../../../components/shared/icons.component';
import { aboutDuration, airportEnd, groundEstimate, onwardLinks } from '../../../places/ground';
import { GroundTimetableService } from '../../../places/ground-timetable.service';
import { AppStateService } from '../../../state/app-state.service';
import { shortAircraftName } from '../../../trips/engine/facts';
import { alternateSwapPlan } from '../../../trips/engine/alternate-swap';
import { endTz, itineraryFromRefs, itineraryFromSnapshot, refsFromItinerary, sameRefs } from '../../../trips/engine/legs';
import {
  Alternate, FlightLeg, GROUND_MODES, GroundMode, LEG_STATUS_LABEL, LegStatus, Trip, isFinalStatus,
} from '../../../trips/model';
import { TripsService } from '../../../trips/trips.service';
import { capitalizeNote, networkNoteFor } from '../../../data/route-network';
import { ProvenanceTagComponent } from '../../../trips/ui/provenance-tag.component';
import { GlassSheetComponent } from '../../../ui/glass-sheet.component';
import { flightPath } from '../../../ui/links';
import { findDestination, findHub } from '../../../utils/airports';
import { findAlternatives, type Itinerary } from '../../../utils/connections';
import { toUtcMs, weekdayIndex, weekdayShort } from '../../../utils/time';
import {
  MODE_LABEL, dayLabel, flightNumbers, groundLabel, groundRide, legById, refsRoute, refsTimes,
} from '../trips-model';
import { groundTimetableLines } from '../../reach/reach-model';
import { LegFilesComponent } from '../../../files/ui/leg-files.component';
import { ForecastLineComponent } from '../../../recs/ui/forecast-line.component';
import { LegPassesComponent } from '../../../passes/ui/leg-passes.component';
import { OtherWaysComponent } from '../../../places/ui/other-ways.component';

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
  imports: [RouterLink, IconComponent, GlassSheetComponent, ProvenanceTagComponent, LegPassesComponent, LegFilesComponent, ForecastLineComponent, OtherWaysComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-glass-sheet [title]="title()" [open]="true" (closed)="closed.emit()">
      @if (flight(); as f) {
        <div class="ls" data-kind="flight">
          <p class="ls__fact tn">
            <span>{{ factLine() }}</span>
            <app-provenance-tag [value]="f.provenance" />
          </p>
          @if (arrival(); as a) { <p class="ls__fc"><app-forecast-line [code]="a.code" [dateKey]="a.dateKey" /></p> }
          @if (f.provenance === 'unknown') {
            @if (routeNote(); as rn) {
              <p class="ls__warn ui-sub" data-route-only>{{ t('trips.leg.routeOnly', { note: rn }) }}
                <a class="ui-link" [href]="acUrl" target="_blank" rel="noopener">{{ t('trips.leg.openAc') }}</a></p>
            } @else {
              <p class="ls__warn ui-sub">{{ t('trips.leg.notFound') }}</p>
            }
          }

          <fieldset class="ls__st">
            <legend class="ui-label">{{ t('trips.leg.yourStatus') }}</legend>
            <div class="st" role="group" [attr.aria-label]="t('trips.leg.statusAria')">
              @for (s of statuses; track s) {
                <button type="button" class="st__b" [class.on]="f.status === s" [attr.aria-pressed]="f.status === s"
                        [attr.data-status]="s" (click)="setStatus(s)">{{ statusLabel[s] }}</button>
              }
            </div>
            @if (f.status === 'abandoned') { <p class="ui-sub ls__hint">{{ t('trips.leg.dropped') }}</p> }
            <p class="ui-sub ls__hint">{{ t('trips.leg.listingStep') }}</p>
          </fieldset>

          <app-leg-passes [trip]="trip()" [leg]="f" (swapped)="closed.emit()" />
          <app-leg-files [trip]="trip()" [leg]="f" />

          <section class="ls__sec">
            <h3 class="ui-h3" tabindex="-1" data-backups-h>{{ t('trips.leg.backups') }}</h3>
            @for (b of backups(); track b.alt.id) {
              <div class="opt" [attr.data-alt]="b.alt.id">
                <div class="opt__tx">
                  <b class="tn">{{ b.title }}</b>
                  <span class="tn">{{ b.meta }}</span>
                </div>
                @if (canSwap()) {
                  <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost" data-use (click)="useInstead(b.alt)">{{ t('trips.leg.useInstead') }}</button>
                }
                <button type="button" class="ui-circ ui-circ--glass opt__x" [attr.aria-label]="t('trips.leg.removeBackup', { title: b.title })"
                        (click)="removeAlt(b.alt)"><app-icon name="close" [size]="16" /></button>
              </div>
            } @empty {
              <p class="ui-sub">{{ t('trips.leg.noBackups') }}</p>
            }

            @if (adding()) {
              <div class="add" data-add-list>
                @for (r of candidates(); track r.key) {
                  <div class="opt">
                    <div class="opt__tx"><b class="tn">{{ r.title }}</b><span class="tn">{{ r.meta }}</span></div>
                    <button type="button" class="ui-btn ui-btn--sm ui-btn--dark" data-add-one (click)="addAlt(r.it)">{{ t('trips.edit.add') }}</button>
                  </div>
                } @empty {
                  <p class="ui-sub" tabindex="-1" data-add-empty>{{ t('trips.leg.noLater') }}</p>
                }
              </div>
            } @else if (!isFinal()) {
              <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost ls__add" data-add (click)="openAdd()">{{ t('trips.leg.addBackup') }}</button>
            }
          </section>

          @if (detailsLink(); as l) {
            <a class="ui-btn ui-btn--ghost ui-btn--block" [routerLink]="l.path" [queryParams]="l.query" data-details>
              <app-icon name="plane" [size]="16" /> {{ t('trips.leg.details') }}
            </a>
          }
        </div>
      } @else if (ground(); as g) {
        <div class="ls" data-kind="ground">
          <p class="ls__fact tn" data-ride-fact>
            <span>{{ groundFact() }}</span>
            <app-provenance-tag [value]="rideProvenance()" />
          </p>
          @if (ride()?.exit; as x) {
            <p class="ls__fact tn" data-exit-fact><span>{{ t('trips.leg.allow', { label: x.label, dur: hm(x.min) }) }}</span>
              <app-provenance-tag value="estimated" /></p>
          }
          @if (timetable(); as tt) {
            @if (tt.source === 'timetable') {
              <p class="ls__fact tn" data-timetable-fact><span>{{ t('trips.leg.timetable', { operator: tt.timetable?.operator ?? '', ride: tt.timetable?.rideText ?? '' }) }}</span>
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
            <h3 class="ui-h3">{{ t('trips.leg.yourRide') }}</h3>
            <label class="fld">
              <span class="ui-label">{{ t('trips.leg.mode') }}</span>
              <select [value]="mode()" (change)="mode.set($any($event.target).value)" name="mode">
                @for (m of modes; track m) { <option [value]="m" [selected]="m === mode()">{{ modeLabel[m] }}</option> }
              </select>
            </label>
            <div class="row2">
              <label class="fld"><span class="ui-label">{{ t('trips.leg.leaves') }}</span>
                <input type="date" name="depDate" required [value]="depDate()" (input)="depDate.set($any($event.target).value)"></label>
              <label class="fld"><span class="ui-label">{{ t('trips.leg.at') }}</span>
                <input type="time" name="depTime" required [value]="depTime()" (input)="depTime.set($any($event.target).value)"></label>
            </div>
            <div class="row2">
              <label class="fld"><span class="ui-label">{{ t('trips.leg.arrives') }}</span>
                <input type="date" name="arrDate" required [value]="arrDate()" (input)="arrDate.set($any($event.target).value)"></label>
              <label class="fld"><span class="ui-label">{{ t('trips.leg.at') }}</span>
                <input type="time" name="arrTime" required [value]="arrTime()" (input)="arrTime.set($any($event.target).value)"></label>
            </div>
            <label class="fld"><span class="ui-label">{{ t('trips.leg.note') }}</span>
              <input type="text" name="note" maxlength="200" [placeholder]="t('trips.leg.notePh')" [value]="note()"
                     (input)="note.set($any($event.target).value)"></label>
            @if (error(); as e) { <p class="ed__err" role="alert">{{ t(e) }}</p> }
            <button type="submit" class="ui-btn ui-btn--dark ui-btn--block" data-save>{{ t('trips.leg.save') }}</button>
          </form>

          <section class="ls__sec">
            <a class="ui-btn ui-btn--dark ui-btn--block" [href]="links().google" target="_blank" rel="noopener" data-onward>
              <app-icon name="external" [size]="16" /> {{ t('trips.leg.onward') }}
            </a>
            <p class="ui-sub ls__also">{{ t('trips.leg.also') }}
              <a class="ui-link" [href]="links().skyscanner" target="_blank" rel="noopener">{{ skyscanner }}</a>
            </p>
          </section>
          @if (g.provenance !== 'saved') {
            <app-other-ways [from]="g.from" [to]="g.to" [dateKey]="g.dateKey" [toAirport]="g.to.code" [heading]="t('trips.leg.otherWays')" />
          }
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
  /** A brand name, the same in both languages. */
  protected readonly skyscanner = 'Skyscanner';
  protected readonly t = t;
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
  protected readonly acUrl = 'https://www.aircanada.com/';
  /** The route network lists every segment on its date: flown (or starting / paused), times not in our data. */
  protected readonly routeNote = computed(() => {
    const f = this.flight();
    const note = f ? networkNoteFor(f.refs) : null;
    return note ? capitalizeNote(note) : null;
  });
  /** Where and on which local day the flight lands: the forecast is for that day. */
  protected readonly arrival = computed(() => {
    const refs = this.flight()?.refs;
    const last = refs?.[refs.length - 1];
    return last ? { code: last.dest, dateKey: last.arrDateKey } : null;
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
    return g ? `${g.from.name} → ${g.to.name}` : t('trips.leg.title');
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
  protected readonly error = signal<MsgKey | null>(null);

  protected readonly groundFact = computed(() => {
    const g = this.ground();
    if (!g) return '';
    const day = dayLabel(g.userTimes?.depDateKey ?? g.dateKey);
    if (g.provenance === 'saved' && g.userTimes) {
      return `${day} · ${MODE_LABEL[g.mode]} ${g.userTimes.depLocal} → ${g.userTimes.arrLocal}`;
    }
    return `${day} · ${groundLabel(g)}`;
  });

  /** The ride as shown now: Scheduled when an Estimated leg's ride comes from a timetable for its day. */
  protected readonly ride = computed(() => {
    const g = this.ground();
    return g && !(g.provenance === 'saved' && g.userTimes) ? groundRide(g) : null;
  });
  protected readonly rideProvenance = computed(() => this.ride()?.provenance ?? this.ground()?.provenance ?? 'unknown');

  protected hm(min: number): string {
    return aboutDuration(min);
  }

  /** The corridor timetable for an unsaved ground leg's day, looked up at render time. */
  protected readonly timetable = computed(() => {
    const g = this.ground();
    if (!g || g.provenance === 'saved') return null;
    const from = g.from.code ? airportEnd(g.from.code) ?? g.from : g.from;
    const est = groundEstimate(from, g.to, { dateKey: g.dateKey });
    return est.timetable ? est : null;
  });
  protected readonly timetableLines = computed(() => {
    const tt = this.timetable();
    return tt ? groundTimetableLines(tt) : [];
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
      const ut = g.userTimes;
      this.mode.set(g.mode);
      this.depDate.set(ut?.depDateKey ?? g.dateKey);
      this.depTime.set(ut?.depLocal ?? '');
      this.arrDate.set(ut?.arrDateKey ?? g.dateKey);
      this.arrTime.set(ut?.arrLocal ?? '');
      this.note.set(g.note);
      this.error.set(null);
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
    const plan = alternateSwapPlan(this.trip(), f, alt);
    if (!plan) return;
    this.trips.swapLeg(this.trip().id, f.id, plan.it, plan.ground);
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
    this.state.flash(t('trips.leg.removed', { flight: flightNumbers(alt.refs) }), {
      label: t('trips.undo'),
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
    this.state.flash(t('trips.leg.added', { flights: it.legs.map(l => l.flightNumber ?? t('trips.service.estimatedLeg')).join(' + ') }));
  }

  protected saveGround(e: Event): void {
    e.preventDefault();
    const g = this.ground();
    if (!g) return;
    const dd = this.depDate(), dt = this.depTime(), ad = this.arrDate(), at = this.arrTime();
    if (!dd || !dt || !ad || !at) {
      this.error.set('trips.leg.errFill');
      return;
    }
    // Compare instants: a trip into an earlier zone (Spain → Portugal) can arrive at an earlier clock time.
    const fromTz = endTz(g.from) ?? 'UTC';
    const toTz = endTz(g.to) ?? fromTz;
    if (toUtcMs(ad, at, toTz) < toUtcMs(dd, dt, fromTz)) {
      this.error.set('trips.leg.errOrder');
      return;
    }
    this.error.set(null);
    this.trips.saveGroundTimes(this.trip().id, g.id,
      { depDateKey: dd, depLocal: dt, arrDateKey: ad, arrLocal: at }, this.mode(), this.note().trim().slice(0, 200));
    this.state.flash(t('trips.leg.saved'));
  }

  private describe(refs: FlightLeg['refs']): { title: string; meta: string } {
    const last = refs[refs.length - 1];
    const city = last ? findDestination(last.dest)?.city ?? findHub(last.dest)?.name ?? last.dest : '';
    const first = refs[0];
    const day = first ? weekdayShort(weekdayIndex(first.dateKey)) : '';
    return {
      title: `${flightNumbers(refs)} · ${refsRoute(refs)}`,
      meta: [day, refsTimes(refs, this.state.timeFormat()), city].filter(Boolean).join(' · '),
    };
  }
}

