import { Component, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MapComponent } from './components/map/map.component';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { DetailPanelComponent } from './components/detail-panel/detail-panel.component';
import { Destination, HUBS, DESTINATIONS, REGIONS, TYPES } from './data/destinations';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, MapComponent, SidebarComponent, DetailPanelComponent],
  template: `
    <!-- HERO OVERLAY -->
    <div class="hero" *ngIf="showHero" (click)="dismissHero()">
      <div class="hero__content">
        <span class="hero__label">AIR CANADA</span>
        <h1 class="hero__title">Destinations</h1>
        <p class="hero__sub">Explore 70+ routes from 8 Canadian hubs on an interactive 3D globe</p>
        <span class="hero__cta">Click to explore <span class="hero__arrow">→</span></span>
      </div>
    </div>

    <!-- HEADER -->
    <header class="header" [attr.inert]="selected ? '' : null">
      <div class="header__brand">
        <div class="header__logo">✈</div>
        <span class="header__name">Air Canada <span class="header__dim">Destinations</span></span>
      </div>
      <div class="header__right">
        <label class="header__label" for="home-city">HOME</label>
        <select id="home-city" [(ngModel)]="homeCity" (ngModelChange)="onHomeCityChange($event)" class="header__select" aria-label="Choose home airport">
          <option *ngFor="let h of hubNames" [value]="h">{{ h }}</option>
        </select>
        <div class="header__stats">
          <span class="header__stat">{{ filteredDestinations.length }} routes</span>
          <span class="header__dot">·</span>
          <button type="button" class="header__visited-btn" (click)="showVisitedPanel = !showVisitedPanel">
            {{ visitedCount }}/{{ totalCountries }} visited
          </button>
        </div>
      </div>
    </header>

    <!-- FILTERS -->
    <div class="filters" role="region" aria-label="Destination filters" [attr.inert]="selected ? '' : null">
      <label class="sr-only" for="destination-search">Search destinations</label>
      <input
        id="destination-search"
        [(ngModel)]="search"
        (ngModelChange)="onSearchChange($event)"
        placeholder="Search city or code…"
        class="filters__search"
        aria-label="Search by city, country, or airport code"
      />
      <button
        *ngIf="search"
        type="button"
        class="filters__clear"
        (click)="clearSearch()"
        aria-label="Clear search"
      >✕</button>
      <div class="filters__sep"></div>

      <button
        *ngFor="let r of regions"
        (click)="onRegionChange(r)"
        class="filters__chip"
        [class.filters__chip--active]="region === r"
        [attr.aria-pressed]="region === r"
      >{{ r }}</button>

      <div class="filters__sep"></div>

      <button
        *ngFor="let t of types"
        (click)="onTypeChange(t)"
        class="filters__type"
        [class.filters__type--active]="type === t"
        [attr.aria-pressed]="type === t"
      >{{ t === 'All' ? 'All Types' : t }}</button>

      <div class="filters__sep"></div>

      <button
        (click)="onToggleNewOnly()"
        class="filters__new"
        [class.filters__new--active]="newOnly"
        [attr.aria-pressed]="newOnly"
      >✦ New 2026</button>

      <button
        type="button"
        class="filters__reset"
        (click)="resetFilters($event)"
      >Reset</button>
    </div>
    <p class="sr-only" aria-live="polite">{{ filteredDestinations.length }} routes found</p>
    <p class="sr-only" aria-live="polite">{{ statusMessage }}</p>

    <!-- MAIN CONTENT -->
    <div class="main" [class.main--panel-open]="!!selected">
      <app-map
        class="main__globe"
        [attr.inert]="selected ? '' : null"
        [destinations]="filteredDestinations"
        [selected]="selected"
        [visitedCountries]="visitedCountries"
        [homeCity]="homeCity"
        (destinationSelected)="onSelect($event)"
      ></app-map>

      <app-detail-panel
        *ngIf="selected"
        [destination]="selected!"
        [homeCity]="homeCity"
        [visitedCountries]="visitedCountries"
        (visitedCountryToggled)="onVisitedCountryToggled($event)"
        (closed)="onPanelClosed()"
      ></app-detail-panel>

      <app-sidebar
        class="main__sidebar"
        [attr.inert]="selected ? '' : null"
        [destinations]="filteredDestinations"
        [selected]="selected"
        [visitedCountries]="visitedCountries"
        (destinationSelected)="onSelect($event)"
        (visitedCountryToggled)="onVisitedCountryToggled($event)"
      ></app-sidebar>
    </div>

    <!-- VISITED PANEL -->
    <section class="visited-panel" *ngIf="showVisitedPanel" aria-label="Visited countries list">
      <div class="visited-panel__header">
        <h2>Visited countries</h2>
        <div class="visited-panel__actions">
          <button type="button" class="visited-panel__danger" (click)="clearVisitedCountries()" [disabled]="!visitedCountries.length">Clear all</button>
          <button type="button" (click)="showVisitedPanel = false" aria-label="Close visited countries list">Close</button>
        </div>
      </div>
      <div class="visited-panel__bar">
        <div class="visited-panel__fill" [style.width.%]="visitedPercent"></div>
      </div>
      <p *ngIf="!visitedCountries.length" class="visited-panel__empty">No countries marked yet. Click "Mark visited" on any destination card.</p>
      <ul *ngIf="visitedCountries.length" class="visited-panel__list">
        <li *ngFor="let country of visitedCountries">
          <span>{{ country }}</span>
          <button type="button" (click)="onVisitedCountryToggled(country)">✕</button>
        </li>
      </ul>
    </section>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      background: #080b16;
      color: #eae6df;
    }

    /* ── HERO ── */
    .hero {
      position: fixed;
      inset: 0;
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(ellipse at 55% 45%, rgba(8,11,22,0.15) 0%, rgba(8,11,22,0.88) 70%);
      cursor: pointer;
      animation: fadeIn 0.8s ease;
    }
    .hero__content {
      text-align: center;
      max-width: 600px;
      padding: 24px;
    }
    .hero__label {
      display: block;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 4px;
      color: rgba(255,255,255,0.35);
      margin-bottom: 12px;
    }
    .hero__title {
      font-family: 'Source Serif 4', serif;
      font-size: clamp(48px, 8vw, 80px);
      font-weight: 700;
      color: #fff;
      letter-spacing: -2px;
      line-height: 1.05;
      margin-bottom: 16px;
    }
    .hero__sub {
      font-size: 17px;
      color: rgba(255,255,255,0.45);
      line-height: 1.5;
      margin-bottom: 36px;
    }
    .hero__cta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 600;
      color: #ff2d55;
      background: rgba(200,16,46,0.1);
      border: 1px solid rgba(200,16,46,0.2);
      padding: 10px 22px;
      border-radius: 999px;
      animation: pulse 2.5s ease infinite;
    }
    .hero__arrow { transition: transform 0.2s; }
    .hero:hover .hero__arrow { transform: translateX(4px); }

    /* ── HEADER ── */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      height: 48px;
      background: rgba(12, 15, 28, 0.6);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      flex-shrink: 0;
      z-index: 10;
    }
    .header__brand { display: flex; align-items: center; gap: 10px; }
    .header__logo {
      width: 30px; height: 30px; border-radius: 50%;
      background: #C8102E; display: flex; align-items: center;
      justify-content: center; font-size: 14px; color: white;
      box-shadow: 0 0 20px rgba(200,16,46,0.3);
    }
    .header__name {
      font-family: 'Source Serif 4', serif;
      font-size: 16px; font-weight: 700; color: #fff;
    }
    .header__dim { font-weight: 400; color: rgba(255,255,255,0.4); }
    .header__right { display: flex; align-items: center; gap: 10px; }
    .header__label {
      font-size: 10px; color: rgba(255,255,255,0.3); font-weight: 700;
      letter-spacing: 1px;
    }
    .header__select {
      border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
      padding: 5px 10px; font-size: 13px; font-weight: 600;
      color: #eae6df; background: rgba(255,255,255,0.05);
      cursor: pointer; outline: none; font-family: inherit;
    }
    .header__select option { background: #131829; color: #eae6df; }
    .header__stats {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; color: rgba(255,255,255,0.35);
    }
    .header__dot { opacity: 0.3; }
    .header__stat { white-space: nowrap; }
    .header__visited-btn {
      background: none; border: none; color: rgba(255,255,255,0.35);
      font-size: 12px; cursor: pointer; font-family: inherit;
      padding: 2px 0; border-bottom: 1px dotted rgba(255,255,255,0.15);
    }
    .header__visited-btn:hover { color: #34d399; }

    /* ── FILTERS ── */
    .filters {
      display: flex; align-items: center; gap: 5px;
      padding: 6px 20px;
      background: rgba(12, 15, 28, 0.5);
      backdrop-filter: blur(16px) saturate(160%);
      -webkit-backdrop-filter: blur(16px) saturate(160%);
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      flex-shrink: 0; overflow-x: auto;
      z-index: 10;
    }
    .filters__search {
      width: 200px; padding: 6px 10px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px; font-size: 13px; color: #eae6df;
      background: rgba(255,255,255,0.04); outline: none; font-family: inherit;
      &::placeholder { color: rgba(255,255,255,0.2); }
      &:focus { border-color: rgba(200,16,46,0.3); }
    }
    .filters__clear {
      padding: 6px 8px; border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.05);
      color: rgba(255,255,255,0.5); font-size: 12px;
      cursor: pointer; font-family: inherit;
    }
    .filters__sep {
      width: 1px; height: 16px; background: rgba(255,255,255,0.06); flex-shrink: 0;
    }
    .filters__chip {
      padding: 6px 12px; border-radius: 999px; border: 1px solid transparent;
      cursor: pointer; font-size: 12px; font-weight: 500;
      background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.45);
      white-space: nowrap; font-family: inherit; transition: all 0.15s;
      &.filters__chip--active {
        background: rgba(255,255,255,0.1);
        color: #fff; font-weight: 600;
        border-color: rgba(255,255,255,0.15);
      }
      &:hover:not(.filters__chip--active) { background: rgba(255,255,255,0.06); }
    }
    .filters__type {
      padding: 6px 12px; border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.06);
      cursor: pointer; font-size: 12px; font-weight: 500;
      background: transparent; color: rgba(255,255,255,0.35);
      white-space: nowrap; font-family: inherit; transition: all 0.15s;
      &.filters__type--active {
        border-color: rgba(255,255,255,0.2);
        color: #fff; font-weight: 600;
      }
    }
    .filters__new {
      padding: 6px 12px; border-radius: 999px; cursor: pointer;
      font-size: 12px; font-weight: 600; background: transparent;
      color: #ff2d55; border: 1px solid rgba(200,16,46,0.2);
      white-space: nowrap; font-family: inherit; transition: all 0.15s;
      &.filters__new--active {
        background: #C8102E; color: white; border-color: #C8102E;
        box-shadow: 0 0 16px rgba(200,16,46,0.3);
      }
    }
    .filters__reset {
      padding: 6px 10px; border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.06);
      background: rgba(255,255,255,0.03);
      color: rgba(255,255,255,0.35); font-size: 12px;
      cursor: pointer; font-family: inherit;
      &:hover { color: rgba(255,255,255,0.6); }
    }

    /* ── MAIN ── */
    .main {
      flex: 1; display: flex; overflow: hidden; min-height: 0;
      position: relative;
    }
    .main--panel-open::before {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(8, 11, 22, 0.3);
      z-index: 900;
      pointer-events: auto;
    }
    .main__globe { flex: 1; position: relative; }
    .main__sidebar {
      flex: 0 0 320px;
      border-left: 1px solid rgba(255,255,255,0.06);
      background: rgba(12, 15, 28, 0.5);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }

    /* ── VISITED PANEL ── */
    .visited-panel {
      background: rgba(12, 15, 28, 0.95);
      border-top: 1px solid rgba(255,255,255,0.06);
      padding: 14px 20px;
      max-height: 220px;
      overflow-y: auto;
      animation: slideUp 0.25s ease;
    }
    .visited-panel__header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 10px;
      h2 { font-size: 14px; color: #eae6df; font-weight: 700; }
    }
    .visited-panel__actions {
      display: flex; gap: 8px;
      button {
        border: 1px solid rgba(255,255,255,0.08);
        background: rgba(255,255,255,0.04);
        color: rgba(255,255,255,0.5);
        border-radius: 6px; padding: 4px 10px;
        cursor: pointer; font-size: 11px; font-family: inherit;
      }
    }
    .visited-panel__danger {
      border-color: rgba(239,68,68,0.2) !important;
      color: #f87171 !important;
      &:disabled { opacity: 0.3; cursor: not-allowed; }
    }
    .visited-panel__bar {
      height: 4px; width: 100%; border-radius: 999px;
      background: rgba(255,255,255,0.06); overflow: hidden; margin-bottom: 10px;
    }
    .visited-panel__fill {
      height: 100%;
      background: linear-gradient(90deg, #6366f1, #34d399);
      border-radius: 999px;
      transition: width 0.3s ease;
    }
    .visited-panel__list {
      list-style: none;
      display: flex; flex-wrap: wrap; gap: 6px;
      li {
        display: flex; align-items: center; gap: 8px;
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 8px; padding: 5px 10px;
        font-size: 12px; color: rgba(255,255,255,0.6);
      }
      button {
        border: none; background: none;
        color: rgba(255,255,255,0.25); cursor: pointer;
        font-size: 11px; padding: 0;
        &:hover { color: #f87171; }
      }
    }
    .visited-panel__empty {
      color: rgba(255,255,255,0.3); font-size: 13px;
    }

    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0;
      margin: -1px; overflow: hidden; clip: rect(0,0,0,0);
      white-space: nowrap; border: 0;
    }

    /* ── RESPONSIVE ── */
    @media (max-width: 1100px) {
      .main__sidebar { flex-basis: 280px; }
    }

    @media (max-width: 900px) {
      .header { padding: 0 14px; }
      .filters { padding: 6px 14px; }
      .header__stats { display: none; }
      .main {
        flex-direction: column;
        overflow: auto;
      }
      .main__globe { min-height: 55vh; }
      .main__sidebar {
        flex: 1 1 auto;
        border-left: none;
        border-top: 1px solid rgba(255,255,255,0.06);
      }
    }

    @media (max-width: 600px) {
      .filters__search { width: 150px; }
      .hero__title { letter-spacing: -1px; }
    }
  `]
})
export class AppComponent {
  regions = REGIONS;
  types = TYPES;
  hubNames = HUBS.map(h => h.name);

  homeCity = 'Toronto';
  region = 'All';
  type = 'All';
  search = '';
  newOnly = false;
  selected: Destination | null = null;
  filteredDestinations: Destination[] = [];
  visitedCountries: string[] = [];
  showVisitedPanel = false;
  showHero = !sessionStorage.getItem('acExplorer.heroSeen');
  private lastFocusedElement: HTMLElement | null = null;
  statusMessage = '';
  private readonly visitedStorageKey = 'acExplorer.visitedCountries';
  private readonly uniqueCountries = Array.from(new Set(DESTINATIONS.map(d => d.country))).sort();

  constructor() {
    this.loadVisitedCountries();
    this.recomputeFiltered();
  }

  @HostListener('document:keydown')
  onFirstKey() {
    if (this.showHero) this.dismissHero();
  }

  dismissHero() {
    this.showHero = false;
    sessionStorage.setItem('acExplorer.heroSeen', '1');
  }

  recomputeFiltered() {
    this.filteredDestinations = DESTINATIONS.filter(d => {
      if (this.region !== 'All' && d.region !== this.region) return false;
      if (this.type !== 'All' && d.type !== this.type) return false;
      if (this.newOnly && !d.isNew) return false;
      if (this.search) {
        const q = this.search.toLowerCase();
        return d.city.toLowerCase().includes(q)
          || d.country.toLowerCase().includes(q)
          || d.code.toLowerCase().includes(q);
      }
      return true;
    });

    if (this.selected && !this.filteredDestinations.some(d => d.code === this.selected?.code)) {
      this.selected = null;
      this.announceStatus('Selection cleared because it no longer matches the active filters.');
      this.restoreFocus();
    }
  }

  onSelect(dest: Destination | null) {
    if (this.showHero) this.dismissHero();
    if (!dest) {
      this.selected = null;
      this.announceStatus('Selection cleared.');
      this.restoreFocus();
      return;
    }
    this.lastFocusedElement = document.activeElement as HTMLElement | null;
    this.selected = dest;
    this.statusMessage = '';
  }

  resetFilters(event?: Event) {
    if (event?.target instanceof HTMLElement) {
      this.lastFocusedElement = event.target;
    }
    this.region = 'All';
    this.type = 'All';
    this.search = '';
    this.newOnly = false;
    this.selected = null;
    this.announceStatus('Filters reset.');
    this.restoreFocus();
    this.recomputeFiltered();
  }

  onRegionChange(region: string) {
    if (this.showHero) this.dismissHero();
    this.region = region;
    this.recomputeFiltered();
  }

  onTypeChange(type: string) {
    this.type = type;
    this.recomputeFiltered();
  }

  onSearchChange(value: string) {
    if (this.showHero) this.dismissHero();
    this.search = value;
    this.recomputeFiltered();
  }

  onToggleNewOnly() {
    this.newOnly = !this.newOnly;
    this.recomputeFiltered();
  }

  onHomeCityChange(value: string) {
    this.homeCity = value;
  }

  clearSearch() {
    this.search = '';
    this.recomputeFiltered();
  }

  onPanelClosed() {
    this.selected = null;
    this.announceStatus('Route details closed.');
    this.restoreFocus();
  }

  private restoreFocus() {
    if (this.lastFocusedElement && this.lastFocusedElement.isConnected) {
      this.lastFocusedElement.focus();
      if (document.activeElement === this.lastFocusedElement) return;
    }
    const searchInput = document.getElementById('destination-search') as HTMLInputElement | null;
    searchInput?.focus();
  }

  private announceStatus(message: string) {
    this.statusMessage = '';
    setTimeout(() => { this.statusMessage = message; }, 0);
  }

  onVisitedCountryToggled(country: string) {
    if (!this.uniqueCountries.includes(country)) {
      this.announceStatus('Unknown country could not be updated.');
      return;
    }
    const set = new Set(this.visitedCountries);
    if (set.has(country)) {
      set.delete(country);
      this.announceStatus(`${country} removed from visited countries.`);
    } else {
      set.add(country);
      this.announceStatus(`${country} marked as visited.`);
    }
    this.visitedCountries = Array.from(set).sort();
    this.persistVisitedCountries();
  }

  clearVisitedCountries() {
    if (!this.visitedCountries.length) return;
    this.visitedCountries = [];
    this.persistVisitedCountries();
    this.announceStatus('All visited countries cleared.');
  }

  get totalCountries(): number { return this.uniqueCountries.length; }
  get visitedCount(): number { return this.visitedCountries.length; }
  get visitedPercent(): number {
    if (!this.totalCountries) return 0;
    return Math.round((this.visitedCount / this.totalCountries) * 100);
  }

  private loadVisitedCountries() {
    try {
      const raw = localStorage.getItem(this.visitedStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const allowed = new Set(this.uniqueCountries);
      this.visitedCountries = parsed
        .filter((c): c is string => typeof c === 'string')
        .filter(c => allowed.has(c))
        .sort();
    } catch {
      this.visitedCountries = [];
    }
  }

  private persistVisitedCountries() {
    try {
      localStorage.setItem(this.visitedStorageKey, JSON.stringify(this.visitedCountries));
    } catch {
      this.announceStatus('Could not save visited countries on this device.');
    }
  }
}
