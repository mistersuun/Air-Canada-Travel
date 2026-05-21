import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Destination, DESTINATIONS, HUBS } from './data/destinations';
import { getWeekStart, routeHasFlightsInWeek } from './utils/week';
import { HeaderComponent } from './components/header/header.component';
import { WeekStripComponent } from './components/week-strip/week-strip.component';
import { RouteListComponent } from './components/route-list/route-list.component';
import { FlightModalComponent } from './components/flight-modal/flight-modal.component';

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
      [routeCount]="filteredDestinations.length"
      [activeRegion]="activeRegion"
      (prev)="prevWeek()"
      (next)="nextWeek()"
      (regionSelected)="onRegionSelected($event)"
    ></app-week-strip>

    <app-route-list
      [destinations]="filteredDestinations"
      [hubCode]="hubCode"
      [hubCityName]="homeCity"
      [weekStart]="weekStart"
      [expandedCode]="expandedCode"
      (cardToggled)="onCardToggled($event)"
    ></app-route-list>

    <app-flight-modal
      *ngIf="expandedDestination"
      [destination]="expandedDestination!"
      [hubCode]="hubCode"
      [hubCityName]="homeCity"
      [weekStart]="weekStart"
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
  homeCity = 'Toronto';
  weekStart = getWeekStart(new Date());
  activeRegion = 'All';
  expandedCode: string | null = null;

  get hubCode(): string {
    return HUBS.find(h => h.name === this.homeCity)?.code ?? 'YYZ';
  }

  get expandedDestination(): Destination | null {
    if (!this.expandedCode) return null;
    return DESTINATIONS.find(d => d.code === this.expandedCode) ?? null;
  }

  get filteredDestinations(): Destination[] {
    return DESTINATIONS.filter(d => {
      if (this.activeRegion !== 'All' && d.region !== this.activeRegion) return false;
      return routeHasFlightsInWeek(this.hubCode, d.code, this.weekStart);
    });
  }

  prevWeek(): void {
    const d = new Date(this.weekStart);
    d.setDate(d.getDate() - 7);
    this.weekStart = d;
    this.expandedCode = null;
  }

  nextWeek(): void {
    const d = new Date(this.weekStart);
    d.setDate(d.getDate() + 7);
    this.weekStart = d;
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

  onCardToggled(code: string): void {
    this.expandedCode = this.expandedCode === code ? null : code;
  }
}
