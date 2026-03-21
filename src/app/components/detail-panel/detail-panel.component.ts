import { Component, Input, Output, EventEmitter, ElementRef, HostListener, ViewChild, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Destination, HUBS, REGION_COLORS } from '../../data/destinations';
import { FlightSchedule, getSchedulesForRoute } from '../../data/schedules';

@Component({
  selector: 'app-detail-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div #panelRoot class="panel" *ngIf="destination" role="dialog" aria-modal="true" aria-label="Selected route details">
      <button #closeButton class="panel__close" (click)="closePanel()" aria-label="Close route details">✕</button>

      <!-- Tags -->
      <div class="panel__tags">
        <span *ngIf="destination.isNew" class="tag tag--new">NEW 2026</span>
        <span class="tag tag--region" [style.color]="color" [style.background]="color + '18'">
          {{ destination.region }}
        </span>
        <span class="tag">{{ destination.type }}</span>
        <span class="tag">{{ destination.season }}</span>
      </div>

      <!-- Route display -->
      <div class="route">
        <div class="route__endpoint">
          <div class="route__code">{{ hubCode }}</div>
          <div class="route__name">{{ homeCity }}</div>
        </div>

        <div class="route__middle">
          <span class="route__duration">{{ destination.duration }}</span>
          <div class="route__line">
            <div class="route__dot-from"></div>
            <div class="route__dot-to" [style.border-color]="color"></div>
            <span class="route__plane">✈</span>
          </div>
          <span class="route__info">Direct · {{ destination.aircraft }}</span>
        </div>

        <div class="route__endpoint route__endpoint--right">
          <div class="route__code">{{ destination.code }}</div>
          <div class="route__name">{{ destination.city }}, {{ destination.country }}</div>
        </div>
      </div>

      <!-- Schedule -->
      <div class="sched" *ngIf="schedules.length">
        <button type="button" class="sched__toggle" (click)="showSchedule = !showSchedule">
          <span class="sched__label">Flight schedule</span>
          <span class="sched__count">{{ schedules.length }} {{ schedules.length === 1 ? 'period' : 'periods' }}</span>
          <span class="sched__arrow" [class.sched__arrow--open]="showSchedule">▾</span>
        </button>
        <div class="sched__table" *ngIf="showSchedule">
          <div class="sched__row sched__row--header">
            <span>Dates</span>
            <span>Days</span>
            <span>Flight</span>
            <span>Dep</span>
            <span>Arr</span>
            <span>Aircraft</span>
          </div>
          <div class="sched__row" *ngFor="let s of schedules">
            <span class="sched__dates">{{ formatDate(s.fromDate) }} – {{ formatDate(s.toDate) }}</span>
            <span class="sched__days">{{ s.days }}</span>
            <span>{{ s.flightNumber }}</span>
            <span>{{ s.departure }}</span>
            <span>{{ s.arrival }}</span>
            <span>{{ s.aircraft }}</span>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="panel__footer">
        <div class="panel__from">
          Also from: {{ destination.fromCities.join(', ') }}
        </div>
        <div class="panel__actions">
          <button type="button" class="panel__visit-btn" (click)="visitedCountryToggled.emit(destination.country)">
            {{ isVisited(destination.country) ? 'Unmark visited' : 'Mark visited' }}
          </button>
          <a
            href="https://vacations.aircanada.com/en"
            target="_blank"
            rel="noopener noreferrer"
            class="panel__cta"
          >
            Search on Air Canada →
          </a>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      position: absolute;
      bottom: 20px; left: 20px; right: 336px;
      z-index: 1000; min-width: 320px;
    }

    .panel {
      background: rgba(12, 15, 28, 0.78);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border-radius: 16px;
      padding: 20px 24px;
      box-shadow: 0 12px 48px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08);
      animation: slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      position: relative;
    }

    .panel__close {
      position: absolute; top: 12px; right: 14px;
      background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      width: 32px; height: 32px; cursor: pointer;
      font-size: 14px; color: rgba(255,255,255,0.4);
      display: flex; align-items: center; justify-content: center;
      transition: all 0.15s;
      &:hover { background: rgba(255,255,255,0.1); color: #fff; }
    }

    .panel__tags {
      display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap;
    }
    .tag {
      font-size: 11px; color: rgba(255,255,255,0.5);
      background: rgba(255,255,255,0.06);
      padding: 4px 10px; border-radius: 6px; font-weight: 600;
    }
    .tag--new {
      background: #C8102E; color: white; font-weight: 700;
    }
    .tag--region { font-weight: 600; }

    .route {
      display: flex; align-items: center; gap: 16px; margin-bottom: 18px;
    }
    .route__endpoint { min-width: 60px; }
    .route__endpoint--right { text-align: right; }
    .route__code {
      font-family: 'Source Serif 4', serif;
      font-size: 28px; font-weight: 700; color: #fff;
      letter-spacing: -0.5px;
    }
    .route__name { font-size: 12px; color: rgba(255,255,255,0.4); }

    .route__middle {
      flex: 1; text-align: center;
      display: flex; flex-direction: column; align-items: center; gap: 4px;
    }
    .route__duration {
      font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.5);
      background: rgba(255,255,255,0.06); padding: 3px 10px; border-radius: 999px;
    }
    .route__line {
      width: 100%; height: 1px; background: rgba(255,255,255,0.12);
      position: relative; margin: 3px 0;
    }
    .route__dot-from {
      position: absolute; left: 0; top: -3.5px;
      width: 8px; height: 8px; border-radius: 50%; background: #C8102E;
      box-shadow: 0 0 8px rgba(200,16,46,0.4);
    }
    .route__dot-to {
      position: absolute; right: 0; top: -3.5px;
      width: 8px; height: 8px; border-radius: 50%;
      background: rgba(12,15,28,0.8); border: 2.5px solid #888;
    }
    .route__plane {
      position: absolute; left: 50%; top: -7px;
      transform: translateX(-50%); font-size: 12px;
    }
    .route__info { font-size: 11px; color: rgba(255,255,255,0.3); }

    .panel__footer {
      display: flex; justify-content: space-between; align-items: center;
    }
    .panel__actions {
      display: flex; gap: 8px; align-items: center;
    }
    .panel__from { font-size: 12px; color: rgba(255,255,255,0.3); max-width: 50%; }
    .panel__visit-btn {
      border: 1px solid rgba(52,211,153,0.3);
      color: #34d399;
      background: rgba(52,211,153,0.08);
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 12px; font-weight: 600;
      cursor: pointer; font-family: inherit;
      transition: all 0.15s;
      &:hover { background: rgba(52,211,153,0.15); }
    }
    .panel__cta {
      display: inline-flex; align-items: center; gap: 4px;
      background: #C8102E; color: white; border-radius: 8px;
      padding: 8px 16px; font-size: 13px; font-weight: 700;
      text-decoration: none; font-family: inherit;
      box-shadow: 0 4px 16px rgba(200,16,46,0.3);
      transition: all 0.15s;
      &:hover { box-shadow: 0 6px 24px rgba(200,16,46,0.4); transform: translateY(-1px); }
    }

    /* ── SCHEDULE ── */
    .sched {
      margin-bottom: 14px;
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 10px;
      overflow: hidden;
    }
    .sched__toggle {
      display: flex; align-items: center; gap: 8px;
      width: 100%; padding: 8px 12px;
      background: rgba(255,255,255,0.03); border: none;
      color: rgba(255,255,255,0.6); cursor: pointer;
      font-family: inherit; font-size: 12px; font-weight: 600;
      text-align: left;
      &:hover { background: rgba(255,255,255,0.05); }
    }
    .sched__label { flex: 1; }
    .sched__count {
      font-size: 10px; font-weight: 500;
      background: rgba(255,255,255,0.06); padding: 2px 7px;
      border-radius: 999px; color: rgba(255,255,255,0.4);
    }
    .sched__arrow {
      font-size: 10px; transition: transform 0.2s;
      color: rgba(255,255,255,0.3);
    }
    .sched__arrow--open { transform: rotate(180deg); }
    .sched__table {
      max-height: 200px; overflow-y: auto;
      border-top: 1px solid rgba(255,255,255,0.04);
    }
    .sched__row {
      display: grid;
      grid-template-columns: 2.2fr 1.6fr 1fr 0.7fr 0.7fr 0.8fr;
      gap: 4px; padding: 5px 12px;
      font-size: 11px; color: rgba(255,255,255,0.45);
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .sched__row--header {
      font-weight: 700; color: rgba(255,255,255,0.25);
      font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.5px;
      position: sticky; top: 0;
      background: rgba(12,15,28,0.95);
    }
    .sched__dates { white-space: nowrap; }
    .sched__days { font-size: 10px; }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 1100px) {
      :host { right: 296px; }
    }

    @media (max-width: 900px) {
      :host {
        position: fixed;
        left: 12px; right: 12px; bottom: 12px;
        min-width: 0;
        max-height: min(55vh, 440px);
      }
      .panel {
        padding: 16px 18px;
        max-height: inherit; overflow-y: auto;
      }
      .route__code { font-size: 22px; }
      .panel__footer {
        flex-direction: column; gap: 10px; align-items: start;
      }
      .panel__actions {
        width: 100%; flex-direction: column; align-items: stretch;
      }
      .panel__from { max-width: 100%; }
    }
  `]
})
export class DetailPanelComponent implements AfterViewInit, OnChanges {
  @Input() destination!: Destination;
  @Input() homeCity = 'Toronto';
  @Input() visitedCountries: string[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() visitedCountryToggled = new EventEmitter<string>();
  @ViewChild('panelRoot') panelRoot?: ElementRef<HTMLElement>;
  @ViewChild('closeButton') closeButton?: ElementRef<HTMLButtonElement>;

  schedules: FlightSchedule[] = [];
  showSchedule = false;

  get color(): string {
    return REGION_COLORS[this.destination?.region] || '#888';
  }

  get hubCode(): string {
    const hub = HUBS.find(h => h.name === this.homeCity);
    return hub?.code || 'YYZ';
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['destination'] || changes['homeCity']) {
      this.schedules = getSchedulesForRoute(this.hubCode, this.destination?.code);
      this.showSchedule = false;
    }
  }

  ngAfterViewInit() {
    setTimeout(() => this.closeButton?.nativeElement.focus(), 0);
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  closePanel() {
    this.closed.emit();
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent) {
    if (!this.destination) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.closePanel();
      return;
    }

    if (event.key !== 'Tab') return;
    this.maintainFocusTrap(event);
  }

  private maintainFocusTrap(event: KeyboardEvent) {
    const root = this.panelRoot?.nativeElement;
    if (!root) return;
    const focusables = root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  isVisited(country: string): boolean {
    return this.visitedCountries.includes(country);
  }
}
