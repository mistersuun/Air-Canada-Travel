import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IconComponent } from '../../components/shared/icons.component';
import { t } from '../../i18n/t';
import { ProfileService } from '../../recs/profile.service';
import { AppStateService } from '../../state/app-state.service';
import { SegComponent, SegOption } from '../../ui/seg.component';
import { HUBS } from '../../data/destinations';
import { airportTz } from '../../utils/airports';
import { addDays, formatClock, formatKey, isDateKey, todayKey } from '../../utils/time';
import {
  COMMUTE_BUFFERS, CommuteInput, CommuteOption, DEFAULT_COMMUTE_BUFFER, DEFAULT_RELEASE_HHMM, DEFAULT_REPORT_HHMM,
  commuteAirports, commuteDays, commuteOptions, commuteProblem, tripHomeOptions,
} from './commute-model';

type View = 'day' | 'range';

/**
 * Commute to base (/commute): for crew who live in one city and report at a
 * hub. Lists the scheduled flights home → base that arrive a set buffer before
 * report, a 14-day count, and the trip home after duty. Settings live in the
 * travel profile on this phone (never in share links or backups). Counts and
 * times only; published schedules, not seats.
 */
@Component({
  selector: 'app-commute-page',
  standalone: true,
  imports: [IconComponent, SegComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page cm">
      <header class="hd">
        <div class="top">
          <button type="button" class="ui-circ ui-circ--glass" [attr.aria-label]="t('ui.back')" (click)="back()"><app-icon name="arrow-left" [size]="18" /></button>
          <h1 class="ui-h1 ttl">{{ t('commute.title') }}</h1>
        </div>
        <p class="ui-sub">{{ t('commute.sub') }}</p>
      </header>

      <h2 class="ui-label lbl">{{ t('commute.settings') }}</h2>
      <div class="ui-card set">
        <label class="fld">
          <span>{{ t('commute.home') }}</span>
          <select data-home [value]="home()" (change)="setHome($any($event.target).value)">
            <option value="" [selected]="!home()">{{ t('commute.homePick') }}</option>
            @for (a of airports; track a.code) {
              <option [value]="a.code" [selected]="a.code === home()">{{ a.name }} ({{ a.code }})</option>
            }
          </select>
        </label>
        <label class="fld">
          <span>{{ t('commute.base') }}</span>
          <select data-base [value]="base()" (change)="setBase($any($event.target).value)">
            @for (h of hubs; track h.code) {
              <option [value]="h.code" [selected]="h.code === base()">{{ h.name }} ({{ h.code }})</option>
            }
          </select>
        </label>
        <div class="fld">
          <span id="cm-buf">{{ t('commute.buffer') }}</span>
          <div class="chips" role="group" aria-labelledby="cm-buf">
            @for (b of buffers; track b) {
              <button type="button" class="chip" [attr.data-buffer]="b" [attr.aria-pressed]="buffer() === b" (click)="setBuffer(b)">{{ t('commute.bufferOpt', { n: b }) }}</button>
            }
          </div>
        </div>
        <p class="ui-sub">{{ t('commute.saved') }}</p>
      </div>

      @if (problem(); as why) {
        <p class="ui-card note" role="status" data-problem>{{ why === 'home' ? t('commute.needHome') : t('commute.same') }}</p>
      } @else {
        <app-seg class="vw" stretch [ariaLabel]="t('commute.view')" [options]="viewOptions()" [value]="view()" (valueChange)="view.set($event === 'range' ? 'range' : 'day')" />

        <div class="ui-card inputs">
          @if (view() === 'day') {
            <label class="fld">
              <span>{{ t('commute.reportDate') }}</span>
              <input type="date" data-report-date [attr.aria-label]="t('commute.dateAria')" [value]="reportKey()" (change)="setReportDate($any($event.target).value)">
            </label>
          }
          <label class="fld">
            <span>{{ t('commute.reportTime', { base: base() }) }}</span>
            <input type="time" data-report-time [attr.aria-label]="t('commute.timeAria')" [value]="reportHhmm()" (change)="setReportTime($any($event.target).value)">
          </label>
        </div>

        @if (view() === 'day') {
          @let r = result();
          <h2 class="ui-h3 sum" data-summary>{{ r.count ? t('commute.summary', { n: r.count, time: clock(r.deadlineHhmm) }) : t('commute.summaryNone', { time: clock(r.deadlineHhmm) }) }}</h2>
          <p class="ui-sub tn">{{ t('commute.summarySub', { date: stamp(reportKey()), report: clock(reportHhmm()), buffer: buffer(), home: home(), base: base() }) }}
            @if (r.count && r.nonstopCount < r.count) { · {{ t('commute.nonstopOf', { n: r.nonstopCount }) }} }</p>
          @if (r.count) {
            <ul class="ui-card list" role="list" data-options>
              @for (o of r.options; track o.itinerary.departUtc + o.flights.join()) {
                <li class="row" [attr.data-latest]="o.latest || null">
                  <div class="times tn"><b>{{ clock(o.departHhmm) }} → {{ clock(o.arriveHhmm) }}</b>
                    <span class="fl">{{ o.flights.join(' + ') }} · {{ via(o) }}</span></div>
                  <span class="tags">
                    @if (o.dayBefore) { <span class="ui-tag ui-tag--neutral">{{ t('commute.dayBefore') }}</span> }
                    @if (o.latest) { <span class="ui-tag">{{ t('commute.last') }}</span> }
                  </span>
                </li>
              }
            </ul>
          }

          <h2 class="ui-label lbl">{{ t('commute.homeTitle') }}</h2>
          <div class="ui-card inputs">
            <label class="fld">
              <span>{{ t('commute.releaseDate') }}</span>
              <input type="date" data-release-date [attr.aria-label]="t('commute.releaseDateAria')" [value]="releaseKey()" (change)="setReleaseDate($any($event.target).value)">
            </label>
            <label class="fld">
              <span>{{ t('commute.releaseTime', { base: base() }) }}</span>
              <input type="time" data-release-time [attr.aria-label]="t('commute.releaseTimeAria')" [value]="releaseHhmm()" (change)="setReleaseTime($any($event.target).value)">
            </label>
          </div>
          <p class="ui-sub tn">{{ t('commute.homeSub', { base: base(), home: home() }) }}</p>
          @let h = tripHome();
          <p class="ui-h3 sum" data-home-summary>{{ h.length ? t('commute.homeCount', { n: h.length, time: clock(releaseHhmm()) }) : t('commute.homeNone', { time: clock(releaseHhmm()) }) }}</p>
          @if (h.length) {
            <ul class="ui-card list" role="list" data-home-options>
              @for (o of h; track o.itinerary.departUtc + o.flights.join()) {
                <li class="row">
                  <div class="times tn"><b>{{ clock(o.departHhmm) }} → {{ clock(o.arriveHhmm) }}</b>
                    <span class="fl">{{ o.flights.join(' + ') }} · {{ via(o) }}</span></div>
                </li>
              }
            </ul>
          }
        } @else {
          <p class="ui-sub tn">{{ t('commute.rangeSub', { time: clock(rangeDeadline()), report: clock(reportHhmm()), buffer: buffer(), base: base() }) }}</p>
          <ul class="ui-card list" role="list" data-days>
            @for (d of days(); track d.dateKey) {
              <li class="row" [attr.data-fewer]="d.fewer || null">
                <div class="times tn"><b>{{ stamp(d.dateKey) }}</b>
                  <span class="fl">
                    @if (d.count === null) { {{ t('commute.noSchedule') }} }
                    @else if (d.count === 0) { {{ t('commute.rangeNone', { time: clock(rangeDeadline()) }) }} }
                    @else { {{ t('commute.rangeCount', { n: d.count, time: clock(rangeDeadline()) }) }}@if (d.lastHhmm) { · {{ t('commute.lastArrives', { time: clock(d.lastHhmm) }) }} } }
                  </span></div>
                <span class="tags">
                  @if (d.fewer) { <span class="ui-tag ui-tag--neutral">{{ t('commute.fewer') }}</span> }
                </span>
              </li>
            }
          </ul>
        }
      }
      <p class="ui-sub foot">{{ t('commute.footer') }}</p>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .hd { display: flex; flex-direction: column; gap: 6px; }
    .top { display: flex; align-items: center; gap: 12px; }
    .ttl { font-size: 30px; }
    .lbl { margin: 18px 4px 8px; font-size: 10.5px; }
    .set, .inputs { display: grid; gap: 14px; padding: 14px; margin-top: 12px; }
    .set { margin-top: 0; }
    .fld { display: flex; flex-direction: column; gap: 6px; min-width: 0; font-size: 13px; font-weight: 600; color: var(--ink-2); }
    select, input[type='date'], input[type='time'] {
      min-height: 44px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--hair);
      background: var(--bg); color: var(--ink); font: inherit; font-weight: 500; min-width: 0;
    }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      min-height: 44px; padding: 8px 14px; border-radius: 999px; font-size: 13.5px; font-weight: 600; color: var(--ink);
      background: var(--fill); border: 1px solid transparent; cursor: pointer;
    }
    .chip[aria-pressed='true'] { background: var(--ink); color: var(--bg); }
    .vw { margin-top: 16px; }
    .note { padding: 18px; margin-top: 12px; font-size: 14px; color: var(--ink-2); }
    .sum { margin: 16px 4px 4px; }
    .list { list-style: none; padding: 4px 14px; margin: 12px 0 0; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 52px; padding: 8px 0; }
    .row + .row { border-top: 1px solid var(--hair); }
    .times { display: grid; gap: 2px; font-size: 15px; }
    .fl { font-size: 12.5px; color: var(--ink-2); }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .foot { margin-top: 16px; padding: 0 4px; }
    @media (min-width: 720px) {
      .cm { padding-top: 32px; max-width: 720px; }
      .ttl { font-size: 34px; }
    }
  `],
})
export class CommutePage {
  protected readonly t = t;
  protected readonly state = inject(AppStateService);
  private readonly profile = inject(ProfileService);

  protected readonly airports = commuteAirports();
  protected readonly hubs = HUBS;
  protected readonly buffers = COMMUTE_BUFFERS;

  private readonly saved = this.profile.profile().commute;
  protected readonly home = signal(this.saved?.home ?? '');
  protected readonly base = signal(this.saved?.base ?? (HUBS.some(h => h.code === this.state.hub()) ? this.state.hub() : HUBS[0].code));
  protected readonly buffer = signal(this.saved?.bufferMin ?? DEFAULT_COMMUTE_BUFFER);

  protected readonly view = signal<View>('day');
  private readonly reportDate = signal<string | null>(null);
  protected readonly reportHhmm = signal(DEFAULT_REPORT_HHMM);
  private readonly releaseDate = signal<string | null>(null);
  protected readonly releaseHhmm = signal(DEFAULT_RELEASE_HHMM);

  protected readonly viewOptions = computed<SegOption[]>(() => [
    { value: 'day', label: t('commute.view.day') },
    { value: 'range', label: t('commute.view.range') },
  ]);

  /** Today at base (flight dates are base-local at the arrival end). */
  private readonly baseToday = computed(() => todayKey(airportTz(this.base()), this.state.nowMs()));
  protected readonly reportKey = computed(() => this.reportDate() ?? addDays(this.baseToday(), 1));
  protected readonly releaseKey = computed(() => this.releaseDate() ?? this.reportKey());

  protected readonly problem = computed(() => commuteProblem(this.home(), this.base()));

  /** The minute: results need not recompute on every clock tick. */
  private readonly input = computed<CommuteInput>(() => ({
    home: this.home(), base: this.base(), bufferMin: this.buffer(),
    nowMs: Math.floor(this.state.nowMs() / 60_000) * 60_000,
    showConnections: this.state.showConnections(), connect: this.state.connect(),
  }));

  protected readonly result = computed(() => commuteOptions(this.input(), this.reportKey(), this.reportHhmm()));
  protected readonly days = computed(() => commuteDays(this.input(), this.reportHhmm(), this.baseToday()));
  protected readonly tripHome = computed(() => tripHomeOptions(this.input(), this.releaseKey(), this.releaseHhmm()));
  /** Latest arrival time that works, same for every day of the range. */
  protected readonly rangeDeadline = computed(() => commuteOptions(this.input(), this.baseToday(), this.reportHhmm()).deadlineHhmm);

  protected setHome(code: string): void { this.home.set(code); this.save(); }
  protected setBase(code: string): void { this.base.set(code); this.save(); }
  protected setBuffer(min: number): void { this.buffer.set(min); this.save(); }
  protected setReportDate(key: string): void { if (isDateKey(key)) this.reportDate.set(key); }
  protected setReportTime(v: string): void { if (/^\d\d:\d\d$/.test(v)) this.reportHhmm.set(v); }
  protected setReleaseDate(key: string): void { if (isDateKey(key)) this.releaseDate.set(key); }
  protected setReleaseTime(v: string): void { if (/^\d\d:\d\d$/.test(v)) this.releaseHhmm.set(v); }

  /** Saves once the settings are valid (a home airport that is not the base). */
  private save(): void {
    if (this.problem()) return;
    this.profile.setCommute({ home: this.home(), base: this.base(), bufferMin: this.buffer() });
  }

  protected via(o: CommuteOption): string {
    return o.nonstop ? t('commute.nonstop') : t('commute.stops', { n: o.itinerary.hubs.length, via: o.itinerary.hubs.join(', ') });
  }

  protected clock(hhmm: string): string {
    return formatClock(hhmm, this.state.timeFormat());
  }

  protected stamp(key: string): string {
    return isDateKey(key) ? formatKey(key, { weekday: 'short', month: 'short', day: 'numeric' }) : '…';
  }

  protected back(): void {
    this.state.goBack(['/']);
  }
}
