import { celebrate } from '../../ui/celebrate';
import { success } from '../../ui/haptics';
import { clearedMessage } from '../../trips/cleared';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { GroundTimetableService } from '../../places/ground-timetable.service';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { AppStateService } from '../../state/app-state.service';
import { PrefsService } from '../../state/prefs.service';
import type { PrepItem } from '../../places/prep';
import { LEG_STATUS_LABEL, type LegStatus, instanceKey } from '../../trips/model';
import { TripsService } from '../../trips/trips.service';
import { LegStatusTagComponent } from '../../trips/ui/leg-status-tag.component';
import { ProvenanceTagComponent } from '../../trips/ui/provenance-tag.component';
import { recoverPath, tripUrl, tripsPath } from '../../ui/links';
import { PlansChangedSheetComponent, type PlansChangedChoice } from './plans-changed-sheet.component';
import { type TodayTarget, resolveToday, statusForTick, todayView } from './today-model';
import { TodayTimelineComponent } from './today-timeline.component';
import { TodayInAirComponent } from './in-air.component';
import { LiveStatusComponent } from '../../live/live-status.component';
import { recoverTarget } from '../../live/flight-status';
import { refDepUtc } from '../../trips/engine/legs';
import { TodayPassComponent } from '../../passes/ui/today-pass.component';

/**
 * Day of travel (/today, optional ?trip=<id>&leg=<legId>): a plain,
 * high-contrast screen with the next flight, the traveller's own latest note,
 * three large buttons (I boarded / I didn't board / Plans changed), what is
 * left to do for this leg and the first same-night backup. Everything comes
 * from the saved trip and the installed schedules: no network calls.
 */
@Component({
  selector: 'app-today-page',
  standalone: true,
  imports: [RouterLink, IconComponent, LegStatusTagComponent, ProvenanceTagComponent, PlansChangedSheetComponent, TodayPassComponent, TodayTimelineComponent, TodayInAirComponent, LiveStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare td">
      <div class="td__top">
        <button type="button" class="ui-circ ui-circ--glass" aria-label="Back" (click)="back()"><app-icon name="arrow-left" [size]="18" /></button>
      </div>
      @if (view(); as v) {
        <p class="ui-label td__eyebrow">{{ v.eyebrow }}</p>
        <h1 class="td__title">{{ v.title }}</h1>

        <section class="ui-card td__flight" aria-label="Your flight">
          <div class="td__row">
            <span class="td__when"><span class="td__time ui-cond tn">{{ v.time }}</span><span class="td__zone" data-zone>{{ v.zone }}</span></span>
            <span class="td__tags"><app-provenance-tag [value]="v.provenance" /><app-leg-status-tag [status]="v.status" /></span>
          </div>
          <p class="td__sub tn">{{ v.sub }}</p>
          <app-live-status [flightNumber]="v.ref.flightNumber" [origin]="v.ref.origin" [depUtc]="depUtc(v.ref)"
                           [recoverLink]="live(v).link" [recoverParams]="live(v).params" [recoverLabel]="live(v).label" />
          @if (v.note; as n) {
            <p class="td__note" data-note>Your note, {{ n.time }}: <b>{{ n.text }}</b></p>
          }
          @if (noteOpen()) {
            <form class="td__nf" (submit)="saveNote($event)">
              <label class="ui-visually-hidden" for="td-note">Note for {{ v.ref.flightNumber }}</label>
              <input id="td-note" class="td__ni" type="text" maxlength="140" autocomplete="off"
                     placeholder="Gate, delay, how many listed…" [value]="draft()" (input)="draft.set($any($event.target).value)" />
              <button type="submit" class="ui-btn ui-btn--dark ui-btn--sm" [disabled]="!draft().trim()">Save</button>
            </form>
          } @else {
            <button type="button" class="ui-link td__add" data-add-note (click)="openNote()">
              {{ v.note ? 'Add a newer note' : 'Add a note (gate, delay, list)' }}
            </button>
          }
        </section>

        <app-today-pass [tripId]="v.tripId" [legId]="v.legId" />
        <app-today-in-air [ref]="v.ref" [status]="v.status" />
        <app-today-timeline [tripId]="v.tripId" [legId]="v.legId" />

        @if (!v.final) {
          <div class="td__acts">
            <button type="button" class="td__big ui-btn ui-btn--dark" data-boarded (click)="boarded($event)">
              <app-icon name="check" [size]="18" [strokeWidth]="2.4" />I boarded
            </button>
            <button type="button" class="td__big td__miss ui-btn" data-not-boarded (click)="notBoarded()">
              <app-icon name="close" [size]="18" [strokeWidth]="2.4" />I didn't board
            </button>
            <button type="button" class="td__big td__chg ui-btn ui-btn--ghost" data-plans-changed (click)="sheetOpen.set(true)">Plans changed</button>
          </div>
        } @else {
          <div class="ui-card td__done" data-final>
            <p tabindex="-1" data-final-msg><b>{{ v.ref.flightNumber }} marked {{ statusLabel(v.status) }}.</b></p>
            <div class="td__done-acts">
              @if (v.status === 'notBoarded' || v.status === 'didntTry') {
                <button type="button" class="ui-btn ui-btn--dark ui-btn--sm" (click)="toRecover()">What can I still reach?</button>
              }
              <a class="ui-btn ui-btn--ghost ui-btn--sm" [routerLink]="tripLink()">Open trip</a>
            </div>
          </div>
        }

        @if (v.left.length) {
          <section class="ui-card td__left" aria-labelledby="td-left">
            <h2 class="ui-label" id="td-left">Left to do</h2>
            @for (item of v.left; track item.id) {
              <button type="button" class="td__chk" role="checkbox" [attr.aria-checked]="item.done" [attr.data-item]="item.id" (click)="tick(item)">
                <span class="td__box" [class.on]="item.done" aria-hidden="true">
                  @if (item.done) { <app-icon name="check" [size]="14" [strokeWidth]="2.6" /> }
                </span>
                <span class="td__ct"><b>{{ item.title }}</b>@if (item.detail) {<small>{{ item.detail }}</small>}</span>
              </button>
            }
          </section>
        }

        @if (v.backup; as b) {
          <button type="button" class="ui-card td__backup" data-backup (click)="toRecover()">
            <span class="td__bic" aria-hidden="true"><app-icon name="clock" [size]="18" [strokeWidth]="2" /></span>
            <span class="td__ct"><b class="tn">{{ b.title }}</b><small>{{ b.detail }}</small></span>
          </button>
        }
        <p class="td__foot">Gate, delay and list numbers are your own notes. Listing stays your own step.</p>
      } @else {
        <div class="td__empty" data-empty>
          <p class="ui-label">Today</p>
          <h1 class="td__title">Nothing planned today</h1>
          <p class="ui-sub">On a day you fly, this page shows your flight, what's left to do and your backups. It works offline.</p>
          <a class="ui-btn ui-btn--dark" [routerLink]="tripsLink">Open Trips</a>
        </div>
      }
    </div>
    @if (sheetOpen()) {
      <app-plans-changed-sheet (choose)="plansChanged($event)" (closed)="sheetOpen.set(false)" />
    }
  `,
  styles: [`
    .td { max-width: 600px; margin-inline: auto; display: flex; flex-direction: column; }
    .td__top { display: flex; margin-bottom: 14px; }
    .td__eyebrow { margin: 0; }
    .td__title { font-size: 30px; font-weight: 700; letter-spacing: -.03em; line-height: 1.1; margin: 4px 0 0; overflow-wrap: anywhere; }
    .td__flight { margin-top: 14px; padding: 16px 18px; }
    .td__row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
    .td__tags { display: inline-flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
    .td__time { font-size: 44px; font-weight: 700; line-height: 1; }
    .td__when { display: inline-flex; align-items: baseline; gap: 8px; min-width: 0; }
    .td__zone { font-size: 13.5px; color: var(--ink-2); white-space: nowrap; }
    .td__sub { margin: 4px 0 0; font-size: 13.5px; color: var(--ink-2); }
    .td__note { margin: 8px 0 0; font-size: 13.5px; color: var(--ink-2); }
    .td__note b { color: var(--ink); font-weight: 650; }
    .td__add { display: inline-flex; align-items: center; min-height: 44px; margin: 2px 0 -10px; font-size: 13.5px; }
    .td__nf { display: flex; gap: 8px; margin-top: 10px; }
    .td__ni {
      flex: 1; min-width: 0; height: 44px; padding: 0 12px; border-radius: 12px;
      border: 1px solid var(--hair); background: var(--fill); color: var(--ink); font-size: 15px;
    }
    .td__ni:focus { outline: 2px solid var(--blue); outline-offset: 0; }
    .td__acts { display: grid; gap: 10px; margin-top: 14px; }
    .td__big { min-height: 56px; padding: 16px; font-size: 16px; border-radius: 16px; }
    .td__miss { background: color-mix(in srgb, var(--red) 12%, transparent); color: var(--red-ink); }
    .td__chg { font-size: 15px; min-height: 52px; }
    .td__done { margin-top: 14px; padding: 14px 16px; }
    .td__done p { margin: 0; font-size: 15px; }
    .td__done-acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .td__done-acts .ui-btn { min-height: 44px; }
    .td__left { margin-top: 14px; padding: 14px 16px 6px; }
    .td__left h2 { margin: 0 0 2px; }
    .td__chk {
      display: flex; align-items: flex-start; gap: 12px; width: 100%; min-height: 48px; padding: 10px 0; text-align: left;
      color: var(--ink); border-bottom: 1px solid var(--hair);
    }
    .td__chk:last-child { border-bottom: 0; }
    .td__box {
      flex: none; width: 22px; height: 22px; border-radius: 6px; border: 1.5px solid var(--hair); margin-top: 1px;
      display: grid; place-items: center; color: #FFFFFF; transition: background var(--dur-fast) var(--ease-out);
    }
    .td__box.on { background: var(--teal); border-color: var(--teal); }
    .td__ct { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .td__ct b { font-size: 15px; font-weight: 600; }
    .td__ct small { font-size: 12.5px; color: var(--ink-2); }
    .td__backup {
      display: flex; gap: 12px; align-items: center; width: 100%; margin-top: 14px; padding: 14px 16px; text-align: left; color: var(--ink);
    }
    .td__bic {
      flex: none; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center;
      background: color-mix(in srgb, var(--amber) 15%, transparent); color: var(--amber-ink);
    }
    .td__foot { margin: 16px 2px 0; font-size: 12px; color: var(--ink-3); }
    .td__empty { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; padding-top: 8px; }
    .td__empty .ui-sub { margin: 0 0 6px; max-width: 46ch; }
    .td__empty .ui-label { margin: 0; }
    @media (min-width: 720px) {
      .td { padding-top: 24px; }
      .td__title { font-size: 34px; }
    }
  `],
})
export class TodayPage {
  private readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  private readonly prefs = inject(PrefsService);
  private readonly router = inject(Router);

  constructor() {
    // Train and bus timetables, so ground legs show their real times even when
    // no other screen loaded them (ground.json is cached by the service worker).
    void inject(GroundTimetableService).ensureLoaded();
  }

  /** ?trip=<id>: show that trip's travel day. ?leg=<legId>: that leg. */
  readonly trip = input<string | undefined>(undefined);
  readonly leg = input<string | undefined>(undefined);

  protected readonly tripsLink = tripsPath();
  protected readonly sheetOpen = signal(false);
  protected readonly noteOpen = signal(false);
  protected readonly draft = signal('');
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  /**
   * The leg this view settled on; kept after "I boarded" so the page doesn't
   * jump to another flight. Remembers the ?trip/?leg it was set under and is
   * ignored once they change (the component is reused across query params).
   */
  private readonly held = signal<{ target: TodayTarget; trip: string | undefined; leg: string | undefined } | null>(null);

  private readonly target = computed<TodayTarget | null>(() => {
    const h = this.held();
    if (h && h.trip === this.trip() && h.leg === this.leg()) return h.target;
    return resolveToday(this.trips.trips(), this.state.nowMs(), this.trip(), this.leg());
  });

  protected readonly view = computed(() => {
    const t = this.target();
    const trip = t ? this.trips.trips().find(x => x.id === t.tripId) : null;
    if (!t || !trip) return null;
    return todayView({
      trip, legId: t.legId, nowMs: this.state.nowMs(), notes: this.trips.notes(), outcomes: this.trips.outcomes(),
      connect: this.state.connect(), fmt: this.prefs.timeFormat(),
    });
  });

  protected readonly tripLink = computed(() => {
    const v = this.view();
    return v ? ['/trips', v.tripId] : this.tripsLink;
  });

  protected depUtc = refDepUtc;

  /** Where "Cancelled" points: Recover, or the Return tab for a return leg. */
  protected live(v: { tripId: string; legId: string; isReturn: boolean; ref: { origin: string } }) {
    return recoverTarget(v.tripId, v.isReturn, v.ref.origin, v.legId);
  }

  protected statusLabel(s: LegStatus): string {
    return LEG_STATUS_LABEL[s];
  }

  protected back(): void {
    this.state.goBack(['/']);
  }

  /** Records "Everyone boarded" for this segment (sets the leg Boarded), with Undo. */
  protected boarded(ev?: Event): void {
    const v = this.view();
    const trip = v && this.trips.trip(v.tripId);
    if (!v || !trip) return;
    this.hold(v.tripId, v.legId);
    const before = v.status;
    const ref = v.ref;
    this.trips.recordOutcome({
      flightNumber: ref.flightNumber, origin: ref.origin, dest: ref.dest, dateKey: ref.dateKey,
      kind: 'allBoarded', partySize: trip.party.count, tripId: trip.id, note: '',
    });
    const key = instanceKey(ref);
    const rec = this.trips.outcomes().find(o => o.tripId === trip.id && instanceKey(o) === key);
    celebrate(ev?.currentTarget as Element | null);
    success();
    this.state.flash(clearedMessage(ref.origin, ref.dest), {
      label: 'Undo',
      run: () => {
        if (rec) this.trips.removeOutcome(rec.id);
        this.trips.setLegStatus(v.tripId, v.legId, before);
      },
    });
    this.focusAfterRender('[data-final-msg], [data-boarded]');
  }

  /** Records "Didn't board" (leg Not boarded) and opens what is still reachable from here. */
  protected notBoarded(): void {
    const v = this.view();
    const trip = v && this.trips.trip(v.tripId);
    if (!v || !trip) return;
    this.hold(v.tripId, v.legId);
    // Read where the traveller is before recording: the view moves on once the outcome is saved.
    const ref = v.ref;
    this.trips.recordOutcome({
      flightNumber: ref.flightNumber, origin: ref.origin, dest: ref.dest, dateKey: ref.dateKey,
      kind: 'noneBoarded', partySize: trip.party.count, tripId: trip.id, note: '',
    });
    this.toRecover(ref.origin, v.tripId, v.legId, v.isReturn);
  }

  protected toRecover(at?: string, tripId?: string, legId?: string, isReturn?: boolean): void {
    const v = this.view();
    const t = tripId ?? v?.tripId;
    if (!t) return;
    if (isReturn ?? v?.isReturn) {
      void this.router.navigateByUrl(tripUrl(t, 'return'));
      return;
    }
    void this.router.navigate(recoverPath(t), { queryParams: { at: at ?? v?.ref.origin, leg: legId ?? v?.legId } });
  }

  protected openNote(): void {
    this.noteOpen.set(true);
    this.focusAfterRender('#td-note');
  }

  private hold(tripId: string, legId: string): void {
    this.held.set({ target: { tripId, legId }, trip: this.trip(), leg: this.leg() });
  }

  /** Moves focus to the first match once the swapped-in content has rendered. */
  private focusAfterRender(selector: string): void {
    afterNextRender(() => {
      (this.host.nativeElement.querySelector(selector) as HTMLElement | null)?.focus();
    }, { injector: this.injector });
  }

  protected plansChanged(choice: PlansChangedChoice): void {
    const v = this.view();
    this.sheetOpen.set(false);
    if (!v) return;
    if (choice === 'pick') {
      this.toRecover();
    } else if (choice === 'dates') {
      void this.router.navigateByUrl(tripUrl(v.tripId, 'return'));
    } else {
      const id = v.tripId;
      const name = this.trips.trip(id)?.name ?? 'Trip';
      this.trips.archive(id);
      this.state.flash(`${name} moved to Past trips`, { label: 'Undo', run: () => this.trips.archive(id, false) });
      void this.router.navigate(tripsPath());
    }
  }

  protected tick(item: PrepItem): void {
    const v = this.view();
    if (!v) return;
    const next = statusForTick(item, v.status);
    if (next && next !== v.status) {
      this.hold(v.tripId, v.legId);
      this.trips.setLegStatus(v.tripId, v.legId, next);
    } else if (item.source === 'manual') {
      this.trips.setPrep(v.tripId, item.id, !item.done);
    }
  }

  protected saveNote(e: Event): void {
    e.preventDefault();
    const v = this.view();
    const text = this.draft().trim();
    if (!v || !text) return;
    const r = v.ref;
    this.trips.addLoadNote({ flightNumber: r.flightNumber, origin: r.origin, dest: r.dest, dateKey: r.dateKey, open: null, listed: null, text });
    this.draft.set('');
    this.noteOpen.set(false);
    this.focusAfterRender('[data-add-note]');
  }
}
