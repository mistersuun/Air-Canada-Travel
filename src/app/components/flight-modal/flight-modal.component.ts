import { Component, Input, Output, EventEmitter, HostListener, OnInit, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Destination, REGION_COLORS } from '../../data/destinations';
import { DayFlight, getFlightsForWeek, formatDayLabel } from '../../utils/week';
import { findConnections, ConnectionOption, formatLayover } from '../../utils/connections';
import { RouteEntry } from '../../app.component';
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
      <button class="modal__close" (click)="closed.emit()" aria-label="Close">&#x2715;</button>

      <div class="modal__hero">
        <span class="modal__flag">{{ flag }}</span>
        <div class="modal__titles">
          <div class="modal__city">{{ destination.city }}</div>
          <div class="modal__sub">{{ destination.country }} · {{ destination.region }}</div>
        </div>
        <div class="modal__code" [style.color]="regionColor">{{ destination.code }}</div>
      </div>

      <!-- DIRECT ROUTE INFO -->
      <ng-container *ngIf="route?.isDirect">
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
          >{{ dayInitials[i] }}</div>
        </div>

        <div class="modal__section-label">FLIGHTS THIS WEEK</div>

        <div
          *ngFor="let day of flights"
          class="flight-row"
          [class.flight-row--none]="!day.flies"
          [class.flight-row--selected]="isSelectedDay(day.date)"
        >
          <span class="flight-row__date">{{ formatDay(day.date) }}</span>
          <span class="flight-row__num">{{ day.flies ? day.flightNumber : '' }}</span>
          <span class="flight-row__time" *ngIf="day.flies">{{ day.departure }} → {{ day.arrival }}</span>
          <span class="flight-row__none" *ngIf="!day.flies">No departure</span>
        </div>
      </ng-container>

      <!-- CONNECTING ROUTE INFO -->
      <ng-container *ngIf="route && !route.isDirect">
        <div class="modal__route modal__route--connecting">
          {{ hubCode }} → connection → {{ destination.code }}
        </div>

        <div class="modal__section-label">CONNECTION OPTIONS THIS WEEK</div>

        <div *ngIf="!weekConnections.length" class="modal__empty">
          No connections available this week.
        </div>

        <div *ngFor="let conn of weekConnections" class="conn-card" [class.conn-card--selected]="isSelectedDay(conn.date)">
          <div class="conn-card__date">{{ formatDay(conn.date) }}</div>
          <div class="conn-card__legs">
            <div class="conn-card__leg">
              <span class="conn-card__codes">{{ conn.leg1.from }} → {{ conn.leg1.to }}</span>
              <span class="conn-card__times">{{ conn.leg1.departure }} → {{ conn.leg1.arrival }}</span>
            </div>
            <div class="conn-card__layover">
              {{ formatLayover(conn.layoverMinutes) }} layover in {{ conn.viaHubName }}
            </div>
            <div class="conn-card__leg">
              <span class="conn-card__codes">{{ conn.leg2.from }} → {{ conn.leg2.to }}</span>
              <span class="conn-card__times">{{ conn.leg2.departure }} → {{ conn.leg2.arrival }}</span>
              <span class="conn-card__flight">{{ conn.leg2.flightNumber }}</span>
            </div>
          </div>
        </div>
      </ng-container>

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
    .modal__route--connecting {
      background: #fef7ed;
      color: #E89020;
      font-weight: 600;
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
      margin-bottom: 8px;
    }
    .modal__empty {
      font-size: 13px; color: #86868b; text-align: center; padding: 16px 0;
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
    .flight-row--selected { background: #fff0f2; border-radius: 6px; padding: 8px 6px; }
    .flight-row__none { color: #86868b; font-style: italic; }

    .conn-card {
      background: #fef7ed;
      border: 1px solid #fde0b0;
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 8px;
    }
    .conn-card--selected { border-color: #E89020; box-shadow: 0 0 0 2px rgba(232,144,32,0.15); }
    .conn-card__date { font-size: 12px; font-weight: 700; color: #1d1d1f; margin-bottom: 6px; }
    .conn-card__legs { font-size: 12px; }
    .conn-card__leg {
      display: flex; align-items: center; gap: 8px; padding: 3px 0;
    }
    .conn-card__codes { font-weight: 600; color: #1d1d1f; min-width: 70px; }
    .conn-card__times { font-weight: 700; color: #E89020; }
    .conn-card__flight { font-size: 11px; color: #86868b; margin-left: auto; }
    .conn-card__layover {
      text-align: center; font-size: 10px; color: #86868b;
      padding: 3px 0; margin: 2px 0;
      border-top: 1px dashed #e0d0b0;
      border-bottom: 1px dashed #e0d0b0;
    }

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
  @Input() selectedDate: Date | null = null;
  @Input() route: RouteEntry | null = null;
  @Output() closed = new EventEmitter<void>();

  readonly dayInitials = DAY_INITIALS;
  readonly formatLayover = formatLayover;

  constructor(private el: ElementRef) {}

  ngOnInit(): void {
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

  get weekConnections(): ConnectionOption[] {
    const all: ConnectionOption[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(this.weekStart);
      date.setDate(date.getDate() + i);
      const dayConns = findConnections(this.hubCode, this.destination.code, date);
      if (dayConns.length > 0) {
        const best = dayConns.reduce((b, c) => c.layoverMinutes < b.layoverMinutes ? c : b);
        all.push(best);
      }
    }
    return all;
  }

  get flag(): string {
    return getFlag(this.destination.country);
  }

  get regionColor(): string {
    return REGION_COLORS[this.destination.region] || '#86868b';
  }

  isSelectedDay(date: Date): boolean {
    return this.selectedDate?.toDateString() === date.toDateString();
  }

  formatDay(date: Date): string {
    return formatDayLabel(date);
  }
}
