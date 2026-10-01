import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, viewChild,
} from '@angular/core';
import type { TicketModel } from './flight-model';

/**
 * The boarding-pass ticket (`.tk` in the mockup): logo and stops tag, the
 * two airports in condensed type with a dashed arc between them, the times,
 * a dashed cut with a notch on each side, then the cells (DATE, FLIGHT,
 * AIRCRAFT / DURATION, FREQUENCY, TIME DIFF). A connection gets one block of
 * cells per leg, with a layover strip between them (amber when tight or long).
 *
 * The notches sit at 62% of the height as in the mockup, then follow the cut
 * line once it has been measured (a connection makes the ticket taller).
 */
@Component({
  selector: 'app-ticket',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let t = model();
    <article #tk class="tk" [attr.aria-label]="label()">
      <div class="hd">
        <span class="logo">
          <i aria-hidden="true"><svg width="13" height="13" viewBox="0 0 24 24" fill="#fff"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg></i>
          Air Canada
        </span>
        <span class="ui-tag" [class.ui-tag--teal]="t.nonstop" [class.ui-tag--amber]="!t.nonstop">{{ t.tag }}</span>
      </div>
      <div class="pair">
        <div class="end">
          <div class="io">{{ t.origin }}</div>
          <div class="ct">{{ t.originCity }}</div>
        </div>
        <div class="mid" aria-hidden="true">
          <svg viewBox="0 0 120 34">
            <path d="M4 30 Q60 -6 116 30" fill="none" stroke="var(--hair)" stroke-width="2" stroke-dasharray="4 4" />
            <g transform="translate(60 12)">
              <circle r="11" fill="var(--surface)" />
              <path d="M-7 1h14M2-4l5 5-5 5" stroke="var(--red)" stroke-width="2" fill="none" stroke-linecap="round" />
            </g>
          </svg>
          <span class="tn">{{ t.duration }}</span>
        </div>
        <div class="end end--r">
          <div class="io">{{ t.dest }}</div>
          <div class="ct">{{ t.destCity }}</div>
        </div>
      </div>
      <div class="times tn">
        <div><b>{{ t.dep }}</b><span>{{ t.depDate }}</span></div>
        <div class="r"><b>{{ t.arr }}</b><span>{{ t.arrDate }}</span></div>
      </div>
      <div #cut class="cut"></div>
      @for (leg of t.legs; track $index; let i = $index) {
        @if (t.legs.length > 1) {
          <div class="leg tn" [class.leg--first]="i === 0">{{ leg.route }}</div>
        }
        <dl class="cells tn" [class.cells--tight]="t.legs.length > 1">
          @for (c of leg.cells; track c.label) {
            <div [attr.title]="c.title || null"><dt>{{ c.label }}</dt><dd>{{ c.value }}</dd></div>
          }
        </dl>
        @if (leg.estimated) {
          <p class="est">Estimated · verify on aircanada.com</p>
        }
        @if (t.layovers[i]; as l) {
          <div class="lay" [class.lay--alert]="l.alert">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            <span>{{ l.text }}@if (l.reason) { · {{ l.reason }}}</span>
          </div>
        }
      }
    </article>
  `,
  styles: [`
    :host { display: block; }
    .tk {
      --notch-y: 62%;
      background: var(--surface); border-radius: 26px; position: relative;
      box-shadow: var(--shadow-l); border: 1px solid var(--hair);
      -webkit-mask:
        radial-gradient(circle 13px at 0 var(--notch-y), #0000 98%, #000) left / 51% 100% no-repeat,
        radial-gradient(circle 13px at 100% var(--notch-y), #0000 98%, #000) right / 51% 100% no-repeat;
      mask:
        radial-gradient(circle 13px at 0 var(--notch-y), #0000 98%, #000) left / 51% 100% no-repeat,
        radial-gradient(circle 13px at 100% var(--notch-y), #0000 98%, #000) right / 51% 100% no-repeat;
    }
    .hd { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 18px 20px 0; }
    .logo { display: flex; align-items: center; gap: 8px; font-weight: 650; font-size: 14px; }
    .logo i { width: 26px; height: 26px; border-radius: 50%; background: var(--red); display: grid; place-items: center; }
    .pair { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px 6px; }
    .end { min-width: 0; }
    .end--r { text-align: right; }
    .io { font-family: var(--cond); font-size: 58px; font-weight: 600; letter-spacing: -.01em; line-height: .95; }
    .ct { font-size: 12.5px; color: var(--ink-2); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 110px; }
    .end--r .ct { margin-left: auto; }
    .mid { flex: 1; min-width: 0; margin: 0 10px; display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--ink-2); font-size: 11.5px; }
    .mid svg { width: 100%; height: 34px; overflow: visible; }
    .times { display: flex; justify-content: space-between; padding: 0 20px 16px; }
    .times b { font-size: 22px; font-weight: 650; letter-spacing: -.02em; }
    .times span { display: block; font-size: 11.5px; color: var(--ink-2); }
    .times .r { text-align: right; }
    .cut { border-top: 2px dashed var(--hair); margin: 0 22px; }
    .cells { display: grid; grid-template-columns: repeat(3, 1fr); padding: 14px 20px 20px; gap: 14px 10px; margin: 0; }
    .cells--tight { padding-top: 8px; padding-bottom: 14px; }
    .cells div { min-width: 0; }
    .cells dt { font-size: 10.5px; color: var(--ink-3); font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
    .cells dd { margin: 2px 0 0; font-size: 15px; font-weight: 650; overflow-wrap: anywhere; }
    .leg { padding: 12px 20px 0; font-size: 12px; font-weight: 650; color: var(--ink-2); letter-spacing: .02em; }
    .leg--first { padding-top: 14px; }
    .est { margin: -6px 20px 14px; font-size: 12px; font-weight: 600; color: var(--amber); }
    .lay {
      display: flex; align-items: center; gap: 8px; margin: 0 20px; padding: 9px 12px; border-radius: 12px;
      background: var(--fill); color: var(--ink-2); font-size: 12.5px; font-weight: 600;
    }
    .lay--alert { background: color-mix(in srgb, var(--amber) 15%, transparent); color: var(--amber); }
    .lay:last-child { margin-bottom: 20px; }
    @media (max-width: 359px) {
      .io { font-size: 48px; }
      .times b { font-size: 19px; }
    }
  `],
})
export class TicketComponent {
  readonly model = input.required<TicketModel>();
  readonly label = input('Flight ticket');

  private readonly tk = viewChild.required<ElementRef<HTMLElement>>('tk');
  private readonly cut = viewChild.required<ElementRef<HTMLElement>>('cut');

  constructor() {
    let ro: ResizeObserver | null = null;
    afterNextRender(() => {
      const sync = () => {
        const tk = this.tk().nativeElement;
        const y = this.cut().nativeElement.offsetTop;
        if (y > 0) tk.style.setProperty('--notch-y', `${y + 1}px`);
      };
      sync();
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(sync);
        ro.observe(this.tk().nativeElement);
      }
    });
    inject(DestroyRef).onDestroy(() => ro?.disconnect());
  }
}
