import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
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
import {
  FLICK_COUNT, flickSequence, loadRecent, rememberPick, surpriseCandidates, surpriseLine, surpriseMeta, surprisePick,
} from './surprise';

/** Time the arcs flick for before settling. */
const FLICK_MS = 1000;

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
      <app-icon name="dice" [size]="16" [strokeWidth]="2" /> Surprise me
    </button>
    @if (open()) {
      <app-glass-sheet title="Surprise me" [open]="true" (closed)="close()">
        @if (empty()) {
          <p class="none ui-sub" data-surprise-empty>No destinations match your filters this week.</p>
        } @else {
          <div class="map">
            <app-route-map [hub]="state.hub()" [points]="points()" [highlight]="shown()" [animate]="settled()" view="world" [padding]="10" [pulse]="false" />
          </div>
          <div class="out">
            <p class="ui-visually-hidden" aria-live="polite">{{ settled() ? line() : '' }}</p>
            @if (pick(); as p) {
              <div class="card" [class.card--on]="settled()" [attr.data-surprise-result]="settled() ? '' : null" [attr.aria-hidden]="!settled()">
                @if (settled()) {
                  <app-photo-card [code]="p.destination.code" [title]="p.destination.city" [meta]="meta()" />
                } @else {
                  <div class="skel"></div>
                }
              </div>
              <div class="acts">
                <a class="ui-btn ui-btn--sm" [routerLink]="path(p)" [queryParams]="state.globalParams()" (click)="close()"
                   [attr.aria-disabled]="!settled()" [attr.tabindex]="settled() ? null : -1" [class.off]="!settled()">Open</a>
                <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost" data-surprise-again [attr.aria-disabled]="!settled()"
                        (click)="settled() && spin()">
                  <app-icon name="dice" [size]="16" [strokeWidth]="2" /> Spin again</button>
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
    .skel { width: 100%; height: 100%; border-radius: var(--radius-photo); background: var(--fill); }
    .acts { display: flex; gap: 10px; justify-content: center; margin-top: 12px; }
    .off, [aria-disabled='true'] { opacity: .45; pointer-events: none; }
  `],
})
export class SurpriseSheetComponent {
  protected readonly state = inject(AppStateService);
  private readonly profile = inject(ProfileService);

  /** The list Home is showing (filters applied). */
  readonly entries = input.required<readonly RouteEntry[]>();
  readonly timeFormat = input<TimeFormat>('24h');

  protected readonly open = signal(false);
  protected readonly pick = signal<RouteEntry | null>(null);
  protected readonly shown = signal<string | null>(null);
  protected readonly settled = signal(false);
  protected readonly empty = signal(false);

  private timer: ReturnType<typeof setTimeout> | null = null;

  protected readonly points = computed<MapPoint[]>(() =>
    surpriseCandidates(this.entries()).map(e => ({
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

  protected spin(): void {
    this.clear();
    const entries = this.entries();
    const p = surprisePick(entries, this.profile.profile(), loadRecent(), Math.random, this.state.nowMs());
    this.settled.set(false);
    this.shown.set(null);
    this.pick.set(p);
    this.empty.set(!p);
    if (!p) return;
    rememberPick(p.destination.code);
    if (reducedMotion()) {
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
