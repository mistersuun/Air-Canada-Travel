# AC Trips — Trip Planner Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3D globe explorer with a week-first trip planner — pick a departure week, see every route with flights that week, tap to see exact times.

**Architecture:** Pure Angular 21 standalone components. All state in AppComponent. A new pure utility (`week.ts`) drives schedule filtering and day-pill logic. Old globe/sidebar/detail-panel components are deleted entirely.

**Tech Stack:** Angular 21 standalone, TypeScript, Inter font (replaces DM Sans/Source Serif 4), Vitest for tests. `globe.gl` removed.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/app/utils/week.ts` | `getWeekStart`, `getFlightsForWeek`, `routeHasFlightsInWeek`, `formatWeekLabel`, `formatWeekNavLabel`, `formatDayLabel`, `DayFlight` interface |
| Create | `src/app/utils/week.spec.ts` | Unit tests for all week utils |
| Create | `src/app/components/header/header.component.ts` | Brand logo + hub selector dropdown |
| Create | `src/app/components/week-strip/week-strip.component.ts` | Week nav (prev/next arrows, label, route count) + region filter chips |
| Create | `src/app/components/route-card/route-card.component.ts` | Single route card, collapsed + expanded inline detail |
| Create | `src/app/components/route-list/route-list.component.ts` | ngFor container for route cards |
| Rewrite | `src/app/app.component.ts` | Root shell, all state, computed `filteredDestinations` |
| Rewrite | `src/app/app.component.spec.ts` | Tests for week navigation, filtering, card toggle |
| Rewrite | `src/styles.scss` | Light theme globals, Inter font, no dark vars |
| Modify | `src/index.html` | Swap Google Fonts to Inter only |
| Modify | `package.json` | Remove `globe.gl` |
| Delete | `src/app/components/map/` | Entire directory |
| Delete | `src/app/components/sidebar/` | Entire directory |
| Delete | `src/app/components/detail-panel/` | Entire directory |
| Delete | `src/globe.gl.d.ts` | Type shim no longer needed |

---

## Task 1: Week Utility — `getFlightsForWeek`

**Files:**
- Create: `src/app/utils/week.ts`
- Create: `src/app/utils/week.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/utils/week.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  getWeekStart,
  getFlightsForWeek,
  routeHasFlightsInWeek,
  formatWeekLabel,
  formatWeekNavLabel,
  formatDayLabel,
} from './week';

describe('getWeekStart', () => {
  it('returns Monday when given a Monday', () => {
    const mon = new Date('2026-06-08T12:00:00'); // June 8 2026 is a Monday
    const result = getWeekStart(mon);
    expect(result.getDay()).toBe(1); // 1 = Monday
    expect(result.getDate()).toBe(8);
    expect(result.getHours()).toBe(0);
  });

  it('returns the preceding Monday when given a Wednesday', () => {
    const wed = new Date('2026-06-10T09:00:00'); // June 10 is a Wednesday
    const result = getWeekStart(wed);
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(8);
  });

  it('returns the preceding Monday when given a Sunday', () => {
    const sun = new Date('2026-06-14T20:00:00'); // June 14 is a Sunday
    const result = getWeekStart(sun);
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(8);
  });

  it('does not mutate the input date', () => {
    const d = new Date('2026-06-10T09:00:00');
    const before = d.getTime();
    getWeekStart(d);
    expect(d.getTime()).toBe(before);
  });
});

describe('getFlightsForWeek', () => {
  // YYZ → CUN has schedules in ROUTE_SCHEDULES
  const weekStart = new Date('2026-11-02T00:00:00'); // Mon Nov 2 2026

  it('returns exactly 7 DayFlight entries', () => {
    const result = getFlightsForWeek('YYZ', 'CUN', weekStart);
    expect(result).toHaveLength(7);
  });

  it('sets date correctly for each day of the week', () => {
    const result = getFlightsForWeek('YYZ', 'CUN', weekStart);
    expect(result[0].date.getDate()).toBe(2);  // Mon Nov 2
    expect(result[6].date.getDate()).toBe(8);  // Sun Nov 8
  });

  it('returns flies=true for days that match schedule', () => {
    // YYZ CUN Nov 2026: days "Wed,Sat,Sun" per schedules.ts
    const result = getFlightsForWeek('YYZ', 'CUN', weekStart);
    const wed = result[2]; // index 2 = Wednesday
    const sat = result[5]; // index 5 = Saturday
    const sun = result[6]; // index 6 = Sunday
    expect(wed.flies).toBe(true);
    expect(sat.flies).toBe(true);
    expect(sun.flies).toBe(true);
  });

  it('returns flies=false for days with no flight', () => {
    const result = getFlightsForWeek('YYZ', 'CUN', weekStart);
    const mon = result[0];
    const tue = result[1];
    const thu = result[3];
    const fri = result[4];
    expect(mon.flies).toBe(false);
    expect(tue.flies).toBe(false);
    expect(thu.flies).toBe(false);
    expect(fri.flies).toBe(false);
  });

  it('populates flightNumber, departure, arrival when flies=true', () => {
    const result = getFlightsForWeek('YYZ', 'CUN', weekStart);
    const sat = result[5];
    expect(sat.flightNumber).toBeDefined();
    expect(sat.departure).toBeDefined();
    expect(sat.arrival).toBeDefined();
  });

  it('returns all flies=false for unknown route', () => {
    const result = getFlightsForWeek('YYZ', 'ZZZ', weekStart);
    expect(result.every(d => !d.flies)).toBe(true);
  });

  it('does not mutate weekStart', () => {
    const d = new Date('2026-11-02T00:00:00');
    const before = d.getTime();
    getFlightsForWeek('YYZ', 'CUN', d);
    expect(d.getTime()).toBe(before);
  });
});

describe('routeHasFlightsInWeek', () => {
  it('returns true for a route with flights in the week', () => {
    const weekStart = new Date('2026-11-02T00:00:00');
    expect(routeHasFlightsInWeek('YYZ', 'CUN', weekStart)).toBe(true);
  });

  it('returns false for an unknown route', () => {
    const weekStart = new Date('2026-11-02T00:00:00');
    expect(routeHasFlightsInWeek('YYZ', 'ZZZ', weekStart)).toBe(false);
  });
});

describe('formatWeekLabel', () => {
  it('formats a full week label', () => {
    const weekStart = new Date('2026-06-08T00:00:00');
    expect(formatWeekLabel(weekStart)).toBe('Jun 8 – 14, 2026');
  });
});

describe('formatWeekNavLabel', () => {
  it('formats a short nav label', () => {
    const weekStart = new Date('2026-06-08T00:00:00');
    expect(formatWeekNavLabel(weekStart)).toBe('Jun 8');
  });
});

describe('formatDayLabel', () => {
  it('formats a day label for flight rows', () => {
    const d = new Date('2026-06-09T00:00:00'); // Tuesday
    expect(formatDayLabel(d)).toBe('Tue Jun 9');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /home/v/Documents/Projects/Air-Canada-Travel && npx vitest run src/app/utils/week.spec.ts 2>&1 | tail -20
```
Expected: errors about missing module `./week`.

- [ ] **Step 3: Create `src/app/utils/week.ts`**

```typescript
import { getSchedulesForRoute } from '../data/schedules';

export interface DayFlight {
  date: Date;
  flies: boolean;
  flightNumber?: string;
  departure?: string;
  arrival?: string;
  aircraft?: string;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Returns the Monday of the week containing `date`. Does not mutate input. */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const jsDay = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysFromMonday = jsDay === 0 ? 6 : jsDay - 1;
  d.setDate(d.getDate() - daysFromMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns one DayFlight per day Mon–Sun for the given week.
 * weekStart must be a Monday at midnight (use getWeekStart).
 * Does not mutate weekStart.
 */
export function getFlightsForWeek(
  hubCode: string,
  destCode: string,
  weekStart: Date
): DayFlight[] {
  const schedules = getSchedulesForRoute(hubCode, destCode);

  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    const dayName = DAY_NAMES[i];

    const match = schedules.find(s => {
      const from = new Date(s.fromDate + 'T00:00:00');
      const to = new Date(s.toDate + 'T00:00:00');
      return date >= from && date <= to && s.days.includes(dayName);
    });

    if (match) {
      return {
        date,
        flies: true,
        flightNumber: match.flightNumber,
        departure: match.departure,
        arrival: match.arrival,
        aircraft: match.aircraft,
      };
    }
    return { date, flies: false };
  });
}

/** Returns true if any day in the 7-day week has a flight for this route. */
export function routeHasFlightsInWeek(
  hubCode: string,
  destCode: string,
  weekStart: Date
): boolean {
  return getFlightsForWeek(hubCode, destCode, weekStart).some(d => d.flies);
}

/** "Jun 8 – 14, 2026" */
export function formatWeekLabel(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const startStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endDay = end.toLocaleDateString('en-US', { day: 'numeric' });
  return `${startStr} – ${endDay}, ${end.getFullYear()}`;
}

/** "Jun 8" — used in week strip prev/next arrows */
export function formatWeekNavLabel(weekStart: Date): string {
  return weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Tue Jun 9" — used in expanded flight rows */
export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /home/v/Documents/Projects/Air-Canada-Travel && npx vitest run src/app/utils/week.spec.ts 2>&1 | tail -20
```
Expected: all tests pass. If `formatWeekLabel` or `formatDayLabel` fail due to locale formatting differences in the CI environment, check that the system locale produces `"Jun 8"` for `en-US` — if not, adjust the expected strings to match actual output.

- [ ] **Step 5: Commit**

```bash
cd /home/v/Documents/Projects/Air-Canada-Travel
git add src/app/utils/week.ts src/app/utils/week.spec.ts
git commit -m "feat: add week utility — getFlightsForWeek, routeHasFlightsInWeek, formatters"
```

---

## Task 2: HeaderComponent

**Files:**
- Create: `src/app/components/header/header.component.ts`

- [ ] **Step 1: Create the component**

```typescript
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
        <div class="header__logo">✈</div>
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
      width: 28px; height: 28px; border-radius: 50%;
      background: #C8102E; color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px;
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
```

- [ ] **Step 2: Commit**

```bash
cd /home/v/Documents/Projects/Air-Canada-Travel
git add src/app/components/header/header.component.ts
git commit -m "feat: add HeaderComponent with hub selector"
```

---

## Task 3: WeekStripComponent (week nav + filter chips)

**Files:**
- Create: `src/app/components/week-strip/week-strip.component.ts`

The spec puts region filters directly below the week strip. This component owns both rows to keep week-strip sticky as a single unit.

- [ ] **Step 1: Create the component**

```typescript
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { formatWeekLabel, formatWeekNavLabel } from '../../utils/week';
import { REGIONS } from '../../data/destinations';

@Component({
  selector: 'app-week-strip',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="week-strip">
      <button class="week-strip__nav" (click)="prev.emit()" [attr.aria-label]="'Go to week of ' + prevLabel">
        ← {{ prevLabel }}
      </button>
      <div class="week-strip__centre">
        <div class="week-strip__label">{{ weekLabel }}</div>
        <div class="week-strip__sub" aria-live="polite">{{ routeCount }} routes with departures</div>
      </div>
      <button class="week-strip__nav" (click)="next.emit()" [attr.aria-label]="'Go to week of ' + nextLabel">
        {{ nextLabel }} →
      </button>
    </div>

    <div class="filter-chips" role="group" aria-label="Filter by region">
      <button
        *ngFor="let r of regions"
        class="chip"
        [class.chip--active]="activeRegion === r"
        [attr.aria-pressed]="activeRegion === r"
        (click)="regionSelected.emit(r)"
      >{{ r === 'All' ? 'All regions' : r }}</button>
    </div>
  `,
  styles: [`
    .week-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 24px;
      background: #fafafa;
      border-bottom: 1px solid #f2f2f2;
      position: sticky;
      top: 52px;
      z-index: 90;
    }
    .week-strip__nav {
      background: none; border: none; cursor: pointer;
      font-size: 13px; font-weight: 600; color: #C8102E;
      font-family: inherit; padding: 4px 0;
    }
    .week-strip__nav:focus-visible { outline: 2px solid #C8102E; outline-offset: 2px; border-radius: 4px; }
    .week-strip__centre { text-align: center; }
    .week-strip__label { font-size: 15px; font-weight: 700; color: #1d1d1f; letter-spacing: -0.2px; }
    .week-strip__sub { font-size: 12px; color: #86868b; margin-top: 1px; }

    .filter-chips {
      display: flex;
      gap: 6px;
      padding: 10px 24px;
      border-bottom: 1px solid #f2f2f2;
      overflow-x: auto;
      background: #fff;
      position: sticky;
      top: 100px;
      z-index: 89;
    }
    .filter-chips::-webkit-scrollbar { display: none; }
    .chip {
      padding: 5px 14px; border-radius: 999px;
      font-size: 12px; font-weight: 500; font-family: inherit;
      border: 1px solid #e0e0e0;
      background: #fff; color: #1d1d1f;
      white-space: nowrap; cursor: pointer; flex-shrink: 0;
      transition: background 0.12s, color 0.12s;
    }
    .chip--active { background: #1d1d1f; color: #fff; border-color: #1d1d1f; }
    .chip:focus-visible { outline: 2px solid #C8102E; outline-offset: 2px; }

    @media (max-width: 600px) {
      .week-strip { padding: 10px 16px; }
      .week-strip__sub { display: none; }
      .week-strip__label { font-size: 14px; }
      .filter-chips { padding: 8px 16px; }
    }
  `]
})
export class WeekStripComponent {
  @Input() weekStart!: Date;
  @Input() routeCount = 0;
  @Input() activeRegion = 'All';
  @Output() prev = new EventEmitter<void>();
  @Output() next = new EventEmitter<void>();
  @Output() regionSelected = new EventEmitter<string>();

  readonly regions = REGIONS;

  get weekLabel(): string {
    return formatWeekLabel(this.weekStart);
  }

  get prevLabel(): string {
    const d = new Date(this.weekStart);
    d.setDate(d.getDate() - 7);
    return formatWeekNavLabel(d);
  }

  get nextLabel(): string {
    const d = new Date(this.weekStart);
    d.setDate(d.getDate() + 7);
    return formatWeekNavLabel(d);
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/v/Documents/Projects/Air-Canada-Travel
git add src/app/components/week-strip/week-strip.component.ts
git commit -m "feat: add WeekStripComponent with week nav and region filter chips"
```

---

## Task 4: RouteCardComponent

**Files:**
- Create: `src/app/components/route-card/route-card.component.ts`

- [ ] **Step 1: Create the component**

```typescript
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Destination, REGION_COLORS } from '../../data/destinations';
import { DayFlight, getFlightsForWeek, formatDayLabel } from '../../utils/week';

const DAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

@Component({
  selector: 'app-route-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="card"
      [class.card--expanded]="expanded"
      (click)="toggled.emit()"
      (keydown.enter)="toggled.emit()"
      (keydown.space)="$event.preventDefault(); toggled.emit()"
      role="button"
      [attr.tabindex]="0"
      [attr.aria-expanded]="expanded"
      [attr.aria-label]="destination.city + ' ' + destination.code + ' route details'"
    >
      <!-- Top row -->
      <div class="card__top">
        <div class="card__info">
          <div class="card__meta">
            {{ hubCode }} → {{ destination.code }}
            &nbsp;·&nbsp;
            {{ destination.aircraft }}
            <span *ngIf="destination.isNew" class="card__new">NEW</span>
          </div>
          <div class="card__city">{{ destination.city }}</div>
          <div class="card__sub">{{ destination.country }} · {{ destination.region }}</div>
        </div>
        <div class="card__right">
          <div class="card__code" [style.color]="regionColor">{{ destination.code }}</div>
          <div class="card__duration">{{ destination.duration }} direct</div>
        </div>
      </div>

      <!-- Day pills -->
      <div class="card__days" aria-label="Operating days this week">
        <div
          *ngFor="let day of flights; let i = index"
          class="day-pill"
          [class.day-pill--on]="day.flies"
          [attr.aria-label]="dayInitials[i] + (day.flies ? ' has a flight' : ' no flight')"
        >{{ dayInitials[i] }}</div>
      </div>

      <!-- Expanded detail -->
      <div class="card__detail" *ngIf="expanded" role="region" aria-label="Flight times this week">
        <div class="detail__label">FLIGHTS THIS WEEK</div>

        <div
          *ngFor="let day of flights"
          class="flight-row"
          [class.flight-row--none]="!day.flies"
        >
          <span class="flight-row__date">{{ formatDay(day.date) }}</span>
          <span class="flight-row__num">{{ day.flies ? day.flightNumber : '' }}</span>
          <span class="flight-row__time" *ngIf="day.flies">
            {{ day.departure }} → {{ day.arrival }}
          </span>
          <span class="flight-row__none" *ngIf="!day.flies">No departure</span>
        </div>

        <div class="detail__also" *ngIf="destination.fromCities.length > 1">
          Also from:
          {{ destination.fromCities.filter(c => c !== hubCityName).join(' · ') }}
        </div>
      </div>
    </div>
  `,
  styles: [`
    .card {
      background: #fff;
      border: 1px solid #e8e8ed;
      border-radius: 14px;
      padding: 14px 16px;
      cursor: pointer;
      transition: box-shadow 0.15s, border-color 0.15s;
      outline: none;
    }
    .card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.07); border-color: #d0d0d8; }
    .card:focus-visible { outline: 2px solid #C8102E; outline-offset: 2px; }
    .card--expanded { border-color: #C8102E; box-shadow: 0 0 0 3px rgba(200,16,46,0.08); }

    .card__top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
    .card__meta { font-size: 11px; color: #86868b; margin-bottom: 3px; }
    .card__new {
      font-size: 9px; font-weight: 700; background: #C8102E; color: #fff;
      padding: 1px 5px; border-radius: 3px; margin-left: 4px; vertical-align: middle;
    }
    .card__city { font-size: 16px; font-weight: 700; color: #1d1d1f; letter-spacing: -0.3px; }
    .card__sub { font-size: 12px; color: #86868b; margin-top: 1px; }
    .card__right { text-align: right; flex-shrink: 0; margin-left: 12px; }
    .card__code { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; line-height: 1; }
    .card__duration { font-size: 11px; color: #86868b; margin-top: 2px; }

    .card__days { display: flex; gap: 4px; }
    .day-pill {
      flex: 1; height: 22px; border-radius: 6px;
      font-size: 9px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }
    .day-pill--on  { background: #fff0f2; color: #C8102E; border: 1px solid #ffc7cf; }
    .day-pill:not(.day-pill--on) { background: #f5f5f7; color: #c7c7cc; border: 1px solid #e8e8ed; }

    .card__detail {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid #f2f2f2;
    }
    .detail__label {
      font-size: 10px; font-weight: 700; color: #86868b;
      letter-spacing: 1px; text-transform: uppercase;
      margin-bottom: 8px;
    }
    .flight-row {
      display: flex; align-items: center; gap: 12px;
      padding: 7px 0;
      border-bottom: 1px solid #f5f5f5;
      font-size: 12px;
    }
    .flight-row:last-of-type { border-bottom: none; }
    .flight-row__date { font-weight: 600; color: #1d1d1f; min-width: 80px; }
    .flight-row__num { color: #86868b; min-width: 48px; }
    .flight-row__time { color: #1d1d1f; font-weight: 600; margin-left: auto; }
    .flight-row--none { opacity: 0.4; }
    .flight-row__none { color: #86868b; font-style: italic; }
    .detail__also { font-size: 12px; color: #86868b; margin-top: 10px; }
  `]
})
export class RouteCardComponent {
  @Input() destination!: Destination;
  @Input() hubCode = 'YYZ';
  @Input() hubCityName = 'Toronto';
  @Input() weekStart!: Date;
  @Input() expanded = false;
  @Output() toggled = new EventEmitter<void>();

  readonly dayInitials = DAY_INITIALS;

  get flights(): DayFlight[] {
    return getFlightsForWeek(this.hubCode, this.destination.code, this.weekStart);
  }

  get regionColor(): string {
    return REGION_COLORS[this.destination.region] || '#86868b';
  }

  formatDay(date: Date): string {
    return formatDayLabel(date);
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/v/Documents/Projects/Air-Canada-Travel
git add src/app/components/route-card/route-card.component.ts
git commit -m "feat: add RouteCardComponent with day pills and inline expanded detail"
```

---

## Task 5: RouteListComponent

**Files:**
- Create: `src/app/components/route-list/route-list.component.ts`

- [ ] **Step 1: Create the component**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
cd /home/v/Documents/Projects/Air-Canada-Travel
git add src/app/components/route-list/route-list.component.ts
git commit -m "feat: add RouteListComponent"
```

---

## Task 6: Rewrite AppComponent

**Files:**
- Modify: `src/app/app.component.ts` (full rewrite)

- [ ] **Step 1: Replace `src/app/app.component.ts`**

```typescript
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Destination, DESTINATIONS, HUBS, REGIONS } from './data/destinations';
import { getWeekStart, routeHasFlightsInWeek } from './utils/week';
import { HeaderComponent } from './components/header/header.component';
import { WeekStripComponent } from './components/week-strip/week-strip.component';
import { RouteListComponent } from './components/route-list/route-list.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, HeaderComponent, WeekStripComponent, RouteListComponent],
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
```

- [ ] **Step 2: Commit**

```bash
cd /home/v/Documents/Projects/Air-Canada-Travel
git add src/app/app.component.ts
git commit -m "feat: rewrite AppComponent — week-first layout, no globe"
```

---

## Task 7: Update Global Styles and HTML

**Files:**
- Modify: `src/styles.scss`
- Modify: `src/index.html`

- [ ] **Step 1: Replace `src/styles.scss`**

```scss
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  height: 100%;
  background: #f5f5f7;
  color: #1d1d1f;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  overflow-y: auto;
}

button, input, select, a {
  &:focus-visible {
    outline: 2px solid #C8102E;
    outline-offset: 2px;
  }
}

::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #d0d0d8; border-radius: 3px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 2: Replace `src/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Air Canada Trips</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#ffffff">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body>
  <app-root></app-root>
</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
cd /home/v/Documents/Projects/Air-Canada-Travel
git add src/styles.scss src/index.html
git commit -m "feat: switch to light theme and Inter font"
```

---

## Task 8: Delete Old Components and Remove globe.gl

**Files:**
- Delete: `src/app/components/map/` (entire directory)
- Delete: `src/app/components/sidebar/` (entire directory)
- Delete: `src/app/components/detail-panel/` (entire directory)
- Delete: `src/globe.gl.d.ts`
- Modify: `package.json`

- [ ] **Step 1: Delete old files**

```bash
cd /home/v/Documents/Projects/Air-Canada-Travel
rm -rf src/app/components/map
rm -rf src/app/components/sidebar
rm -rf src/app/components/detail-panel
rm -f src/globe.gl.d.ts
```

- [ ] **Step 2: Remove globe.gl from package.json**

In `package.json`, remove this line from `dependencies`:
```
"globe.gl": "^2.45.1",
```

- [ ] **Step 3: Uninstall**

```bash
cd /home/v/Documents/Projects/Air-Canada-Travel
npm uninstall globe.gl
```

- [ ] **Step 4: Commit**

```bash
cd /home/v/Documents/Projects/Air-Canada-Travel
git add -A
git commit -m "chore: remove globe, sidebar, detail-panel components and globe.gl dependency"
```

---

## Task 9: Rewrite AppComponent Tests

**Files:**
- Modify: `src/app/app.component.spec.ts` (full rewrite)

- [ ] **Step 1: Replace `src/app/app.component.spec.ts`**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppComponent } from './app.component';
import { getWeekStart } from './utils/week';

describe('AppComponent', () => {
  let component: AppComponent;

  beforeEach(() => {
    component = new AppComponent();
  });

  it('initialises weekStart to the Monday of the current week', () => {
    expect(component.weekStart.getDay()).toBe(1); // 1 = Monday
  });

  it('initialises to Toronto hub', () => {
    expect(component.homeCity).toBe('Toronto');
    expect(component.hubCode).toBe('YYZ');
  });

  it('prevWeek steps back 7 days and clears expandedCode', () => {
    const before = new Date(component.weekStart);
    component.expandedCode = 'LHR';
    component.prevWeek();
    const diff = before.getTime() - component.weekStart.getTime();
    expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
    expect(component.expandedCode).toBeNull();
  });

  it('nextWeek steps forward 7 days and clears expandedCode', () => {
    const before = new Date(component.weekStart);
    component.expandedCode = 'LHR';
    component.nextWeek();
    const diff = component.weekStart.getTime() - before.getTime();
    expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
    expect(component.expandedCode).toBeNull();
  });

  it('onHomeCityChange updates hubCode and clears expandedCode', () => {
    component.expandedCode = 'CDG';
    component.onHomeCityChange('Vancouver');
    expect(component.homeCity).toBe('Vancouver');
    expect(component.hubCode).toBe('YVR');
    expect(component.expandedCode).toBeNull();
  });

  it('onRegionSelected updates activeRegion and clears expandedCode', () => {
    component.expandedCode = 'CDG';
    component.onRegionSelected('Europe');
    expect(component.activeRegion).toBe('Europe');
    expect(component.expandedCode).toBeNull();
  });

  it('onCardToggled expands a card', () => {
    component.onCardToggled('LHR');
    expect(component.expandedCode).toBe('LHR');
  });

  it('onCardToggled collapses a card that is already expanded', () => {
    component.expandedCode = 'LHR';
    component.onCardToggled('LHR');
    expect(component.expandedCode).toBeNull();
  });

  it('onCardToggled switches to a different card', () => {
    component.expandedCode = 'LHR';
    component.onCardToggled('CDG');
    expect(component.expandedCode).toBe('CDG');
  });

  it('filteredDestinations returns only routes active in the selected week', () => {
    // Use a week known to have flights (Nov 2026 has many active schedules)
    component.homeCity = 'Toronto';
    component.weekStart = getWeekStart(new Date('2026-11-02T00:00:00'));
    expect(component.filteredDestinations.length).toBeGreaterThan(0);
  });

  it('filteredDestinations filters by region', () => {
    component.homeCity = 'Toronto';
    component.weekStart = getWeekStart(new Date('2026-11-02T00:00:00'));
    component.activeRegion = 'Europe';
    const results = component.filteredDestinations;
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(d => d.region === 'Europe')).toBe(true);
  });

  it('filteredDestinations returns empty for an obscure week with no flights', () => {
    component.weekStart = getWeekStart(new Date('2020-01-06T00:00:00'));
    expect(component.filteredDestinations).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run all tests**

```bash
cd /home/v/Documents/Projects/Air-Canada-Travel && npm test 2>&1 | tail -30
```

Expected: all tests pass. If `filteredDestinations returns empty for an obscure week` fails (some schedules unexpectedly extend back to 2020), pick a different past date with no known schedules — anything before 2026-03-01 should be safe.

- [ ] **Step 3: Commit**

```bash
cd /home/v/Documents/Projects/Air-Canada-Travel
git add src/app/app.component.spec.ts
git commit -m "test: rewrite AppComponent tests for week-first design"
```

---

## Task 10: Smoke Test in Browser

- [ ] **Step 1: Start the dev server**

```bash
cd /home/v/Documents/Projects/Air-Canada-Travel && npm start 2>&1 &
```

Open `http://localhost:4200` and verify:
1. Light background (#f5f5f7), Inter font, no globe
2. Header shows "Air Canada Trips" + hub selector defaulting to YYZ · Toronto
3. Week strip shows current week with ← prev and next → navigation
4. Region chips scroll horizontally on narrow window
5. Route cards show YYZ → CODE format, city name, day pills (red = flies)
6. Tapping a card expands inline flight times; tapping again collapses
7. Only one card expanded at a time
8. Changing hub selector updates routes and clears expanded card
9. On narrow window (< 600px), layout is single column and usable

- [ ] **Step 2: Kill dev server when done**

```bash
pkill -f "ng serve" 2>/dev/null; pkill -f "webpack" 2>/dev/null; true
```

- [ ] **Step 3: Final commit**

```bash
cd /home/v/Documents/Projects/Air-Canada-Travel
git add -A
git status
# Should be clean — nothing uncommitted
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Pick a week → see routes with flights (Task 6 `filteredDestinations`)
- ✅ Day pills show which days fly (Task 4 `RouteCardComponent`)
- ✅ Tap card → departure/arrival times inline (Task 4 expanded detail)
- ✅ Mobile-friendly single column (Tasks 2, 3, 4 responsive styles)
- ✅ Hub selector (Task 2 HeaderComponent)
- ✅ Week nav prev/next (Task 3 WeekStripComponent)
- ✅ Region filter chips (Task 3 WeekStripComponent)
- ✅ Globe removed (Task 8)
- ✅ Default week = current week (Task 6 `getWeekStart(new Date())`)
- ✅ Only one card expanded at a time (Task 6 `expandedCode`)
- ✅ "Also from" other hubs shown in expanded detail (Task 4)
- ✅ isNew badge kept as subtle tag (Task 4 `card__new`)
- ✅ Light theme / Inter font (Task 7)

**Type consistency check:**
- `DayFlight` defined in `week.ts` Task 1, used in `RouteCardComponent` Task 4 ✅
- `getFlightsForWeek(hubCode, destCode, weekStart)` called identically in Task 4 ✅
- `routeHasFlightsInWeek(hubCode, destCode, weekStart)` called identically in Task 6 ✅
- `formatWeekLabel(weekStart)` / `formatWeekNavLabel(weekStart)` / `formatDayLabel(date)` used correctly in Tasks 3 and 4 ✅
- `expandedCode: string | null` used consistently across Tasks 5, 6 ✅
