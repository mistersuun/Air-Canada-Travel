import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HUBS } from '../../data/destinations';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <header class="header">
      <div class="header__brand">
        <img class="header__logo" src="assets/icon.svg" alt="AC Trips logo">
        <span class="header__name">Air Canada <span class="header__dim">Trips</span></span>
      </div>
      <div class="header__right">
        <label class="header__hub-label" for="hub-select">FROM</label>
        <select
          id="hub-select"
          class="header__hub-select"
          [ngModel]="homeCity"
          (ngModelChange)="homeCityChanged.emit($event)"
          aria-label="Select home airport"
        >
          <option *ngFor="let h of hubs" [value]="h.name">{{ h.code }} · {{ h.name }}</option>
        </select>
      </div>
    </header>
  `,
  styles: [`
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      height: 52px;
      background: #fff;
      border-bottom: 1px solid #e8e8ed;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .header__brand { display: flex; align-items: center; gap: 10px; }
    .header__logo {
      width: 28px; height: 28px; border-radius: 6px;
    }
    .header__name { font-size: 16px; font-weight: 700; color: #1d1d1f; letter-spacing: -0.2px; }
    .header__dim { font-weight: 400; color: #86868b; }
    .header__right { display: flex; align-items: center; gap: 8px; }
    .header__hub-label {
      font-size: 10px; font-weight: 700; color: #86868b;
      letter-spacing: 1px; text-transform: uppercase;
    }
    .header__hub-select {
      appearance: none;
      background: #f5f5f7;
      border: 1px solid #e8e8ed;
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 13px; font-weight: 600; color: #1d1d1f;
      font-family: inherit; cursor: pointer; outline: none;
    }
    .header__hub-select:focus-visible { outline: 2px solid #C8102E; outline-offset: 2px; }
    @media (max-width: 600px) {
      .header { padding: 0 16px; }
      .header__hub-label { display: none; }
      .header__name { font-size: 14px; }
    }
  `]
})
export class HeaderComponent {
  @Input() homeCity = 'Toronto';
  @Output() homeCityChanged = new EventEmitter<string>();
  readonly hubs = HUBS;
}
