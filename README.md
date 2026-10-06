# Air Canada Destinations Explorer

An Angular 17 interactive travel platform using Leaflet maps with animated great-circle flight arcs from Canadian hubs to 70+ Air Canada destinations worldwide.

## Features

- **Leaflet Map** with Carto Voyager tiles — clean, warm cartography
- **Animated flight arcs** — curved great-circle paths drawn from every hub serving a route when you click a destination. Primary route is solid with a traveling dot; secondary routes are dashed
- **8 Canadian hubs** shown permanently — Toronto, Montreal, Vancouver, Calgary, Ottawa, Halifax, Edmonton, Quebec City
- **70+ destinations** across Caribbean, Mexico, USA, Europe, Asia & Pacific, South America, Africa & Middle East
- **Region & type filters** — chip-based filtering with color coding
- **New 2026 routes** toggle — Budapest, Catania, Azores, Palma, Berlin, Nantes, Cartagena, Fort-de-France
- **Detail panel** — slides up showing route info (YYZ → CDG format), duration, aircraft, season, departure cities
- **No prices** — designed for use with your own travel benefits/Aeroplan points

## Data Sources

All route data is from publicly available Air Canada information:
- Wikipedia: List of Air Canada destinations
- Air Canada Vacations "Where We Fly" page
- Milesopedia route announcements
- Air Canada seasonal schedule press releases

Durations and aircraft types are approximate estimates. **Always verify on aircanada.com before booking.**

## Setup

```bash
# Install dependencies
npm install

# Start dev server
ng serve

# Open browser
open http://localhost:4200
```

## Live flight status (optional)

On the day of travel, Today and the flight page can show live status (estimated time, gate, inbound aircraft, cancelled) from FlightAware AeroAPI. It is off until you set a key; without one the function answers 503 and the app shows nothing extra.

1. Create an AeroAPI **Personal** key at <https://www.flightaware.com/aeroapi/portal>. The free tier includes about $5 of usage a month, and every AeroAPI query is billed per call (the inbound-aircraft lookup is a second call).
2. In Netlify: Site settings > Environment variables > add `AEROAPI_KEY` (secret, scope: Functions). Optionally add `AEROAPI_DAILY_LIMIT` (default `40` AeroAPI calls per UTC day, counted in Netlify Blobs; `0` turns the feature off). Redeploy.

How it works: `netlify/functions/flight-status.mts` receives only an Air Canada flight number, the origin airport and the scheduled departure minute (never anything else), queries AeroAPI for +/- 3 hours around that departure, keeps the flight that leaves that airport nearest that time, and returns a small normalised JSON. It never contacts Air Canada.

Cost controls, in the order a request meets them:
- Netlify's CDN caches each answer (varied on ident, origin and dep): 30 minutes while departure is more than 6 hours away, 5 minutes within 6 hours, 1 minute for upstream errors. Many people watching AC834 cost one query per window, not one each.
- Only cache misses reach the function. Each IP gets about 10 of those per 10 minutes (429 after), and cross-site requests are refused.
- A global daily budget of `AEROAPI_DAILY_LIMIT` upstream calls (default 40). Past it the function answers `503 {error:'budget'}` until the next UTC day; the app backs off quietly. The counter is read-then-write, so concurrent misses can over-spend by a call or two; if Blobs is unavailable the function refuses rather than spends.
- The app asks only about flights within 12 h before to 36 h after departure (the flight page: within 6 h), polls every 30 minutes until 6 hours before departure and every 5 minutes after, only while the tab is visible, and stops 30 minutes after departure or on arrival. The endpoint is never cached by the service worker.

Fields to verify on the first live call (the AeroAPI docs were not reachable when this was written, so parsing follows the documented v4 names defensively): `origin.code_iata`, `scheduled_out` / `estimated_out` / `actual_out`, `scheduled_in` / `estimated_in` / `actual_in`, `gate_origin` / `gate_destination`, `terminal_origin` / `terminal_destination`, `inbound_fa_flight_id` (fetched with `ident_type=fa_flight_id`), `actual_on` / `actual_in` on the inbound leg, `aircraft_type`, `cancelled`, `diverted`, and `ident_type=designator` for `ACA###`.

Locally, `netlify dev` serves the function (and a local Blobs store); `ng serve` and the e2e static server do not, and the app hides the status line quietly when the endpoint is missing.

## Tech Stack

- Angular 17 (standalone components)
- Leaflet 1.9.4
- TypeScript 5.4
- SCSS
- DM Sans + Source Serif 4 fonts

## Project Structure

```
src/
  app/
    app.component.ts          — Root layout, filters, state management
    data/
      destinations.ts         — All route data, hub coordinates, types
    components/
      map/
        map.component.ts      — Leaflet map, markers, flight arcs, animation
      sidebar/
        sidebar.component.ts  — Scrollable destination list
      detail-panel/
        detail-panel.component.ts — Selected route overlay
  styles.scss                 — Global styles, Leaflet overrides
  index.html                  — Entry HTML with font imports
  main.ts                     — Bootstrap
```

## Not Affiliated

This is a personal travel planning tool. Not affiliated with Air Canada or Air Canada Vacations.

## Service worker switch-off

`public/sw.js` is the registered worker: it adds the share target, periodic schedule checks and notification clicks, then `importScripts('./ngsw-worker.js')`. If a deploy ever has to switch the worker off (a bad `sw.js`, or a cache that cannot recover), do not just delete it: browsers keep running the old copy. Replace the contents of `public/sw.js` with a safety worker and deploy. It should skip waiting, delete every cache (`caches.keys()` then `caches.delete`), call `registration.unregister()` and reload open windows (`clients.matchAll()` then `client.navigate(client.url)`). `/sw.js` is served `no-cache` (see `netlify.toml`), so it is picked up on the next visit. Angular ships a similar `safety-worker.js` for the same purpose.
