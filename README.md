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
