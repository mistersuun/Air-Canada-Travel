import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { t } from '../../i18n/t';
import { ClimateService } from '../../recs/climate.service';
import { ProfileService } from '../../recs/profile.service';
import { ReferenceService } from '../../reference/reference.service';
import { AppStateService } from '../../state/app-state.service';
import { ShareService } from '../../state/share.service';
import { calendarPath, destPath } from '../../ui/links';
import { DestPickerComponent } from '../../ui/dest-picker.component';
import { MINUTE_MS } from '../../utils/time';
import {
  MAX_COMPARE, compareColumn, compareParam, compareRows, parseCompareCodes, type CompareColumn, type CompareInput,
} from './compare-model';

/**
 * Compare (/compare?c=LIS,SVQ,OPO): two or three destinations side by side,
 * from the hub, for the selected week or day. The link carries the codes and
 * the app's global params, so sharing it reproduces the view. Facts and
 * counts only; a value is highlighted only where more flights or a shorter
 * flight is objectively better.
 */
@Component({
  selector: 'app-compare-page',
  standalone: true,
  imports: [RouterLink, IconComponent, DestPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page cp">
      <header class="hd">
        <div class="top">
          <button type="button" class="ui-circ ui-circ--glass" [attr.aria-label]="t('ui.back')" (click)="back()"><app-icon name="arrow-left" [size]="18" /></button>
          <h1 class="ui-h1 ttl">{{ t('compare.title') }}</h1>
          <button type="button" class="ui-circ ui-circ--glass share" [attr.aria-label]="t('compare.share')" (click)="share()"><app-icon name="share" [size]="18" /></button>
        </div>
        <p class="ui-sub">{{ t('compare.sub', { hub: state.hub() }) }}</p>
      </header>

      @if (codes().length < 2) {
        <p class="ui-card note" role="status" data-empty>{{ t('compare.empty') }}</p>
      }

      @if (codes().length) {
        <div class="cols ui-snap-row" role="list" [attr.aria-label]="t('compare.colsAria')" [style.--n]="columns().length">
          @for (c of columns(); track c.code; let i = $index) {
            <article class="ui-card col" role="listitem" [attr.data-col]="c.code">
              <div class="col__h">
                <div class="col__t">
                  <h2 class="ui-h3">{{ c.city }} <span class="ui-cond cc">{{ c.code }}</span></h2>
                  <p class="ui-sub">{{ c.country }}</p>
                </div>
                <button type="button" class="ui-circ rm" data-remove [attr.aria-label]="t('compare.remove', { city: c.city })" (click)="remove(c.code)">
                  <app-icon name="close" [size]="16" /></button>
              </div>
              <dl class="facts">
                @for (r of rows(); track r.id) {
                  <div class="f" [class.is-best]="r.cells[i].best" [attr.data-row]="r.id">
                    <dt>{{ r.label }}</dt>
                    <dd class="tn">
                      {{ r.cells[i].text }}
                      @if (r.cells[i].best) { <span class="best" aria-hidden="true">✓</span><span class="ui-visually-hidden"> ({{ t('compare.best') }})</span> }
                      @if (r.cells[i].sub) { <span class="sub">{{ r.cells[i].sub }}</span> }
                    </dd>
                  </div>
                }
              </dl>
              <p class="links">
                <a class="ui-link" [routerLink]="destPath(c.code)" [queryParams]="state.globalParams()">{{ t('compare.destPage', { city: c.city }) }}</a>
                <a class="ui-link" [routerLink]="calendarPath(c.code)" [queryParams]="state.globalParams()">{{ t('compare.calendar') }}</a>
              </p>
            </article>
          }
        </div>
      }

      @if (codes().length < max) {
        @if (picking() || codes().length < 2) {
          <app-dest-picker class="pick" [exclude]="codes()" (picked)="add($event)" (closed)="picking.set(false)" />
        } @else {
          <button type="button" class="ui-btn ui-btn--ghost add" data-add [attr.aria-label]="t('compare.addAria')" (click)="picking.set(true)">
            {{ t('compare.add') }}</button>
        }
      } @else {
        <p class="ui-sub full">{{ t('compare.full') }}</p>
      }

      @if (codes().length >= 2) { <p class="ui-sub foot">{{ t('compare.footer') }}</p> }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .hd { display: flex; flex-direction: column; gap: 6px; }
    .top { display: flex; align-items: center; gap: 12px; }
    .ttl { font-size: 30px; flex: 1; min-width: 0; }
    .note { padding: 18px; margin-top: 12px; font-size: 14px; color: var(--ink-2); }
    .cols { margin-top: 16px; padding-bottom: 4px; }
    .col { flex: 0 0 84%; min-width: 0; padding: 14px; box-sizing: border-box; }
    .col__h { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .col__t { min-width: 0; }
    .cc { font-size: .8em; color: var(--ink-3); }
    .rm { flex: none; width: 44px; height: 44px; margin: -6px -6px 0 0; display: grid; place-items: center; color: var(--ink-2); }
    .facts { margin: 8px 0 0; display: grid; gap: 0; }
    .f { padding: 9px 0; border-top: 1px solid var(--hair); min-width: 0; }
    .f dt { font-size: 12px; color: var(--ink-3); }
    .f dd { margin: 2px 0 0; font-size: 14.5px; font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
    .f.is-best dd { color: var(--teal-ink); }
    .best { margin-left: 4px; font-weight: 700; }
    .sub { display: block; margin-top: 2px; font-size: 12px; font-weight: 400; color: var(--ink-2); }
    .links { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 6px 0 0; }
    .links a { display: inline-flex; align-items: center; min-height: 44px; }
    .pick, .add { margin-top: 12px; }
    .add { width: 100%; }
    .full { margin-top: 12px; }
    .foot { margin-top: 12px; padding: 0 4px; }
    @media (min-width: 720px) {
      .cp { padding-top: 32px; }
      .ttl { font-size: 34px; }
      .cols { display: grid; grid-template-columns: repeat(var(--n, 2), minmax(0, 1fr)); overflow: visible; gap: 16px; }
      .col { flex: none; }
      .pick, .add { max-width: 420px; }
      .foot { max-width: 720px; }
    }
  `],
})
export class ComparePage {
  protected readonly t = t;
  protected readonly state = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly sharer = inject(ShareService);
  private readonly climate = inject(ClimateService);
  private readonly ref = inject(ReferenceService);
  private readonly profile = inject(ProfileService);

  /** ?c= (bound by the router): comma-separated destination codes. */
  readonly c = input<string>();

  protected readonly max = MAX_COMPARE;
  protected readonly picking = signal(false);
  protected readonly destPath = destPath;
  protected readonly calendarPath = calendarPath;

  protected readonly codes = computed(() => parseCompareCodes(this.c()));
  /** The minute: columns need not recompute on every clock tick. */
  private readonly nowMin = computed(() => Math.floor(this.state.nowMs() / MINUTE_MS) * MINUTE_MS);

  private readonly input = computed<CompareInput>(() => ({
    hub: this.state.hub(),
    nowMs: this.nowMin(),
    todayKey: this.state.todayKey(),
    weekStart: this.state.weekStartKey(),
    dayKey: this.state.selectedDateKey(),
    showConnections: this.state.showConnections(),
    connect: this.state.connect(),
    timeFormat: this.state.timeFormat(),
    climate: this.climate.index(),
    advisories: this.ref.advisories(),
    fx: this.ref.fx(),
    visa: this.ref.visa(),
    passports: this.profile.profile().passports,
  }));

  protected readonly columns = computed<CompareColumn[]>(() => {
    const input = this.input();
    return this.codes().map(code => compareColumn(input, code));
  });
  protected readonly rows = computed(() => compareRows(this.columns(), this.input()));

  constructor() {
    void this.climate.ensureLoaded();
    void this.ref.ensureLoaded();
    void this.ref.ensureVisa();
  }

  protected back(): void {
    this.state.goBack(['/']);
  }

  protected share(): void {
    void this.sharer.share(t('compare.title'));
  }

  protected add(code: string): void {
    this.picking.set(false);
    this.setCodes([...this.codes(), code].slice(0, MAX_COMPARE));
  }

  protected remove(code: string): void {
    this.setCodes(this.codes().filter(c => c !== code));
  }

  /** The codes live in the URL (?c=), so the link can be shared; replaceUrl keeps Back going out of the page. */
  private setCodes(codes: string[]): void {
    void this.router.navigate([], {
      queryParams: { c: compareParam(codes) },
      queryParamsHandling: 'merge',
      replaceUrl: true,
      scroll: 'manual',
    });
  }
}
