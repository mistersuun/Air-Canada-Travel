# AC Trips — Redesign Spec
_2026-05-21_

## Context

The existing app is a 3D globe explorer for Air Canada destinations. The user's actual need is company travel planning: given a week they have free, which destinations have flights and on which specific days?

The globe is visually impressive but poor for this workflow. This spec replaces it entirely.

---

## Goals

- Pick a departure week → see every route with flights in that window
- Each route shows exactly which days of the week it flies
- Tap a route → see departure/arrival times for each operating day that week
- Works well on both desktop and mobile (phone-first consideration)
- No prices, no return journey planning (user re-opens app for that separately)

## Non-goals

- Return leg scheduling
- Price information
- Booking / deep-linking to checkout
- The 3D globe (removed)

---

## Design Language

**Reference:** apple.com — generous whitespace, one accent colour, nothing decorative.

| Token | Value |
|---|---|
| Page background | `#f5f5f7` |
| Card background | `#ffffff` |
| Card border | `1px solid #e8e8ed` |
| Card border-radius | `14px` |
| Primary accent (AC red) | `#C8102E` |
| Flight-day pill bg | `#fff0f2` |
| Flight-day pill border | `#ffc7cf` |
| No-flight pill bg | `#f5f5f7` |
| No-flight pill border | `#e8e8ed` |
| Primary text | `#1d1d1f` |
| Secondary text | `#86868b` |
| Font | Inter, -apple-system, sans-serif |

No gradients. No blur/glass effects. No left-border accents. No decorative elements. Red is used only for AC brand and "this day has a flight" — nothing else.

---

## Layout

### Header (sticky)
- Left: AC logo dot (red circle, ✈) + "Air Canada Trips" wordmark
- Right: Hub selector pill (e.g. "✈ YYZ · Toronto") — dropdown to switch home city

### Week Strip (sticky, below header)
- Left: `← [prev week label]` link in AC red
- Centre: current week label ("Jun 9 – 15, 2026") + sub-label ("18 routes with departures")
- Right: `[next week label] →` link in AC red
- Background: `#fafafa`, 1px bottom border

### Filter Chips (below week strip)
- Pill chips: All regions / Europe / Asia & Pacific / Caribbean / USA / Mexico / South America / Africa & Middle East
- Active chip: `background: #1d1d1f; color: #fff`
- Horizontal scroll on mobile

### Route List (main content)
- Vertical stack of route cards, `8px` gap, `12px 16px` padding on container
- On desktop: max-width `640px`, centred

### Route Card (collapsed)
```
[route meta: YYZ → LHR · A330-300]       [code: LHR]
[city: London]                            [duration: 9h direct]
[country: United Kingdom · Europe]

[M] [T] [W] [T] [F] [S] [S]   ← day pills, red = flies
```

### Route Card (expanded — tap to toggle)
Adds below the day pills:
```
─────────────────────────────
FLIGHTS THIS WEEK
Mon Jun 9    AC848    21:05 → 09:20+1
Tue Jun 10   AC848    21:05 → 09:20+1
Wed Jun 11   [No departure]             ← greyed out, 40% opacity
Thu Jun 12   AC848    21:05 → 09:20+1
─────────────────────────────
Also departing from: Montreal · Vancouver · Calgary
```

Only one card can be expanded at a time. Tapping an already-expanded card collapses it.

---

## Week Navigation Logic

The week strip navigates in 7-day increments anchored to Monday.

**Default week on load:** The Monday of the current real-world week (derived from `new Date()` at app init).

**Filtering:** A route appears in the list for a given week if `getSchedulesForRoute(hubCode, dest.code)` returns at least one schedule period whose `fromDate`–`toDate` range overlaps with any day in the selected week.

**Day pills:** For each day Mon–Sun in the selected week, a pill is lit red if the schedule's `days` string contains that weekday name AND the date falls within a valid schedule period.

**Flight rows:** Show only the days within the selected week that have a flight. Days with no flight are shown greyed out so the user can see the full week at a glance.

---

## Mobile Behaviour

- Same single-column layout (no sidebar)
- Cards are full-width
- Expanded detail is inline (no modal/drawer)
- Header hub selector shows just the code ("YYZ") to save space
- Week strip is compact (no sub-label on mobile)

---

## Removed from Current App

| Removed | Reason |
|---|---|
| 3D globe (globe.gl) | Not useful for schedule planning |
| Sidebar destination list | Replaced by main route list |
| Detail panel overlay | Replaced by inline card expansion |
| Hero overlay | Not relevant for a focused planning tool |
| Visited countries tracker | Out of scope for company travel |
| New 2026 badge prominence | Kept as a subtle tag but not a primary filter |

The `globe.gl` dependency can be removed from `package.json`.

---

## Data Layer

No new data structures needed. Existing `DESTINATIONS`, `HUBS`, `ROUTE_SCHEDULES`, and `getSchedulesForRoute()` are sufficient.

New utility function needed: `getFlightsForWeek(hubCode, destCode, weekStart: Date): DayFlight[]`

```ts
interface DayFlight {
  date: Date;           // actual calendar date
  flies: boolean;       // true if a flight operates this day
  flightNumber?: string;
  departure?: string;   // "21:05"
  arrival?: string;     // "09:20+1"
  aircraft?: string;
}
```

This function is pure (no side effects) and drives both the day pills and the expanded flight rows.

---

## Component Structure

```
AppComponent
├── HeaderComponent         (brand, hub selector)
├── WeekStripComponent      (week nav, route count)
├── FilterChipsComponent    (region chips)
└── RouteListComponent
    └── RouteCardComponent  (collapsed + expanded state)
```

State lives in `AppComponent`:
- `selectedWeekStart: Date` (Monday of selected week)
- `selectedHub: string` (home city name, e.g. "Toronto")
- `activeRegion: string` (filter)
- `expandedCode: string | null` (which card is expanded)

---

## What's Kept from Current App

- All destination and schedule data (`destinations.ts`, `schedules.ts`)
- All bug fixes from the preceding review session
- Global styles foundation (`styles.scss`)
- Angular standalone component architecture
- Existing tests (updated as needed)
