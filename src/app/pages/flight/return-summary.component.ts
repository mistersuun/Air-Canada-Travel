import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink, type Params } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { t } from '../../i18n/t';
import {
  type CountCtx, type StayOption, countDay, homeAfterUtc, landingLabel, nearestHomeDays, nightsBetween, stayOptions,
  waysHome,
} from '../../planner/round-trip';
import type { TimeFormat } from '../../state/prefs.service';
import type { Itinerary } from '../../utils/connections';
import { formatClock } from '../../utils/time';
import { dayLabel, prettyFlight } from '../../ui/format';
import { flightSlug, planPath } from '../../ui/links';
import { StayChipsComponent } from '../../ui/stay-chips.component';

/** Ways home listed by time before "+N more". */
export const HOME_TIMES_SHOWN = 3;

/**
 * "Coming home" (dates-spec §3.4): the return day for the flight shown on the
 * Flight page, read-only. With a return day: 'Sat, Nov 28 · 8 nights · 3 ways
 * home', the rule 'after this flight lands (Sat, Nov 21 08:15)' and up to
 * three departure times. Without one: stay chips that count the ways home
 * after this flight lands; a chip emits the return day. The one count source
 * is planner/round-trip waysHome(), so the numbers equal /plan's list for the
 * same outbound. Picking flights happens on /plan ("Plan round trip").
 */
@Component({
  selector: 'app-return-summary',
  standalone: true,
  imports: [RouterLink, IconComponent, StayChipsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ui-card rs" aria-labelledby="fl-ret">
      <h2 class="ui-h3" id="fl-ret">{{ t('planner.flight.coming') }}</h2>
      @if (summary(); as s) {
        <p class="l1 tn" data-ret-line>{{ s.line }}</p>
        <p class="l2 ui-sub tn">{{ rule() }}</p>
        @if (s.times.length) {
          <p class="times tn" data-ret-times [class.times--rows]="s.long">
            @for (x of s.times; track x.key; let last = $last) {
              <span class="tm"><b>{{ x.time }}</b> {{ x.flight }}</span>@if (!last) {<span class="sep" aria-hidden="true"> · </span>}
            }
            @if (s.more) { <span class="more"> {{ t('planner.flight.more', { n: s.more }) }}</span> }
          </p>
        } @else if (s.count.state === 'none') {
          <p class="zero" data-ret-zero>{{ t('planner.plan.noHome', { date: s.date }) }}</p>
          @if (nearest().length) {
            <div class="near">
              <span class="ui-sub">{{ t('planner.plan.nearest') }}</span>
              @for (n of nearest(); track n.key) {
                <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm tn" (click)="pickRet.emit(n.key)">
                  {{ n.label }} · {{ t('planner.count.home', { n: n.n }) }}
                </button>
              }
            </div>
          }
          @if (s.count.hidden) {
            <p class="hid ui-sub">
              {{ t('planner.conn.hidden', { n: s.count.hidden }) }} ·
              <button type="button" class="ui-link" (click)="includeConnections.emit()">{{ t('planner.conn.include') }}</button>
            </p>
          }
        } @else if (s.count.state === 'unpublished') {
          <p class="zero">{{ t('planner.unpublished') }}</p>
        }
      } @else {
        <p class="q">{{ t('planner.chips.question') }}</p>
        <p class="l2 ui-sub tn">{{ rule() }}</p>
        <app-stay-chips [options]="options()" [dep]="dep()" [today]="ctx().today" [compute]="compute()"
                        (pick)="pickRet.emit($event)" />
      }
      <a class="ui-btn ui-btn--ghost ui-btn--block plan" data-plan-round [routerLink]="planLink()" [queryParams]="planQuery()">
        <app-icon name="calendar" [size]="17" /> {{ t('planner.flight.planRound') }}
      </a>
    </section>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .rs { padding: 16px; display: grid; gap: 8px; min-width: 0; }
    .rs h2 { margin: 0; font-size: 19px; }
    .rs p { margin: 0; }
    .l1 { font-size: 16px; font-weight: 650; letter-spacing: -.01em; }
    .q { font-size: 15px; font-weight: 600; }
    .l2 { font-size: 12.5px; }
    .times { font-size: 14px; color: var(--ink-2); line-height: 1.5; }
    .times b { color: var(--ink); font-weight: 650; }
    .tm { white-space: nowrap; }
    .more { color: var(--ink-3); white-space: nowrap; }
    /* Connections make long labels: one way home per line, no separators. */
    .times--rows { display: grid; gap: 2px; }
    .times--rows .sep { display: none; }
    .times--rows .tm { white-space: normal; }
    .zero { font-size: 13.5px; color: var(--ink-2); }
    .near { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .hid { font-size: 12.5px; }
    .hid .ui-link { font-size: 12.5px; }
    .plan { margin-top: 6px; }
    @media (min-width: 1024px) {
      .rs { padding: 20px 22px; }
      .rs h2 { font-size: 22px; letter-spacing: -.02em; }
    }
  `],
})
export class ReturnSummaryComponent {
  protected readonly t = t;

  /** The flight shown on the page. */
  readonly outbound = input.required<Itinerary>();
  readonly hub = input.required<string>();
  readonly code = input.required<string>();
  /** The return day (?ret=), on or after the departure, or null. */
  readonly ret = input<string | null>(null);
  readonly ctx = input.required<CountCtx>();
  readonly timeFormat = input<TimeFormat>('24h');
  /** Global params to carry on the Plan round trip link. */
  readonly params = input<Params>({});

  /** A return day was chosen (a stay chip, or a nearby day). */
  readonly pickRet = output<string>();
  readonly includeConnections = output<void>();

  /** The outbound's local departure date (the nights basis, D1). */
  readonly dep = computed(() => this.outbound().dateKey);
  /** Ways home leave at least the minimum connection time after this flight lands (D3). */
  readonly afterUtc = computed(() => homeAfterUtc(this.outbound(), [], this.ctx().connect));

  protected readonly rule = computed(() =>
    t('planner.after.this', { when: landingLabel(this.outbound(), this.ctx().today, this.timeFormat()) }));

  /** The ways home on the return day: the rows /plan lists for this outbound. */
  readonly ways = computed<Itinerary[]>(() => {
    const r = this.ret();
    return r ? waysHome(this.code(), this.hub(), r, this.ctx(), this.afterUtc()) : [];
  });

  readonly summary = computed(() => {
    const r = this.ret();
    if (!r) return null;
    const ctx = this.ctx();
    const fmt = this.timeFormat();
    const ways = this.ways();
    const count = countDay(r, ways, waysHome(this.code(), this.hub(), r, { ...ctx, showConnections: true }, this.afterUtc()), ctx, fmt, { dep: this.dep() });
    const date = dayLabel(r, ctx.today);
    const what = count.state === 'unpublished' ? t('planner.unpublished') : t('planner.count.waysHome', { n: count.total });
    const sorted = [...ways].sort((a, b) => a.departUtc - b.departUtc);
    return {
      date,
      count,
      line: `${date} · ${t('planner.nights', { n: nightsBetween(this.dep(), r) })} · ${what}`,
      times: sorted.slice(0, HOME_TIMES_SHOWN).map(it => ({
        key: `${it.departUtc}|${it.legs.map(l => l.flightNumber).join('+')}`,
        time: formatClock(it.legs[0].depLocal, fmt),
        flight: it.legs.map(l => (l.estimated ? t('flight.est') : prettyFlight(l.flightNumber))).join(' + '),
      })),
      more: Math.max(0, sorted.length - HOME_TIMES_SHOWN),
      long: sorted.slice(0, HOME_TIMES_SHOWN).some(it => it.legs.length > 1),
    };
  });

  /** Up to two days near the return day with ways home, when it has none. */
  protected readonly nearest = computed(() => {
    const s = this.summary();
    const r = this.ret();
    if (!s || !r || s.count.state !== 'none') return [];
    return nearestHomeDays(this.code(), this.hub(), r, this.dep(), this.ctx(), this.afterUtc())
      .map(n => ({ ...n, label: dayLabel(n.key, this.ctx().today) }));
  });

  readonly options = computed<StayOption[]>(() =>
    stayOptions(this.dep(), this.code(), this.hub(), this.ctx(), this.afterUtc(), this.timeFormat()));

  protected readonly compute = computed(() => {
    const dep = this.dep(), code = this.code(), hub = this.hub(), ctx = this.ctx(), after = this.afterUtc(), fmt = this.timeFormat();
    return (n: number) => stayOptions(dep, code, hub, ctx, after, fmt, [n])[0];
  });

  protected readonly planLink = computed(() => planPath(this.code()));
  readonly planQuery = computed<Params>(() => {
    const p: Params = { ...this.params(), dep: this.dep() };
    const r = this.ret();
    if (r) p['ret'] = r;
    p['out'] = flightSlug(this.outbound());
    return p;
  });
}

