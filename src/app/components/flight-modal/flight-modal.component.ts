import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, output,
  signal, viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import type { Destination } from '../../data/destinations';
import type { Coverage } from '../../data/schedule-index';
import type { RouteEntry } from '../../utils/routes';
import type { TimeFormat } from '../../state/prefs.service';
import { directItineraries, findItineraries, NO_OPTS, type ConnectOptions, type Itinerary } from '../../utils/connections';
import { nextFlightDate } from '../../utils/week';
import { getOrigins } from '../../utils/airports';
import { getFlag } from '../../utils/flags';
import { regionVar } from '../../utils/region-color';
import { formatDuration, weekKeys } from '../../utils/time';
import { IconComponent } from '../shared/icons.component';
import { PlaneIconComponent } from '../shared/plane-icon.component';
import { OutboundPanelComponent } from './outbound-panel.component';
import { ReturnPanelComponent } from './return-panel.component';
import { MonthCalendarComponent } from './month-calendar.component';
import { isOutside, itinKey, operatesLabel, shortDay, type OutboundDay } from './modal-model';

export type ModalTab = 'outbound' | 'return' | 'calendar';
const TABS: readonly { id: ModalTab; label: string }[] = [
  { id: 'outbound', label: 'Outbound' },
  { id: 'return', label: 'Return' },
  { id: 'calendar', label: 'Calendar' },
];

/** Drag distance (px) that closes the bottom sheet. */
export const DRAG_CLOSE_PX = 120;
const SHEET_QUERY = '(max-width: 719px)';

/**
 * Destination planning dialog.
 *
 * A native <dialog> opened with showModal() after first render: focus is
 * trapped, the page behind is inert, Esc / backdrop / close button close it
 * and (closed) is emitted from the dialog's close event. Focus returns to the
 * element that opened it and the page does not scroll behind it. Under 720px
 * it is a bottom sheet (drag the top down to dismiss); above, a centred panel.
 *
 * Tabs: Outbound (every flight and connection this week, with timelines,
 * .ics export and backups), Return (trip length → ways home) and Calendar
 * (month operating heatmap; a tap moves the app's week and day).
 */
@Component({
  selector: 'app-flight-modal',
  standalone: true,
  imports: [IconComponent, PlaneIconComponent, OutboundPanelComponent, ReturnPanelComponent, MonthCalendarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = destination();
    <dialog #dlg class="ui-sheet fm" aria-labelledby="fm-title" aria-describedby="fm-sub"
            (close)="onClose()" (click)="onDialogClick($event)" (keydown)="onKeydown($event)">
      <div #top class="top" (pointerdown)="dragStart($event)" (pointermove)="dragMove($event)"
           (pointerup)="dragEnd($event)" (pointercancel)="dragEnd($event)">
        <div class="ui-sheet__grabber" aria-hidden="true"></div>
        <div class="bar">
          <span class="flag" aria-hidden="true">{{ flag() }}</span>
          <div class="names">
            <h2 id="fm-title" class="title" tabindex="-1">{{ d.city }}</h2>
            <p id="fm-sub" class="sub">
              {{ d.country }}<span class="region" [style.--c]="region()">{{ d.region }}</span>
            </p>
          </div>
          <div class="acts">
            <button type="button" class="ui-icon-btn fav" [attr.aria-pressed]="isFavourite()"
                    [attr.aria-label]="(isFavourite() ? 'Remove ' : 'Add ') + d.city + (isFavourite() ? ' from' : ' to') + ' starred'"
                    (click)="toggleFavourite.emit()">
              <app-icon name="star" [size]="20" [filled]="isFavourite()" />
            </button>
            <button type="button" class="ui-icon-btn" aria-label="Share link" (click)="share.emit()">
              <app-icon name="share" [size]="20" />
            </button>
            <button #closeBtn type="button" class="ui-icon-btn close" aria-label="Close" (click)="close()">
              <app-icon name="close" [size]="20" />
            </button>
          </div>
        </div>
      </div>

      <div class="body">
        <section class="ticket" aria-label="Route summary">
          <div class="route">
            <div class="end">
              <span class="ui-label">From</span>
              <span class="code">{{ hubCode() }}</span>
              <span class="city">{{ hubName() }}</span>
            </div>
            <div class="ui-route-line" [style.--plane-x]="hero().direct ? '56%' : '80%'">
              <span class="ui-route-line__bar"></span>
              @if (!hero().direct && hero().hub) {
                <span class="ui-route-line__hub" style="--hub-x: 42%">{{ hero().hub }}</span>
              }
              <app-plane-icon class="ui-route-line__plane" [size]="16" />
            </div>
            <div class="end end--r">
              <span class="ui-label">To</span>
              <span class="code">{{ d.code }}</span>
              <span class="city">{{ d.city }}</span>
            </div>
          </div>
          <div class="ui-stub" style="--notch-bg: var(--surface)">
            <div class="ui-stub__grid">
              <div><div class="ui-label">This week</div><div class="ui-stub__value">{{ hero().operates }}</div></div>
              <div><div class="ui-label">{{ hero().direct ? 'Flight time' : 'Fastest' }}</div><div class="ui-stub__value">{{ hero().duration }}</div></div>
              <div><div class="ui-label">Aircraft</div><div class="ui-stub__value">{{ hero().aircraft }}</div></div>
            </div>
          </div>
        </section>

        @if (nextDirect(); as n) {
          <div class="next">
            <app-icon name="clock" [size]="16" />
            <span>No direct flight this week. Next: <strong>{{ n.label }}</strong></span>
            <button type="button" class="ui-btn" (click)="selectDate.emit(n.key)">Go to date</button>
          </div>
        }

        <div class="tabs-wrap">
          <div class="tabs" role="tablist" aria-label="Plan">
            @for (t of tabs; track t.id) {
              <button type="button" role="tab" class="tab" [id]="'fm-tab-' + t.id" [attr.aria-selected]="tab() === t.id"
                      [attr.aria-controls]="'fm-panel-' + t.id" [tabindex]="tab() === t.id ? 0 : -1"
                      (click)="tab.set(t.id)" (keydown)="onTabKey($event)">{{ t.label }}</button>
            }
            <span class="tabs__pill" [style.--i]="tabIndex()" aria-hidden="true"></span>
          </div>
        </div>

        <div class="panel" role="tabpanel" [id]="'fm-panel-' + tab()" [attr.aria-labelledby]="'fm-tab-' + tab()" tabindex="0">
          @switch (tab()) {
            @case ('outbound') {
              <app-outbound-panel [days]="days()" [showConnections]="showConnections()" [timeFormat]="timeFormat()"
                [connect]="connect()" [destName]="d.city" (selectDate)="selectDate.emit($event)"
                (chosen)="outbound.set($event)" />
            }
            @case ('return') {
              <app-return-panel [outbound]="returnBasis()" [hubCode]="hubCode()" [destCode]="d.code" [destName]="d.city"
                [connect]="connect()" [showConnections]="showConnections()" [timeFormat]="timeFormat()"
                [coverage]="coverage()" [(nights)]="returnNights" />
            }
            @case ('calendar') {
              <app-month-calendar [home]="hubCode()" [dest]="d.code" [anchorKey]="selectedDateKey() ?? weekStartKey()"
                [selectedDateKey]="selectedDateKey()" [todayKey]="todayKey()" [coverage]="coverage()"
                [connect]="connect()" [showConnections]="showConnections()" (selectDate)="selectDate.emit($event)" />
            }
          }
        </div>

        <footer class="foot">
          @if (!entry()) {
            <p class="note"><app-icon name="info" [size]="14" /> Hidden from your list by the current filters.</p>
          }
          @if (alsoFrom().length) {
            <p><span class="ui-label">Also flies from</span> {{ alsoFrom().join(' · ') }}</p>
          }
          <p class="ui-muted">Published schedules only, times local at each airport. Not seat availability: verify in the Air Canada app.</p>
        </footer>
      </div>
    </dialog>
  `,
  styles: [`
    :host { display: contents; }
    .fm { padding: 0; overflow: hidden auto; }
    .fm[open] { display: flex; flex-direction: column; }
    .top { position: sticky; top: 0; z-index: 3; background: var(--surface); touch-action: none; padding: 0 12px 0 20px; }
    .bar { display: flex; align-items: center; gap: 12px; padding: 10px 0 8px; }
    .flag { font-size: 30px; line-height: 1; }
    .names { flex: 1; min-width: 0; }
    .title { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 22px; font-weight: 700; letter-spacing: -.01em; line-height: 1.15; outline: none; }
    .sub { margin: 2px 0 0; font-size: 13px; color: var(--ink-2); display: flex; align-items: center; gap: 8px; }
    .region { display: inline-flex; align-items: center; gap: 5px; color: var(--ink-3); }
    .region::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--c); }
    .acts { display: flex; gap: 2px; }
    .fav[aria-pressed='true'] { color: var(--accent); }
    .ui-icon-btn:focus-visible, .tab:focus-visible, .panel:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .body { padding: 4px 16px 20px; display: grid; gap: 14px; }
    .ticket { position: relative; overflow: hidden; padding: 16px; border-radius: var(--radius-card); background: var(--surface-2); border: 1px solid var(--line); }
    .route { display: flex; align-items: center; gap: 14px; }
    .end { display: grid; gap: 3px; min-width: 0; }
    .end--r { text-align: right; justify-items: end; }
    .code { font-family: var(--font-code); font-size: clamp(30px, 9vw, 40px); font-weight: 600; line-height: 1; letter-spacing: .01em; }
    .city { font-size: 12.5px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 110px; }
    .route .ui-route-line__hub { background: var(--surface-2); }
    .next {
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 10px 12px;
      border-radius: 12px; background: var(--accent-soft); color: var(--accent-strong); font-size: 13.5px;
    }
    .next span { flex: 1; min-width: 160px; }
    .next .ui-btn { height: 32px; font-size: 13px; }
    .tabs-wrap { position: sticky; top: calc(var(--fm-top-h, 79px) - 1px); z-index: 2; background: var(--surface); padding: 4px 0 6px; margin: 0 -16px; padding-inline: 16px; }
    .tabs { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); padding: 3px; border-radius: 12px; background: var(--surface-2); }
    .tab {
      all: unset; position: relative; z-index: 1; text-align: center; height: 34px; line-height: 34px; cursor: pointer;
      font-size: 13.5px; font-weight: 600; color: var(--ink-2); border-radius: 9px; transition: color var(--dur) var(--ease-out);
    }
    .tab[aria-selected='true'] { color: var(--ink); }
    .tabs__pill {
      position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / 3); border-radius: 9px;
      background: var(--surface); box-shadow: 0 1px 3px rgba(0, 0, 0, .12), 0 0 0 1px var(--line);
      transform: translateX(calc(var(--i) * 100%)); transition: transform var(--dur) var(--ease-out);
    }
    .panel { margin: 0 -12px; border-radius: 12px; }
    .foot { display: grid; gap: 6px; font-size: 13px; color: var(--ink-2); border-top: 1px solid var(--line); padding-top: 12px; }
    .foot p { margin: 0; }
    .foot .ui-label { margin-right: 6px; }
    .note { display: flex; align-items: center; gap: 6px; color: var(--warn); }
    @media (min-width: 720px) {
      .fm { width: min(600px, calc(100% - 48px)); }
      .top { padding: 8px 14px 0 24px; }
      .body { padding: 4px 24px 24px; }
      .tabs-wrap { margin: 0 -24px; padding-inline: 24px; }
      .city { max-width: 160px; }
    }
  `],
})
export class FlightModalComponent {
  // ── Binding contract (see app.component) ──────────────────────────────────
  readonly destination = input.required<Destination>();
  /** Null when the current filters hide this destination. */
  readonly entry = input<RouteEntry | null>(null);
  readonly hubCode = input('YUL');
  readonly hubName = input('');
  readonly weekStartKey = input.required<string>();
  readonly selectedDateKey = input<string | null>(null);
  readonly todayKey = input<string | null>(null);
  readonly coverage = input<Coverage | null>(null);
  readonly showConnections = input(true);
  readonly connect = input<ConnectOptions>(NO_OPTS);
  readonly timeFormat = input<TimeFormat>('24h');
  readonly isFavourite = input(false);

  readonly closed = output<void>();
  readonly selectDate = output<string>();
  readonly share = output<void>();
  readonly toggleFavourite = output<void>();

  // ── State ─────────────────────────────────────────────────────────────────
  protected readonly tabs = TABS;
  readonly tab = signal<ModalTab>('outbound');
  protected readonly tabIndex = computed(() => TABS.findIndex(t => t.id === this.tab()));
  /** The outbound option expanded in the Outbound tab. */
  readonly outbound = signal<Itinerary | null>(null);
  /** Stay length on the Return tab; kept here so it survives tab switches. */
  readonly returnNights = signal(4);

  private readonly doc = inject(DOCUMENT);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  private readonly closeBtn = viewChild.required<ElementRef<HTMLButtonElement>>('closeBtn');
  private readonly top = viewChild.required<ElementRef<HTMLElement>>('top');
  /** Element focused when the modal opened (the route card), restored on close. */
  private readonly opener: HTMLElement | null;
  private prevOverflow = '';
  private emitted = false;
  private drag: { y: number; dy: number } | null = null;
  private resize: ResizeObserver | null = null;

  // ── Derived data ──────────────────────────────────────────────────────────
  protected readonly flag = computed(() => getFlag(this.destination()));
  protected readonly region = computed(() => regionVar(this.destination().region));

  readonly days = computed<OutboundDay[]>(() => {
    const hub = this.hubCode();
    const dest = this.destination().code;
    const withConn = this.showConnections();
    const opts = this.connect();
    const cov = this.coverage();
    const sel = this.selectedDateKey();
    const today = this.todayKey();
    return weekKeys(this.weekStartKey()).map(dateKey => {
      const outside = isOutside(dateKey, cov);
      return {
        dateKey,
        outside,
        direct: outside ? [] : directItineraries(hub, dest, dateKey),
        connections: outside || !withConn ? [] : findItineraries(hub, dest, dateKey, opts),
        isToday: dateKey === today,
        isSelected: dateKey === sel,
        isPast: !!today && dateKey < today,
      };
    });
  });

  protected readonly hero = computed(() => {
    const days = this.days();
    const direct = days.flatMap(d => d.direct);
    const conns = days.flatMap(d => d.connections);
    if (direct.length) {
      const mins = direct.map(i => i.totalMin);
      const lo = Math.min(...mins);
      const hi = Math.max(...mins);
      const aircraft = [...new Set(direct.flatMap(i => i.legs.map(l => l.aircraft)).filter(Boolean))];
      return {
        direct: true,
        hub: null as string | null,
        operates: operatesLabel(days.filter(d => d.direct.length).map(d => d.dateKey)),
        duration: hi - lo > 20 ? `${formatDuration(lo)}+` : formatDuration(lo),
        aircraft: aircraft.join(' · ') || '—',
      };
    }
    if (conns.length) {
      const best = conns.reduce((a, b) => (b.totalMin < a.totalMin ? b : a));
      const hubs = [...new Set(conns.flatMap(c => c.hubs))];
      return {
        direct: false,
        hub: best.hubs[0] ?? null,
        operates: `Via ${hubs.slice(0, 2).join('/')}`,
        duration: formatDuration(best.totalMin),
        aircraft: [...new Set(best.legs.map(l => l.aircraft).filter(Boolean))].join(' · ') || '—',
      };
    }
    const outside = days.every(d => d.outside);
    return { direct: true, hub: null, operates: outside ? 'Not published' : 'No flights', duration: '—', aircraft: '—' };
  });

  /** Next direct date when this week has none (bounded by coverage). */
  protected readonly nextDirect = computed(() => {
    const days = this.days();
    if (days.some(d => d.direct.length)) return null;
    const today = this.todayKey();
    const start = today && today > days[0].dateKey ? today : days[0].dateKey;
    const key = nextFlightDate(this.hubCode(), this.destination().code, start);
    return key ? { key, label: shortDay(key) } : null;
  });

  /** Outbound for the Return tab: the expanded option, else the selected day's first, else the week's first. */
  protected readonly returnBasis = computed<Itinerary | null>(() => {
    const days = this.days();
    // The expanded option only counts while it is still on screen: the Outbound
    // panel (and its (chosen) output) is destroyed on other tabs, so a date
    // picked in the Calendar can move the week without clearing it.
    const chosen = this.outbound();
    if (chosen) {
      const k = itinKey(chosen);
      if (days.some(d => d.direct.some(i => itinKey(i) === k) || d.connections.some(i => itinKey(i) === k))) return chosen;
    }
    const pick = (d: OutboundDay | undefined) => d?.direct[0] ?? d?.connections[0] ?? null;
    const today = this.todayKey();
    return pick(days.find(d => d.isSelected))
      ?? pick(days.find(d => (d.direct.length || d.connections.length) && (!today || d.dateKey >= today)))
      ?? pick(days.find(d => d.direct.length || d.connections.length))
      ?? null;
  });

  protected readonly alsoFrom = computed(() =>
    getOrigins(this.destination().code).filter(o => o.code !== this.hubCode()).map(o => o.name));

  constructor() {
    const active = this.doc.activeElement;
    this.opener = active instanceof HTMLElement && active !== this.doc.body ? active : null;

    afterNextRender(() => {
      const root = this.doc.documentElement;
      this.prevOverflow = root.style.overflow;
      root.style.overflow = 'hidden';
      root.classList.add('modal-open');
      const d = this.dlg().nativeElement;
      if (!d.open) d.showModal();
      this.closeBtn().nativeElement.focus();
      // The tab bar sticks right under the sticky header, whatever its height.
      const top = this.top().nativeElement;
      const sync = () => d.style.setProperty('--fm-top-h', `${Math.round(top.getBoundingClientRect().height)}px`);
      sync();
      if (typeof ResizeObserver !== 'undefined') {
        this.resize = new ResizeObserver(sync);
        this.resize.observe(top);
      }
    });

    inject(DestroyRef).onDestroy(() => {
      const root = this.doc.documentElement;
      root.style.overflow = this.prevOverflow;
      root.classList.remove('modal-open');
      this.resize?.disconnect();
      this.restoreFocus();
    });
  }

  /** Closes the dialog; its 'close' event emits (closed). */
  close(): void {
    const d = this.dlg().nativeElement;
    if (d.open) d.close();
    else this.onClose();
  }

  protected onClose(): void {
    if (this.emitted) return;
    this.emitted = true;
    this.closed.emit();
  }

  /** Esc closes deterministically (also where the platform lacks a native cancel). */
  protected onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  /** A click on the ::backdrop targets the dialog itself, outside its box. */
  protected onDialogClick(e: MouseEvent): void {
    const d = this.dlg().nativeElement;
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) this.close();
  }

  protected onTabKey(e: KeyboardEvent): void {
    const i = this.tabIndex();
    const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length
      : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? TABS.length - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    this.tab.set(TABS[next].id);
    const btn = this.dlg().nativeElement.querySelector<HTMLElement>(`#fm-tab-${TABS[next].id}`);
    btn?.focus();
  }

  // ── Bottom-sheet drag to dismiss ──────────────────────────────────────────
  private isSheet(): boolean {
    const w = this.doc.defaultView;
    return !!w?.matchMedia && w.matchMedia(SHEET_QUERY).matches;
  }

  protected dragStart(e: PointerEvent): void {
    if (!this.isSheet() || (e.target as Element | null)?.closest('button')) return;
    this.drag = { y: e.clientY, dy: 0 };
    (e.currentTarget as Element | null)?.setPointerCapture?.(e.pointerId);
    this.dlg().nativeElement.style.transition = 'none';
  }

  protected dragMove(e: PointerEvent): void {
    if (!this.drag) return;
    this.drag.dy = Math.max(0, e.clientY - this.drag.y);
    this.dlg().nativeElement.style.transform = `translateY(${this.drag.dy}px)`;
  }

  protected dragEnd(e: PointerEvent): void {
    if (!this.drag) return;
    const dy = Math.max(this.drag.dy, e.clientY - this.drag.y);
    this.drag = null;
    const style = this.dlg().nativeElement.style;
    style.transition = 'transform var(--dur) var(--ease-out)';
    if (dy >= DRAG_CLOSE_PX) {
      this.close();
    } else {
      style.transform = '';
    }
  }

  private restoreFocus(): void {
    const code = this.destination().code;
    const target = this.opener?.isConnected
      ? this.opener
      : this.doc.querySelector<HTMLElement>(`[data-dest-code="${code}"]`);
    target?.focus({ preventScroll: true });
  }
}
