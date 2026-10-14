import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { ProfileService } from '../../recs/profile.service';
import { AppStateService } from '../../state/app-state.service';
import type { TimeFormat } from '../../state/prefs.service';
import { GlassSheetComponent } from '../../ui/glass-sheet.component';
import { success, tap } from '../../ui/haptics';
import { destPath } from '../../ui/links';
import { PhotoCardComponent } from '../../ui/photo-card.component';
import { MapPoint, RouteMapComponent } from '../../ui/route-map.component';
import type { RouteEntry } from '../../utils/routes';
import { SHARE_ENV, shareText } from '../../share/share-out';
import { airportTz } from '../../utils/airports';
import { MINUTE_MS, todayKey } from '../../utils/time';
import { presetWindow, weekendOptions, windowProblem, type WeekendOption } from '../weekend/weekend-model';
import {
  FLICK_COUNT, dareText, flickSequence, loadRecent, rememberPick, surpriseCandidates, surpriseLine, surpriseMeta, surprisePick,
  weekendEntries,
} from './surprise';
import { t } from '../../i18n/t';

/** Time the arcs flick for before settling. */
const FLICK_MS = 1200;

/**
 * "Surprise me": a die button and a glass sheet. The map flicks through a few
 * candidate arcs, settles on a weighted random pick, then the photo card fades
 * in. Reduced motion skips the flicking. `entries` is the list Home shows, so
 * the active filters apply.
 */
@Component({
  selector: 'app-surprise-sheet',
  standalone: true,
  imports: [RouterLink, IconComponent, GlassSheetComponent, PhotoCardComponent, RouteMapComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost sb" data-surprise (click)="start()" aria-haspopup="dialog">
      <app-icon name="dice" [size]="16" [strokeWidth]="2" /> {{ t('home.surprise.button') }}
    </button>
    @if (open()) {
      <app-glass-sheet [title]="t('home.surprise.button')" [open]="true" (closed)="close()">
        @if (empty() && !weekend()) {
          <p class="none ui-sub" data-surprise-empty>{{ t('home.surprise.emptyFilters') }}</p>
        } @else {
          <label class="wk" for="sb-wk">
            <span>{{ t('home.surprise.thisWeekend') }}</span>
            <input id="sb-wk" type="checkbox" role="switch" class="switch" data-surprise-weekend
                   [checked]="weekend()" (change)="setWeekend($any($event.target).checked)">
          </label>
          <div class="map">
            <app-route-map [hub]="state.hub()" [points]="points()" [highlight]="shown()" [animate]="animateMap()" view="world" [padding]="10" [pulse]="false" />
          </div>
          @if (empty()) {
            <p class="none ui-sub" data-surprise-empty>{{ weekendWhy() ?? t('home.surprise.emptyWeekend') }}</p>
          }
          <div class="out">
            <p class="ui-visually-hidden" aria-live="polite">{{ settled() ? line() : '' }}</p>
            @if (pick(); as p) {
              <div class="card" [class.card--on]="settled()" [attr.data-surprise-result]="settled() ? '' : null" [attr.aria-hidden]="!settled()">
                @if (settled()) {
                  <app-photo-card [code]="p.destination.code" [title]="p.destination.city" [meta]="meta()" />
                } @else {
                  <div class="skel" data-surprise-pending><span>{{ t('home.surprise.picking') }}</span></div>
                }
              </div>
              <!-- The actions appear with the result; until then the row only holds its height. -->
              <div class="acts">
                @if (settled()) {
                  <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost" data-surprise-dare (click)="dare()">
                    <app-icon name="share" [size]="16" [strokeWidth]="2" /> {{ t('home.surprise.dare') }}</button>
                  <a class="ui-btn ui-btn--sm" [routerLink]="path(p)" [queryParams]="state.globalParams()" (click)="close()">{{ t('common.open') }}</a>
                  <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost" data-surprise-again (click)="spin()">
                    <app-icon name="dice" [size]="16" [strokeWidth]="2" /> {{ t('home.surprise.again') }}</button>
                }
              </div>
            }
          </div>
        }
      </app-glass-sheet>
    }
  `,
  styles: [`
    :host { display: inline-block; }
    .sb { gap: 6px; }
    .none { padding: 18px 0 22px; text-align: center; }
    .map { height: 190px; border-radius: var(--radius-photo); overflow: hidden; background: var(--fill); }
    .map app-route-map { display: block; width: 100%; height: 100%; }
    .out { margin-top: 12px; }
    .card { width: min(150px, 45%); margin: 0 auto; aspect-ratio: 3 / 4; }
    .card--on { animation: ui-fade-in var(--dur) var(--ease-out); }
    .skel {
      width: 100%; height: 100%; border-radius: var(--radius-photo); display: grid; place-items: center; padding: 12px;
      background: var(--fill); color: var(--ink-3); font-size: 12.5px; font-weight: 600; text-align: center;
      animation: skel-pulse 1.1s ease-in-out infinite alternate;
    }
    @keyframes skel-pulse { from { opacity: .55; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .skel { animation: none; } }
    .wk { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; margin-bottom: 6px; font-size: 14px; font-weight: 650; cursor: pointer; }
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
    @media (prefers-reduced-motion: reduce) { .switch, .switch::after { transition: none; } }
    .acts { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 12px; min-height: 44px; }
  `],
})
export class SurpriseSheetComponent {
  protected readonly state = inject(AppStateService);
  protected readonly t = t;
  private readonly profile = inject(ProfileService);
  private readonly env = inject(SHARE_ENV);
  private readonly router = inject(Router);

  /** The list Home is showing (filters applied). */
  readonly entries = input.required<readonly RouteEntry[]>();
  readonly timeFormat = input<TimeFormat>('24h');

  protected readonly open = signal(false);
  protected readonly pick = signal<RouteEntry | null>(null);
  protected readonly shown = signal<string | null>(null);
  protected readonly settled = signal(false);
  /** Arc draw-in and plane glide: on from the final highlight (so it draws once, with no blink on settle), off while flicking. */
  protected readonly animateMap = signal(false);
  protected readonly empty = signal(false);
  /** Restrict picks to the Weekend finder's feasible destinations for this weekend. */
  protected readonly weekend = signal(false);

  /** The minute: the weekend search need not rerun on every clock tick. */
  private readonly nowMin = computed(() => Math.floor(this.state.nowMs() / MINUTE_MS) * MINUTE_MS);
  private readonly weekendWindow = computed(() => presetWindow('this', todayKey(airportTz(this.state.hub()), this.nowMin())));
  /** Why this weekend cannot be searched (past, beyond the schedules), or null. */
  protected readonly weekendWhy = computed(() =>
    this.weekend() ? windowProblem(this.weekendWindow(), this.state.hub(), this.nowMin()) : null);

  /** The Weekend finder's options for this weekend (same engine), only worked out once the toggle is on. */
  private readonly weekendOpts = computed<WeekendOption[]>(() => {
    if (!this.weekend() || this.weekendWhy()) return [];
    return weekendOptions({
      hub: this.state.hub(), nowMs: this.nowMin(), window: this.weekendWindow(),
      connect: this.state.connect(), showConnections: this.state.showConnections(),
      codes: this.entries().map(e => e.destination.code),
    });
  });

  /** What picks come from: Home's list, narrowed to this weekend when asked. */
  private readonly scope = computed(() =>
    this.weekend() ? weekendEntries(this.entries(), this.weekendOpts()) : this.entries());

  private timer: ReturnType<typeof setTimeout> | null = null;

  protected readonly points = computed<MapPoint[]>(() =>
    surpriseCandidates(this.scope()).map(e => ({
      code: e.destination.code, lat: e.destination.lat, lng: e.destination.lng, kind: 'direct' as const,
    })));

  protected readonly meta = computed(() => {
    const p = this.pick();
    return p ? surpriseMeta(p, this.state.nowMs(), this.timeFormat()) : '';
  });

  protected readonly line = computed(() => {
    const p = this.pick();
    return p ? surpriseLine(p, this.state.nowMs(), this.timeFormat()) : '';
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clear());
  }

  protected path(e: RouteEntry): string[] {
    return destPath(e.destination.code);
  }

  protected start(): void {
    tap();
    this.open.set(true);
    this.spin();
  }

  protected close(): void {
    this.clear();
    this.open.set(false);
  }

  protected setWeekend(on: boolean): void {
    this.weekend.set(on);
    this.spin();
  }

  protected async dare(): Promise<void> {
    const p = this.pick();
    if (!p) return;
    const w = this.weekend() ? this.weekendOpts().find(o => o.code === p.destination.code) ?? null : null;
    const link = new URL(this.router.serializeUrl(this.router.createUrlTree(destPath(p.destination.code))), globalThis.location?.href).href;
    const text = `${dareText(p, this.state.nowMs(), this.timeFormat(), w)}\n${link}`;
    const r = await shareText(text, t('home.surprise.dare'), this.env());
    if (r === 'copied') this.state.flash(t('common.copied'));
    else if (r === 'failed') this.state.flash(t('common.shareFailed'));
  }

  protected spin(): void {
    this.clear();
    const entries = this.scope();
    const p = surprisePick(entries, this.profile.profile(), loadRecent(), Math.random, this.state.nowMs());
    this.settled.set(false);
    this.animateMap.set(false);
    this.shown.set(null);
    this.pick.set(p);
    this.empty.set(!p);
    if (!p) return;
    rememberPick(p.destination.code);
    if (reducedMotion()) {
      this.animateMap.set(true);
      this.shown.set(p.destination.code);
      this.settled.set(true);
      return;
    }
    const seq = flickSequence(entries, p.destination.code, FLICK_COUNT, Math.random);
    const step = FLICK_MS / seq.length;
    let i = 0;
    const next = (): void => {
      this.shown.set(seq[i]);
      if (i === seq.length - 1) {
        this.animateMap.set(true);
        success();
        this.timer = setTimeout(() => this.settled.set(true), 250);
        return;
      }
      tap();
      i++;
      this.timer = setTimeout(next, step);
    };
    next();
  }

  private clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

function reducedMotion(): boolean {
  try {
    return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
