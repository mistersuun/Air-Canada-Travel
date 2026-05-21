import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { formatWeekLabel, formatWeekNavLabel } from '../../utils/week';
import { REGIONS } from '../../data/destinations';

@Component({
  selector: 'app-week-strip',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="week-strip">
      <button class="week-strip__nav" (click)="prev.emit()" [attr.aria-label]="'Go to week of ' + prevLabel">
        ← {{ prevLabel }}
      </button>
      <div class="week-strip__centre">
        <div class="week-strip__label">{{ weekLabel }}</div>
        <div class="week-strip__sub" aria-live="polite">{{ routeCount }} routes with departures</div>
      </div>
      <button class="week-strip__nav" (click)="next.emit()" [attr.aria-label]="'Go to week of ' + nextLabel">
        {{ nextLabel }} →
      </button>
    </div>

    <div class="filter-chips" role="group" aria-label="Filter by region">
      <button
        *ngFor="let r of regions"
        class="chip"
        [class.chip--active]="activeRegion === r"
        [attr.aria-pressed]="activeRegion === r"
        (click)="regionSelected.emit(r)"
      >{{ r === 'All' ? 'All regions' : r }}</button>
    </div>
  `,
  styles: [`
    .week-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 24px;
      background: #fafafa;
      border-bottom: 1px solid #f2f2f2;
      position: sticky;
      top: 52px;
      z-index: 90;
    }
    .week-strip__nav {
      background: none; border: none; cursor: pointer;
      font-size: 13px; font-weight: 600; color: #C8102E;
      font-family: inherit; padding: 4px 0;
    }
    .week-strip__nav:focus-visible { outline: 2px solid #C8102E; outline-offset: 2px; border-radius: 4px; }
    .week-strip__centre { text-align: center; }
    .week-strip__label { font-size: 15px; font-weight: 700; color: #1d1d1f; letter-spacing: -0.2px; }
    .week-strip__sub { font-size: 12px; color: #86868b; margin-top: 1px; }

    .filter-chips {
      display: flex;
      gap: 6px;
      padding: 10px 24px;
      border-bottom: 1px solid #f2f2f2;
      overflow-x: auto;
      background: #fff;
      position: sticky;
      top: 100px;
      z-index: 89;
    }
    .filter-chips::-webkit-scrollbar { display: none; }
    .chip {
      padding: 5px 14px; border-radius: 999px;
      font-size: 12px; font-weight: 500; font-family: inherit;
      border: 1px solid #e0e0e0;
      background: #fff; color: #1d1d1f;
      white-space: nowrap; cursor: pointer; flex-shrink: 0;
      transition: background 0.12s, color 0.12s;
    }
    .chip--active { background: #1d1d1f; color: #fff; border-color: #1d1d1f; }
    .chip:focus-visible { outline: 2px solid #C8102E; outline-offset: 2px; }

    @media (max-width: 600px) {
      .week-strip { padding: 10px 16px; }
      .week-strip__sub { display: none; }
      .week-strip__label { font-size: 14px; }
      .filter-chips { padding: 8px 16px; }
    }
  `]
})
export class WeekStripComponent {
  @Input() weekStart!: Date;
  @Input() routeCount = 0;
  @Input() activeRegion = 'All';
  @Output() prev = new EventEmitter<void>();
  @Output() next = new EventEmitter<void>();
  @Output() regionSelected = new EventEmitter<string>();

  readonly regions = REGIONS;

  get weekLabel(): string {
    return formatWeekLabel(this.weekStart);
  }

  get prevLabel(): string {
    const d = new Date(this.weekStart);
    d.setDate(d.getDate() - 7);
    return formatWeekNavLabel(d);
  }

  get nextLabel(): string {
    const d = new Date(this.weekStart);
    d.setDate(d.getDate() + 7);
    return formatWeekNavLabel(d);
  }
}
