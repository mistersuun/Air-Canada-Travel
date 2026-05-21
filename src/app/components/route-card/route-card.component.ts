import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Destination, REGION_COLORS } from '../../data/destinations';
import { DayFlight, getFlightsForWeek, formatDayLabel } from '../../utils/week';

const DAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

@Component({
  selector: 'app-route-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="card"
      [class.card--expanded]="expanded"
      (click)="toggled.emit()"
      (keydown.enter)="toggled.emit()"
      (keydown.space)="$event.preventDefault(); toggled.emit()"
      role="button"
      [attr.tabindex]="0"
      [attr.aria-expanded]="expanded"
      [attr.aria-label]="destination.city + ' ' + destination.code + ' route details'"
    >
      <!-- Top row -->
      <div class="card__top">
        <div class="card__info">
          <div class="card__meta">
            {{ hubCode }} → {{ destination.code }}
            &nbsp;·&nbsp;
            {{ destination.aircraft }}
            <span *ngIf="destination.isNew" class="card__new">NEW</span>
          </div>
          <div class="card__city">{{ destination.city }}</div>
          <div class="card__sub">{{ destination.country }} · {{ destination.region }}</div>
        </div>
        <div class="card__right">
          <div class="card__code" [style.color]="regionColor">{{ destination.code }}</div>
          <div class="card__duration">{{ destination.duration }} direct</div>
        </div>
      </div>

      <!-- Day pills -->
      <div class="card__days" aria-label="Operating days this week">
        <div
          *ngFor="let day of flights; let i = index"
          class="day-pill"
          [class.day-pill--on]="day.flies"
          [attr.aria-label]="dayInitials[i] + (day.flies ? ' has a flight' : ' no flight')"
        >{{ dayInitials[i] }}</div>
      </div>

      <!-- Expanded detail -->
      <div class="card__detail" *ngIf="expanded" role="region" aria-label="Flight times this week">
        <div class="detail__label">FLIGHTS THIS WEEK</div>

        <div
          *ngFor="let day of flights"
          class="flight-row"
          [class.flight-row--none]="!day.flies"
        >
          <span class="flight-row__date">{{ formatDay(day.date) }}</span>
          <span class="flight-row__num">{{ day.flies ? day.flightNumber : '' }}</span>
          <span class="flight-row__time" *ngIf="day.flies">
            {{ day.departure }} → {{ day.arrival }}
          </span>
          <span class="flight-row__none" *ngIf="!day.flies">No departure</span>
        </div>

        <div class="detail__also" *ngIf="destination.fromCities.length > 1">
          Also from:
          {{ destination.fromCities.filter(c => c !== hubCityName).join(' · ') }}
        </div>
      </div>
    </div>
  `,
  styles: [`
    .card {
      background: #fff;
      border: 1px solid #e8e8ed;
      border-radius: 14px;
      padding: 14px 16px;
      cursor: pointer;
      transition: box-shadow 0.15s, border-color 0.15s;
      outline: none;
    }
    .card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.07); border-color: #d0d0d8; }
    .card:focus-visible { outline: 2px solid #C8102E; outline-offset: 2px; }
    .card--expanded { border-color: #C8102E; box-shadow: 0 0 0 3px rgba(200,16,46,0.08); }

    .card__top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
    .card__meta { font-size: 11px; color: #86868b; margin-bottom: 3px; }
    .card__new {
      font-size: 9px; font-weight: 700; background: #C8102E; color: #fff;
      padding: 1px 5px; border-radius: 3px; margin-left: 4px; vertical-align: middle;
    }
    .card__city { font-size: 16px; font-weight: 700; color: #1d1d1f; letter-spacing: -0.3px; }
    .card__sub { font-size: 12px; color: #86868b; margin-top: 1px; }
    .card__right { text-align: right; flex-shrink: 0; margin-left: 12px; }
    .card__code { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; line-height: 1; }
    .card__duration { font-size: 11px; color: #86868b; margin-top: 2px; }

    .card__days { display: flex; gap: 4px; }
    .day-pill {
      flex: 1; height: 22px; border-radius: 6px;
      font-size: 9px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }
    .day-pill--on  { background: #fff0f2; color: #C8102E; border: 1px solid #ffc7cf; }
    .day-pill:not(.day-pill--on) { background: #f5f5f7; color: #c7c7cc; border: 1px solid #e8e8ed; }

    .card__detail {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid #f2f2f2;
    }
    .detail__label {
      font-size: 10px; font-weight: 700; color: #86868b;
      letter-spacing: 1px; text-transform: uppercase;
      margin-bottom: 8px;
    }
    .flight-row {
      display: flex; align-items: center; gap: 12px;
      padding: 7px 0;
      border-bottom: 1px solid #f5f5f5;
      font-size: 12px;
    }
    .flight-row:last-of-type { border-bottom: none; }
    .flight-row__date { font-weight: 600; color: #1d1d1f; min-width: 80px; }
    .flight-row__num { color: #86868b; min-width: 48px; }
    .flight-row__time { color: #1d1d1f; font-weight: 600; margin-left: auto; }
    .flight-row--none { opacity: 0.4; }
    .flight-row__none { color: #86868b; font-style: italic; }
    .detail__also { font-size: 12px; color: #86868b; margin-top: 10px; }
  `]
})
export class RouteCardComponent {
  @Input() destination!: Destination;
  @Input() hubCode = 'YYZ';
  @Input() hubCityName = 'Toronto';
  @Input() weekStart!: Date;
  @Input() expanded = false;
  @Output() toggled = new EventEmitter<void>();

  readonly dayInitials = DAY_INITIALS;

  get flights(): DayFlight[] {
    return getFlightsForWeek(this.hubCode, this.destination.code, this.weekStart);
  }

  get regionColor(): string {
    return REGION_COLORS[this.destination.region] || '#86868b';
  }

  formatDay(date: Date): string {
    return formatDayLabel(date);
  }
}
