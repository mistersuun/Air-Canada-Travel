import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Destination, REGION_COLORS } from '../../data/destinations';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="sidebar">
      <div class="sidebar__header">
        <span class="sidebar__title">Destinations</span>
        <span class="sidebar__count">{{ destinations.length }}</span>
      </div>
      <div class="sidebar__list">
        <p *ngIf="!destinations.length" class="sidebar__empty">No routes match your filters. Try resetting or broadening your search.</p>
        <div
          *ngFor="let d of destinations; let i = index; trackBy: trackByCode"
          class="card"
          [class.card--selected]="selected?.code === d.code"
          [class.card--visited]="isVisited(d.country)"
          [style.animation-delay]="(i * 15) + 'ms'"
          [style.--accent]="getColor(d.region)"
          (click)="destinationSelected.emit(d)"
          (keydown)="onCardKeydown($event, d)"
          role="button"
          tabindex="0"
          [attr.aria-pressed]="selected?.code === d.code"
          [attr.aria-label]="'Select ' + d.city + ', ' + d.country + ' route details'"
        >
          <div class="card__top">
            <div class="card__info">
              <div class="card__city">
                {{ d.city }}
                <span *ngIf="isVisited(d.country)" class="card__badge card__badge--visited">VISITED</span>
                <span *ngIf="d.isNew" class="card__badge card__badge--new">NEW</span>
              </div>
              <div class="card__country">{{ d.country }}</div>
            </div>
            <div class="card__actions">
              <button
                type="button"
                class="card__visit-btn"
                [class.card__visit-btn--active]="isVisited(d.country)"
                (click)="toggleVisited($event, d.country)"
                (keydown)="$event.stopPropagation()"
                [attr.aria-label]="(isVisited(d.country) ? 'Unmark ' : 'Mark ') + d.country + ' as visited'"
              >
                {{ isVisited(d.country) ? '✓' : '○' }}
              </button>
              <span class="card__code" [style.color]="getColor(d.region)">{{ d.code }}</span>
            </div>
          </div>
          <div class="card__tags">
            <span class="card__tag card__tag--type" [style.background]="getColor(d.region) + '18'" [style.color]="getColor(d.region)">{{ d.type }}</span>
            <span class="card__tag">{{ d.duration }}</span>
            <span class="card__tag">{{ d.aircraft }}</span>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; overflow: hidden; }

    .sidebar { display: flex; flex-direction: column; height: 100%; }

    .sidebar__header {
      padding: 10px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      display: flex; justify-content: space-between; align-items: center;
    }
    .sidebar__title {
      font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.8);
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .sidebar__count {
      font-size: 12px; color: rgba(255,255,255,0.3);
      background: rgba(255,255,255,0.05); padding: 2px 8px;
      border-radius: 999px;
    }

    .sidebar__list {
      flex: 1; overflow-y: auto; padding: 6px 8px;
    }
    .sidebar__empty {
      font-size: 13px; color: rgba(255,255,255,0.3);
      padding: 20px 12px; line-height: 1.5; text-align: center;
    }

    .card {
      width: 100%; text-align: left;
      padding: 10px 12px; border-radius: 10px; margin-bottom: 4px;
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.04);
      border-left: 3px solid var(--accent, rgba(255,255,255,0.1));
      cursor: pointer; transition: all 0.15s;
      animation: fadeIn 0.3s ease both;
      font-family: inherit; appearance: none;

      &:hover:not(.card--selected) {
        background: rgba(255,255,255,0.05);
        border-color: rgba(255,255,255,0.08);
      }
    }
    .card--selected {
      background: rgba(255,255,255,0.06) !important;
      border-color: rgba(255,255,255,0.12);
      box-shadow: 0 0 20px rgba(255,255,255,0.02);
    }
    .card--visited {
      border-left-color: #34d399 !important;
    }

    .card__top {
      display: flex; justify-content: space-between; align-items: start;
    }
    .card__actions {
      display: flex; flex-direction: column; gap: 4px; align-items: end;
    }
    .card__visit-btn {
      width: 24px; height: 24px; border-radius: 50%;
      border: 1px solid rgba(52,211,153,0.3);
      background: transparent; color: rgba(52,211,153,0.5);
      font-size: 12px; cursor: pointer; display: flex;
      align-items: center; justify-content: center;
      font-family: inherit; transition: all 0.15s;
      &:hover { background: rgba(52,211,153,0.1); color: #34d399; }
    }
    .card__visit-btn--active {
      background: rgba(52,211,153,0.15);
      color: #34d399;
      border-color: #34d399;
    }
    .card__info { flex: 1; min-width: 0; }
    .card__city {
      font-size: 14px; font-weight: 600; color: #eae6df;
      display: flex; align-items: center; gap: 6px; margin-bottom: 1px;
    }
    .card__badge {
      font-size: 9px; padding: 1px 5px; border-radius: 3px;
      font-weight: 700; flex-shrink: 0;
    }
    .card__badge--new { background: #C8102E; color: white; }
    .card__badge--visited { background: rgba(52,211,153,0.15); color: #34d399; }
    .card__country { font-size: 12px; color: rgba(255,255,255,0.35); }
    .card__code {
      font-size: 13px; font-weight: 700; letter-spacing: 0.3px;
    }

    .card__tags {
      display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap;
    }
    .card__tag {
      font-size: 10px; padding: 3px 7px; border-radius: 4px;
      background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.4);
      font-weight: 500;
    }
    .card__tag--type { font-weight: 600; }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `]
})
export class SidebarComponent {
  @Input() destinations: Destination[] = [];
  @Input() selected: Destination | null = null;
  @Input() visitedCountries: string[] = [];
  @Output() destinationSelected = new EventEmitter<Destination>();
  @Output() visitedCountryToggled = new EventEmitter<string>();

  getColor(region: string): string {
    return REGION_COLORS[region] || '#888';
  }

  trackByCode(_: number, d: Destination): string {
    return d.code;
  }

  isVisited(country: string): boolean {
    return this.visitedCountries.includes(country);
  }

  toggleVisited(event: Event, country: string) {
    event.stopPropagation();
    this.visitedCountryToggled.emit(country);
  }

  onCardKeydown(event: KeyboardEvent, destination: Destination) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.destinationSelected.emit(destination);
    }
  }
}
