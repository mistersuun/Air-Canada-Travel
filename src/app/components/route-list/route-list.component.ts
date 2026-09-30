import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouteEntry, HubStats } from '../../utils/routes';
import type { Coverage } from '../../data/schedule-index';
import type { TimeFormat } from '../../state/prefs.service';
import { keyToDate } from '../../utils/time';
import { RouteCardComponent } from '../route-card/route-card.component';

@Component({
  selector: 'app-route-list',
  standalone: true,
  imports: [CommonModule, RouteCardComponent],
  template: `
    <div class="list">
      <p class="list__empty" *ngIf="!routes.length">
        No routes with flights this week from {{ hubCityName }}.
        Try a different week or region.
      </p>

      <ng-container *ngFor="let r of directRoutes; trackBy: trackByCode">
        <app-route-card
          [destination]="r.destination"
          [hubCode]="hubCode"
          [hubCityName]="hubCityName"
          [weekStart]="weekStart"
          [selectedDate]="selectedDate"
          [expanded]="expandedCode === r.destination.code"
          [routeEntry]="r"
          (toggled)="open.emit(r.destination.code)"
        ></app-route-card>
      </ng-container>

      <div class="list__divider" *ngIf="connectingRoutes.length && directRoutes.length">
        <span class="list__divider-text">Connecting flights</span>
      </div>

      <ng-container *ngFor="let r of connectingRoutes; trackBy: trackByCode">
        <app-route-card
          [destination]="r.destination"
          [hubCode]="hubCode"
          [hubCityName]="hubCityName"
          [weekStart]="weekStart"
          [selectedDate]="selectedDate"
          [expanded]="expandedCode === r.destination.code"
          [routeEntry]="r"
          (toggled)="open.emit(r.destination.code)"
        ></app-route-card>
      </ng-container>
    </div>
  `,
  styles: [`
    .list {
      padding: 12px 24px;
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
      max-width: 1280px;
      margin: 0 auto;
      padding-bottom: 48px;
    }
    @media (min-width: 768px) {
      .list { grid-template-columns: repeat(2, 1fr); }
    }
    @media (min-width: 1200px) {
      .list { grid-template-columns: repeat(3, 1fr); padding: 16px 32px; }
    }
    .list__empty {
      grid-column: 1 / -1;
      text-align: center;
      padding: 48px 24px;
      font-size: 14px;
      color: #86868b;
      line-height: 1.6;
    }
    .list__divider {
      grid-column: 1 / -1;
      text-align: center;
      padding: 12px 0 4px;
      position: relative;
    }
    .list__divider::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 0;
      right: 0;
      border-top: 1px solid #e0e0e0;
    }
    .list__divider-text {
      position: relative;
      background: #f5f5f7;
      padding: 0 16px;
      font-size: 12px;
      font-weight: 600;
      color: #86868b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
  `]
})
export class RouteListComponent {
  // WS3 binding contract (stubs; WS5 implements the UI). Dates are 'YYYY-MM-DD' keys.
  @Input() set entries(v: RouteEntry[]) { this.routes = v; }
  @Input() set weekStartKey(k: string) { this.weekStart = keyToDate(k); }
  @Input() set selectedDateKey(k: string | null) { this.selectedDate = k ? keyToDate(k) : null; }
  @Input() set hubName(n: string) { this.hubCityName = n; }
  @Input() hubCode = 'YUL';
  @Input() coverage: Coverage | null = null;
  @Input() stats: HubStats | null = null;
  @Input() favourites: readonly string[] = [];
  @Input() timeFormat: TimeFormat = '24h';
  @Input() todayKey: string | null = null;
  @Input() showConnections = true;
  @Input() hasActiveFilters = false;
  @Output() open = new EventEmitter<string>();
  @Output() toggleFavourite = new EventEmitter<string>();
  @Output() clearFilters = new EventEmitter<void>();
  @Output() jumpToCoverage = new EventEmitter<string | null>();

  routes: RouteEntry[] = [];
  hubCityName = 'Montreal';
  weekStart!: Date;
  selectedDate: Date | null = null;
  expandedCode: string | null = null;

  get directRoutes(): RouteEntry[] {
    return this.routes.filter(r => r.isDirect);
  }

  get connectingRoutes(): RouteEntry[] {
    return this.routes.filter(r => !r.isDirect);
  }

  trackByCode(_: number, r: RouteEntry): string {
    return r.destination.code;
  }
}
