import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Destination } from '../../data/destinations';
import { RouteCardComponent } from '../route-card/route-card.component';

@Component({
  selector: 'app-route-list',
  standalone: true,
  imports: [CommonModule, RouteCardComponent],
  template: `
    <div class="list">
      <p class="list__empty" *ngIf="!destinations.length">
        No routes with flights this week from {{ hubCityName }}.
        Try a different week or region.
      </p>
      <app-route-card
        *ngFor="let d of destinations; trackBy: trackByCode"
        [destination]="d"
        [hubCode]="hubCode"
        [hubCityName]="hubCityName"
        [weekStart]="weekStart"
        [expanded]="expandedCode === d.code"
        (toggled)="cardToggled.emit(d.code)"
      ></app-route-card>
    </div>
  `,
  styles: [`
    .list {
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 640px;
      margin: 0 auto;
      padding-bottom: 48px;
    }
    .list__empty {
      text-align: center;
      padding: 48px 24px;
      font-size: 14px;
      color: #86868b;
      line-height: 1.6;
    }
  `]
})
export class RouteListComponent {
  @Input() destinations: Destination[] = [];
  @Input() hubCode = 'YYZ';
  @Input() hubCityName = 'Toronto';
  @Input() weekStart!: Date;
  @Input() expandedCode: string | null = null;
  @Output() cardToggled = new EventEmitter<string>();

  trackByCode(_: number, d: Destination): string {
    return d.code;
  }
}
