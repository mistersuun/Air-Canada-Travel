import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Destination, DESTINATIONS, HUBS } from './data/destinations';
import { getWeekStart, routeHasFlightsInWeek, routeHasFlightOnDay } from './utils/week';
import { findConnections, findConnectionsForWeek, ConnectionOption } from './utils/connections';
import { HeaderComponent } from './components/header/header.component';
import { WeekStripComponent } from './components/week-strip/week-strip.component';
import { RouteListComponent } from './components/route-list/route-list.component';
import { FlightModalComponent } from './components/flight-modal/flight-modal.component';

export interface RouteEntry {
  destination: Destination;
  isDirect: boolean;
  bestConnection?: ConnectionOption;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, HeaderComponent, WeekStripComponent, RouteListComponent, FlightModalComponent],
  template: `
    <app-header
      [homeCity]="homeCity"
      (homeCityChanged)="onHomeCityChange($event)"
    ></app-header>

    <app-week-strip
      [weekStart]="weekStart"
      [routeCount]="allRoutes.length"
      [activeRegion]="activeRegion"
      [selectedDate]="selectedDate"
      [showConnections]="showConnections"
      (prev)="prevWeek()"
      (next)="nextWeek()"
      (regionSelected)="onRegionSelected($event)"
      (daySelected)="onDaySelected($event)"
      (connectionsToggled)="showConnections = $event"
    ></app-week-strip>

    <app-route-list
      [routes]="allRoutes"
      [hubCode]="hubCode"
      [hubCityName]="homeCity"
      [weekStart]="weekStart"
      [selectedDate]="selectedDate"
      [expandedCode]="expandedCode"
      (cardToggled)="onCardToggled($event)"
    ></app-route-list>

    <app-flight-modal
      *ngIf="expandedDestination"
      [destination]="expandedDestination!"
      [hubCode]="hubCode"
      [hubCityName]="homeCity"
      [weekStart]="weekStart"
      [selectedDate]="selectedDate"
      [route]="expandedRoute"
      (closed)="expandedCode = null"
    ></app-flight-modal>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      background: #f5f5f7;
    }
  `]
})
export class AppComponent {
  homeCity = 'Montreal';
  weekStart = getWeekStart(new Date());
  activeRegion = 'All';
  expandedCode: string | null = null;
  selectedDate: Date | null = null;
  showConnections = true;

  get hubCode(): string {
    return HUBS.find(h => h.name === this.homeCity)?.code ?? 'YYZ';
  }

  get expandedDestination(): Destination | null {
    if (!this.expandedCode) return null;
    return DESTINATIONS.find(d => d.code === this.expandedCode) ?? null;
  }

  get expandedRoute(): RouteEntry | null {
    if (!this.expandedCode) return null;
    return this.allRoutes.find(r => r.destination.code === this.expandedCode) ?? null;
  }

  get allRoutes(): RouteEntry[] {
    const routes: RouteEntry[] = [];
    const seen = new Set<string>();

    for (const d of DESTINATIONS) {
      if (this.activeRegion !== 'All' && d.region !== this.activeRegion) continue;

      const hasDirect = this.selectedDate
        ? routeHasFlightOnDay(this.hubCode, d.code, this.selectedDate)
        : routeHasFlightsInWeek(this.hubCode, d.code, this.weekStart);

      if (hasDirect) {
        routes.push({ destination: d, isDirect: true });
        seen.add(d.code);
      }
    }

    if (this.showConnections) {
      for (const d of DESTINATIONS) {
        if (seen.has(d.code)) continue;
        if (this.activeRegion !== 'All' && d.region !== this.activeRegion) continue;

        if (this.selectedDate) {
          const conns = findConnections(this.hubCode, d.code, this.selectedDate);
          if (conns.length > 0) {
            const best = conns.reduce((b, c) => c.layoverMinutes < b.layoverMinutes ? c : b);
            routes.push({ destination: d, isDirect: false, bestConnection: best });
          }
        } else {
          if (findConnectionsForWeek(this.hubCode, d.code, this.weekStart)) {
            routes.push({ destination: d, isDirect: false });
          }
        }
      }
    }

    return routes;
  }

  prevWeek(): void {
    const d = new Date(this.weekStart);
    d.setDate(d.getDate() - 7);
    this.weekStart = d;
    this.selectedDate = null;
    this.expandedCode = null;
  }

  nextWeek(): void {
    const d = new Date(this.weekStart);
    d.setDate(d.getDate() + 7);
    this.weekStart = d;
    this.selectedDate = null;
    this.expandedCode = null;
  }

  onHomeCityChange(city: string): void {
    this.homeCity = city;
    this.expandedCode = null;
  }

  onRegionSelected(region: string): void {
    this.activeRegion = region;
    this.expandedCode = null;
  }

  onDaySelected(date: Date | null): void {
    this.selectedDate = date;
    this.expandedCode = null;
  }

  onCardToggled(code: string): void {
    this.expandedCode = this.expandedCode === code ? null : code;
  }
}
