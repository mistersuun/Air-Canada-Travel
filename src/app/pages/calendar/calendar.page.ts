import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, input, linkedSignal, signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { getCoverage } from '../../data/schedule-index';
import { AppStateService } from '../../state/app-state.service';
import { DestRowComponent } from '../../ui/dest-row.component';
import { shortDay } from '../../ui/format';
import { calendarPath, destPath, flightPath } from '../../ui/links';
import { findDestination } from '../../utils/airports';
import { monthKeys } from '../../utils/time';
import { coverageHubFor } from '../../utils/week';
import {
  chooserRows, clampKey, monthRange, moveKey, nextSelection, pickable, selectLabel, type CalField,
} from './cal-model';
import { CalMonthComponent } from './cal-month.component';

/** Months rendered eagerly; the rest wait for the viewport (@defer). */
const EAGER_MONTHS = 3;

/**
 * Calendar (/calendar and /calendar/:code).
 *
 * Without a code: the chooser, a searchable list of destinations (favourites
 * first) leading to /calendar/CODE.
 *
 * With a code: the depart/return range picker. Each day shows how many
 * nonstops fly (the return field shows dest → hub). ?dep= / ?ret= persist
 * with replaceUrl. Done / Select opens /flight/CODE/DEP?ret=RET and moves the
 * app's week to DEP (the old modal calendar's behaviour).
 */
@Component({
  selector: 'app-calendar-page',
  standalone: true,
  imports: [IconComponent, DestRowComponent, CalMonthComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wash" aria-hidden="true"></div>
    @if (dest(); as d) {
      <div class="pk">
        <div class="pk__in">
          <header class="tb">
            <button type="button" class="lnk" (click)="cancel()">Cancel</button>
            <h1 class="ui-h3 tb__t tn">{{ state.hub() }} → {{ d.code }}<span class="ui-sr-only">, {{ d.city }} dates</span></h1>
            <button type="button" class="lnk lnk--b" [disabled]="!sel().dep" (click)="done()">Done</button>
          </header>

          <div class="flds">
            <button type="button" class="fld" [class.on]="sel().active === 'dep'" [attr.aria-pressed]="sel().active === 'dep'"
                    (click)="setField('dep')">
              <span class="fld__l">Depart</span>
              <b class="tn">{{ depLabel() }}</b>
            </button>
            <button type="button" class="fld" [class.on]="sel().active === 'ret'" [attr.aria-pressed]="sel().active === 'ret'"
                    [disabled]="!sel().dep" (click)="setField('ret')">
              <span class="fld__l">Return</span>
              <b class="tn" [class.ph]="!sel().ret">{{ retLabel() }}</b>
            </button>
          </div>
          <p class="ui-sr-only" aria-live="polite">{{ hint() }}</p>

          <div class="wkh" aria-hidden="true">
            @for (w of weekdays; track $index) { <span>{{ w }}</span> }
          </div>

          <div class="months" (keydown)="onKey($event)">
            @for (m of months(); track m; let i = $index) {
              @if (i < eager) {
                <app-cal-month class="mo" [ym]="m" [from]="dir().from" [to]="dir().to" [today]="state.todayKey()"
                               [coverage]="coverage()" [withConnections]="state.showConnections()" [connect]="state.connect()"
                               [dep]="sel().dep" [ret]="sel().ret" [field]="sel().active" [focusKey]="focusKey()"
                               (pick)="pick($event)" />
              } @else {
                @defer (on viewport) {
                  <app-cal-month class="mo" [ym]="m" [from]="dir().from" [to]="dir().to" [today]="state.todayKey()"
                                 [coverage]="coverage()" [withConnections]="state.showConnections()" [connect]="state.connect()"
                                 [dep]="sel().dep" [ret]="sel().ret" [field]="sel().active" [focusKey]="focusKey()"
                                 (pick)="pick($event)" />
                } @placeholder {
                  <div class="mo mo--ph"></div>
                }
              }
            }
          </div>

          <footer class="ft">
            <div class="lg">
              <span><i class="lg__b"></i> more departures</span>
              <span><i class="lg__b lg__b--1"></i> one departure</span>
              @if (state.showConnections()) { <span><i class="lg__b lg__b--c"></i> connection only</span> }
            </div>
            <button type="button" class="ui-btn ui-btn--block" [disabled]="!sel().dep" (click)="done()">{{ select() }}</button>
          </footer>
        </div>
      </div>
    } @else {
      <div class="ui-page ui-page--bare ch">
        <div class="ch__top">
          <button type="button" class="ui-circ ui-circ--glass back" aria-label="Back" (click)="state.goBack(['/'])">
            <app-icon name="arrow-left" [size]="20" />
          </button>
        </div>
        <h1 class="ui-h1">Calendar</h1>
        <p class="ui-sub ch__s">Pick a destination to see which days it flies</p>
        <label class="ui-search ui-glass ch__q">
          <app-icon name="search" [size]="18" />
          <input type="search" data-search-input placeholder="Search destinations" aria-label="Search destinations"
                 [value]="query()" (input)="query.set($any($event.target).value)" />
        </label>
        @if (chooser().saved.length) {
          <h2 class="ui-sec-h ch__h"><span class="ui-h3">Saved</span></h2>
          <div class="ui-card ch__l">
            @for (r of chooser().saved; track r.code) {
              <app-dest-row [code]="r.code" [small]="r.code" [meta]="r.meta" [link]="calendarPath(r.code)" />
            }
          </div>
        }
        @if (chooser().all.length) {
          <h2 class="ui-sec-h ch__h"><span class="ui-h3">All nonstop destinations</span></h2>
          <div class="ui-card ch__l">
            @for (r of chooser().all; track r.code) {
              <app-dest-row [code]="r.code" [small]="r.code" [meta]="r.meta" [link]="calendarPath(r.code)" />
            }
          </div>
        }
        @if (!chooser().saved.length && !chooser().all.length) {
          <p class="ui-sub ch__none">No destinations match “{{ query() }}”.</p>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .wash {
      position: absolute; top: 0; left: 0; right: 0; height: 320px; z-index: 0; pointer-events: none;
      background: linear-gradient(180deg, var(--sky) 0, var(--bg) 280px);
    }
    .ui-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

    /* ── Chooser ── */
    .ch__top { display: flex; margin-bottom: 14px; }
    .ch__s { margin-top: 6px; }
    .ch__q { margin-top: 18px; }
    .ch__h { margin: 22px 0 10px; }
    .ch__l { padding: 4px 14px; }
    .ch__none { margin-top: 22px; text-align: center; }

    /* ── Picker (mobile: full-bleed --surface) ── */
    .pk, .ch { position: relative; }
    .pk { background: var(--surface); min-height: 100dvh; }
    .pk__in { display: flex; flex-direction: column; min-height: 100dvh; }
    .tb {
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
      padding: calc(env(safe-area-inset-top) + 14px) 18px 0;
    }
    .tb__t { white-space: nowrap; }
    .lnk { color: var(--blue); font-size: 15px; padding: 6px 0; min-width: 56px; text-align: left; }
    .lnk--b { font-weight: 600; text-align: right; }
    .lnk:disabled { color: var(--ink-3); cursor: default; }
    .flds { display: flex; gap: 10px; padding: 14px 18px 10px; }
    .fld {
      flex: 1; min-width: 0; text-align: left; padding: 10px 12px; border-radius: 22px; background: var(--fill);
      display: flex; flex-direction: column; gap: 1px; color: var(--ink); font-size: 15px;
      box-shadow: inset 0 0 0 2px transparent; transition: box-shadow var(--dur-fast) var(--ease-out);
    }
    .fld.on { box-shadow: inset 0 0 0 2px var(--red); }
    .fld:disabled { cursor: default; }
    .fld__l { font-size: 11px; color: var(--ink-2); text-transform: uppercase; letter-spacing: .02em; }
    .fld b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fld b.ph { color: var(--ink-3); font-weight: 600; }
    .wkh {
      display: grid; grid-template-columns: repeat(7, 1fr); text-align: center;
      font-size: 11px; font-weight: 600; color: var(--ink-3); padding: 8px 12px;
      border-bottom: 1px solid var(--hair); position: sticky; top: 0; z-index: 3; background: var(--surface);
    }
    .months { padding: 12px 12px 0; flex: 1; }
    .mo { display: block; margin-bottom: 14px; }
    .mo--ph { height: 340px; }
    .ft {
      position: sticky; bottom: 0; z-index: 3; background: var(--surface); border-top: 1px solid var(--hair);
      padding: 14px 18px calc(18px + env(safe-area-inset-bottom));
    }
    .lg { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 11.5px; color: var(--ink-2); margin-bottom: 10px; }
    .lg span { display: inline-flex; align-items: center; gap: 5px; }
    .lg__b { display: inline-block; width: 18px; height: 3px; border-radius: 2px; background: var(--teal); }
    .lg__b--1 { width: 6px; }
    .lg__b--c { width: 6px; background: var(--amber); }

    /* ── Desktop: a centred card on the sky wash ── */
    @media (min-width: 720px) {
      .pk { background: none; min-height: 0; padding: 24px 24px 48px; }
      .pk__in {
        max-width: 880px; margin: 0 auto; min-height: 0;
        background: var(--surface); border: 1px solid var(--hair); border-radius: var(--radius-card);
        box-shadow: var(--shadow);
      }
      .tb { padding: 20px 28px 0; }
      .flds { padding: 16px 28px 12px; }
      .fld { max-width: 260px; }
      .wkh { display: none; }
      .months { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 40px; padding: 8px 28px 0; }
      .ft {
        display: flex; align-items: center; justify-content: space-between; gap: 20px;
        border-radius: 0 0 var(--radius-card) var(--radius-card); padding: 16px 28px;
      }
      .lg { margin: 0; }
      .ft .ui-btn { width: auto; min-width: 300px; }
      .ch { padding-top: 32px; max-width: 760px; }
    }
  `],
})
export class CalendarPage {
  protected readonly state = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** :code (absent on the chooser). */
  readonly code = input<string>();
  /** ?dep= and ?ret= (date keys). */
  readonly dep = input<string>();
  readonly ret = input<string>();

  protected readonly weekdays = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  protected readonly eager = EAGER_MONTHS;
  protected readonly calendarPath = calendarPath;

  // ── Chooser ──
  readonly query = signal('');
  readonly chooser = computed(() =>
    chooserRows(this.state.hub(), this.state.favourites(), this.state.todayKey(), this.query()),
  );

  // ── Picker ──
  readonly dest = computed(() => findDestination(this.code()));
  /** The route's published window (the hub end of it). */
  readonly coverage = computed(() => getCoverage(coverageHubFor(this.state.hub(), this.dest()?.code ?? '')));
  readonly months = computed(() => monthRange(this.state.todayKey(), this.coverage()));

  /** Selection: seeded from ?dep / ?ret, then driven by taps (and written back). */
  readonly sel = linkedSignal(() => {
    const today = this.state.todayKey();
    const cov = this.coverage();
    const dep = pickable(this.dep(), today, cov) ? this.dep()! : null;
    const r = this.ret();
    const ret = dep && pickable(r, today, cov) && r > dep ? r : null;
    return { dep, ret, active: (dep ? 'ret' : 'dep') as CalField };
  });

  /** Availability direction: the return field shows dest → hub. */
  readonly dir = computed(() => {
    const hub = this.state.hub();
    const code = this.dest()?.code ?? '';
    return this.sel().active === 'ret' && this.sel().dep ? { from: code, to: hub } : { from: hub, to: code };
  });

  /** The roving tabindex target in the grid. */
  readonly focusKey = linkedSignal(() => this.sel().dep ?? this.firstPickable());

  readonly select = computed(() => selectLabel(this.sel().dep, this.sel().ret));
  readonly depLabel = computed(() => (this.sel().dep ? shortDay(this.sel().dep!) : 'Add date'));
  readonly retLabel = computed(() => (this.sel().ret ? shortDay(this.sel().ret!) : this.sel().dep ? 'One way' : 'Add date'));
  readonly hint = computed(() => {
    const s = this.sel();
    const city = this.dest()?.city ?? '';
    if (s.active === 'dep' || !s.dep) return `Pick a departure day. Bars show nonstops from ${this.state.hub()}.`;
    return `Pick a return day. Bars show nonstops from ${city}.`;
  });

  private firstPickable(): string {
    const today = this.state.todayKey();
    const from = this.coverage().from;
    return from && from > today ? from : today;
  }

  setField(f: CalField): void {
    if (f === 'ret' && !this.sel().dep) return;
    this.sel.update(s => ({ ...s, active: f }));
  }

  pick(key: string): void {
    const next = nextSelection(this.sel(), key);
    this.sel.set(next);
    this.focusKey.set(key);
    void this.router.navigate([], {
      queryParams: { dep: next.dep, ret: next.ret },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  done(): void {
    const { dep, ret } = this.sel();
    const d = this.dest();
    if (!dep || !d) return;
    this.state.jumpTo(dep);
    const queryParams: Record<string, string> = { ...this.state.globalParams() };
    if (ret) queryParams['ret'] = ret;
    void this.router.navigate(flightPath(d.code, dep), { queryParams });
  }

  cancel(): void {
    const d = this.dest();
    this.state.goBack(d ? destPath(d.code) : ['/']);
  }

  /** Grid keyboard: arrows / PageUp / PageDown / Home / End move the focus; Enter and Space click (native). */
  onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const key = target?.getAttribute?.('data-key');
    if (!key) return;
    const moved = moveKey(key, e.key);
    if (!moved) return;
    e.preventDefault();
    e.stopPropagation();
    const months = this.months();
    const min = `${months[0]}-01`;
    const lastYm = months[months.length - 1];
    const max = `${lastYm}-${String(monthKeys(lastYm).length).padStart(2, '0')}`;
    const next = clampKey(moved, min, max);
    this.focusKey.set(next);
    afterNextRender(() => {
      const el = this.host.nativeElement.querySelector<HTMLElement>(`[data-key="${next}"]`);
      el?.focus();
      el?.scrollIntoView?.({ block: 'nearest' });
    }, { injector: this.injector });
  }
}
