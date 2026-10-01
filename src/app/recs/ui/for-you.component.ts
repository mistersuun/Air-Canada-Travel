import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { profilePath } from '../../extras/links';
import { AppStateService } from '../../state/app-state.service';
import type { RecGroup, Recommendation } from '../model';
import { ProfileService } from '../profile.service';
import { RecsService } from '../recs.service';
import { RecCardComponent, cardsFor, dismissWithUndo } from './rec-card.component';

/** The fixed honesty line under the heading (extras spec §0.3). */
export const FOR_YOU_LINE = 'Scheduled flights, not seats. No boarding chances.';

/** The key of the "Tell us what you like" card in wideCards(). */
export const TELL_KEY = 'tell';

/**
 * Which cards span both columns of the two-column (desktop) grid, so no card
 * sits alone next to an empty column. Cards flow in runs broken by the
 * full-width "More for you" heading; a run with an odd count widens one card
 * that has an even number of cards before it (so the rows before it stay
 * full): a long weekend first, then a card without a photo, else the last.
 */
export function wideCards(groups: readonly RecGroup[], withTell: boolean): Set<string> {
  type Cell = { key: string; lw: boolean; hero: boolean };
  const runs: Cell[][] = [[]];
  for (const g of groups) {
    if (g.id === 'more') runs.push([]);
    const run = runs[runs.length - 1];
    for (const c of cardsFor(g)) run.push({ key: c.key, lw: g.id.startsWith('lw:'), hero: !!c.hero });
  }
  if (withTell) runs[runs.length - 1].push({ key: TELL_KEY, lw: false, hero: false });
  const wide = new Set<string>();
  for (const run of runs) {
    if (run.length % 2 === 0) continue;
    const even = run.filter((_, i) => i % 2 === 0);
    const pick = even.find(c => c.lw) ?? even.find(c => !c.hero) ?? run[run.length - 1];
    wide.add(pick.key);
  }
  return wide;
}

/**
 * Explore: "For you" (extras spec §6.3, mock x13 left). Long weekends with
 * scheduled flights out and back, starred routes whose season ends soon, and
 * (with a profile) your own log, your styles and an onward idea. Each card
 * ends with "Why this". Everything is computed on this phone.
 */
@Component({
  selector: 'app-for-you',
  standalone: true,
  imports: [RouterLink, IconComponent, RecCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (groups().length) {
      <section class="fy-sec" aria-labelledby="h-foryou" data-for-you>
        <div class="ui-sec-h hd">
          <h2 class="ui-h2 st" id="h-foryou">For you</h2>
          <a [routerLink]="profileLink" [queryParams]="state.globalParams()" data-edit-profile>Edit profile</a>
        </div>
        <p class="line">{{ line }}</p>
        <div class="grid">
          @for (g of groups(); track g.id) {
            @if (g.id === 'more') { <h3 class="ui-label more" data-more>{{ g.title }}</h3> }
            @for (c of cards(g); track c.key) {
              <app-rec-card [class.wide]="wide().has(c.key)" [items]="c.items" [group]="c.group" [hero]="c.hero" [heroTag]="c.heroTag"
                            (dismiss)="dismiss($event)" />
            }
          }
          @if (profile.isEmpty()) {
            <a class="ui-card tell" [class.wide]="wide().has(tellKey)" [routerLink]="profileLink" [queryParams]="state.globalParams()" data-tell>
              <span class="tell__ic"><app-icon name="sparkle" [size]="18" /></span>
              <span class="tell__tx"><b>Tell us what you like</b>&ngsp;<span>Travel profile</span></span>
              <app-icon class="chev" name="chevron-right" [size]="16" />
            </a>
          }
        </div>
        @if (hasWeather()) {
          <p class="foot" data-weather-credit>Typical weather from Open-Meteo (CC BY 4.0). Not a forecast.</p>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .fy-sec { margin-top: 40px; }
    .hd { margin-bottom: 4px; }
    .st { margin: 0; }
    .hd > a { position: relative; padding: 13px 8px; margin: -13px -8px; }
    .line { margin: 0 0 14px; font-size: 13.5px; color: var(--ink-2); }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start; }
    .more { grid-column: 1 / -1; margin: 6px 2px -4px; }
    .tell { display: flex; align-items: center; gap: 12px; padding: 12px 16px; min-height: 56px; color: var(--ink); text-decoration: none; }
    .tell__ic { width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center; flex: none;
      background: color-mix(in srgb, var(--blue) 12%, transparent); color: var(--blue); }
    .tell__tx { flex: 1; display: grid; gap: 1px; min-width: 0; }
    .tell__tx b { font-size: 14.5px; font-weight: 650; }
    .tell__tx span { font-size: 12.5px; color: var(--ink-2); }
    .tell .chev { color: var(--ink-3); }
    .foot { margin: 10px 2px 0; font-size: 12px; color: var(--ink-2); }
    @media (min-width: 900px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
      .wide { grid-column: 1 / -1; }
    }
    @media (max-width: 719px) {
      .fy-sec { margin-top: 22px; }
      .st { font-size: 19px; letter-spacing: -.01em; }
      .line { font-size: 13px; }
    }
  `],
})
export class ForYouComponent {
  protected readonly state = inject(AppStateService);
  protected readonly profile = inject(ProfileService);
  private readonly recs = inject(RecsService);

  protected readonly line = FOR_YOU_LINE;
  protected readonly profileLink = profilePath();
  protected readonly cards = cardsFor;
  protected readonly groups = this.recs.forExplore;
  protected readonly tellKey = TELL_KEY;
  /** Cards that span both desktop columns (see wideCards). */
  protected readonly wide = computed(() => wideCards(this.groups(), this.profile.isEmpty()));
  protected readonly hasWeather = computed(() => this.groups().some(g => g.items.some(r => r.weather)));

  constructor() {
    afterNextRender(() => void this.recs.ensureClimate());
  }

  protected dismiss(r: Recommendation): void {
    dismissWithUndo(this.profile, this.state, r);
  }
}
