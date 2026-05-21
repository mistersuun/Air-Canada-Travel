import { Component, Input, Output, EventEmitter, HostListener, OnInit, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Destination, REGION_COLORS } from '../../data/destinations';
import { DayFlight, getFlightsForWeek, formatDayLabel } from '../../utils/week';
import { getFlag } from '../../utils/flags';

const DAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

@Component({
  selector: 'app-flight-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="backdrop" (click)="closed.emit()" aria-hidden="true"></div>
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="destination.city + ' flight details'"
    >
      <button class="modal__close" (click)="closed.emit()" aria-label="Close">✕</button>

      <div class="modal__hero">
        <span class="modal__flag">{{ flag }}</span>
        <div class="modal__titles">
          <div class="modal__city">{{ destination.city }}</div>
          <div class="modal__sub">{{ destination.country }} · {{ destination.region }}</div>
        </div>
        <div class="modal__code" [style.color]="regionColor">{{ destination.code }}</div>
      </div>

      <div class="modal__route">
        {{ hubCode }} → {{ destination.code }}
        &nbsp;·&nbsp;{{ destination.aircraft }}
        &nbsp;·&nbsp;{{ destination.duration }} direct
      </div>

      <div class="modal__pills">
        <div
          *ngFor="let day of flights; let i = index"
          class="day-pill"
          [class.day-pill--on]="day.flies"
          [attr.aria-label]="dayInitials[i] + (day.flies ? ' has a flight' : ' no flight')"
        >{{ dayInitials[i] }}</div>
      </div>

      <div class="modal__section-label">FLIGHTS THIS WEEK</div>

      <div
        *ngFor="let day of flights"
        class="flight-row"
        [class.flight-row--none]="!day.flies"
      >
        <span class="flight-row__date">{{ formatDay(day.date) }}</span>
        <span class="flight-row__num">{{ day.flies ? day.flightNumber : '' }}</span>
        <span class="flight-row__time" *ngIf="day.flies">{{ day.departure }} → {{ day.arrival }}</span>
        <span class="flight-row__none" *ngIf="!day.flies">No departure</span>
      </div>

      <div class="modal__also" *ngIf="destination.fromCities.length > 1">
        Also from:
        {{ destination.fromCities.filter(c => c !== hubCityName).join(' · ') }}
      </div>
    </div>
  `,
  styles: [`
    :host {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      cursor: pointer;
    }
    .modal {
      position: relative;
      background: #fff;
      border-radius: 20px;
      width: 100%;
      max-width: 480px;
      max-height: 90vh;
      overflow-y: auto;
      padding: 24px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.2);
    }
    .modal__close {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: none;
      background: #f5f5f7;
      color: #1d1d1f;
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: inherit;
    }
    .modal__close:focus-visible { outline: 2px solid #C8102E; outline-offset: 2px; }
    .modal__hero {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
      padding-right: 40px;
    }
    .modal__flag { font-size: 32px; line-height: 1; flex-shrink: 0; }
    .modal__titles { flex: 1; }
    .modal__city { font-size: 22px; font-weight: 800; color: #1d1d1f; letter-spacing: -0.4px; line-height: 1.1; }
    .modal__sub { font-size: 12px; color: #86868b; margin-top: 3px; }
    .modal__code { font-size: 28px; font-weight: 800; letter-spacing: -1px; flex-shrink: 0; }
    .modal__route {
      font-size: 12px;
      color: #86868b;
      margin-bottom: 16px;
      padding: 8px 12px;
      background: #f5f5f7;
      border-radius: 8px;
    }
    .modal__pills { display: flex; gap: 4px; margin-bottom: 16px; }
    .day-pill {
      flex: 1; height: 24px; border-radius: 6px;
      font-size: 9px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }
    .day-pill--on  { background: #fff0f2; color: #C8102E; border: 1px solid #ffc7cf; }
    .day-pill:not(.day-pill--on) { background: #f5f5f7; color: #c7c7cc; border: 1px solid #e8e8ed; }

    .modal__section-label {
      font-size: 10px; font-weight: 700; color: #86868b;
      letter-spacing: 1px; text-transform: uppercase;
      margin-bottom: 6px;
    }
    .flight-row {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid #f5f5f5;
      font-size: 12px;
    }
    .flight-row:last-of-type { border-bottom: none; }
    .flight-row__date { font-weight: 600; color: #1d1d1f; min-width: 80px; }
    .flight-row__num { color: #86868b; min-width: 48px; }
    .flight-row__time { color: #1d1d1f; font-weight: 600; margin-left: auto; }
    .flight-row--none { opacity: 0.4; }
    .flight-row__none { color: #86868b; font-style: italic; }
    .modal__also {
      font-size: 12px; color: #86868b;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #f2f2f2;
    }

    @media (max-width: 600px) {
      :host { padding: 0; align-items: flex-end; }
      .modal {
        border-radius: 20px 20px 0 0;
        max-height: 80vh;
      }
    }
  `]
})
export class FlightModalComponent implements OnInit {
  @Input() destination!: Destination;
  @Input() hubCode = 'YYZ';
  @Input() hubCityName = 'Toronto';
  @Input() weekStart!: Date;
  @Output() closed = new EventEmitter<void>();

  readonly dayInitials = DAY_INITIALS;

  constructor(private el: ElementRef) {}

  ngOnInit(): void {
    // Focus the modal for accessibility
    setTimeout(() => {
      const btn = this.el.nativeElement.querySelector('.modal__close');
      btn?.focus();
    }, 50);
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.closed.emit();
  }

  get flights(): DayFlight[] {
    return getFlightsForWeek(this.hubCode, this.destination.code, this.weekStart);
  }

  get flag(): string {
    return getFlag(this.destination.country);
  }

  get regionColor(): string {
    return REGION_COLORS[this.destination.region] || '#86868b';
  }

  formatDay(date: Date): string {
    return formatDayLabel(date);
  }
}
