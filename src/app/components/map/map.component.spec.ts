import { describe, it, expect } from 'vitest';
import { MapComponent } from './map.component';
import { NgZone } from '@angular/core';

describe('MapComponent', () => {
  it('builds points from destinations and hubs', () => {
    const zone = { runOutsideAngular: (fn: Function) => fn(), run: (fn: Function) => fn() } as unknown as NgZone;
    const component = new MapComponent(zone);
    component.destinations = [
      {
        city: 'Paris',
        country: 'France',
        code: 'CDG',
        lat: 49.01,
        lng: 2.55,
        region: 'Europe',
        type: 'City',
        duration: '7h 30m',
        aircraft: '787 Dreamliner',
        fromCities: ['Toronto'],
        season: 'Year-round',
      },
    ];
    component.homeCity = 'Toronto';

    const points = (component as any).buildPoints();
    // 8 hubs + 1 destination = 9 points
    expect(points.length).toBe(9);
    const dest = points.find((p: any) => p.dest?.code === 'CDG');
    expect(dest).toBeDefined();
    expect(dest.lat).toBe(49.01);
  });

  it('builds arcs only when a destination is selected', () => {
    const zone = { runOutsideAngular: (fn: Function) => fn(), run: (fn: Function) => fn() } as unknown as NgZone;
    const component = new MapComponent(zone);
    expect((component as any).buildArcs()).toEqual([]);

    component.selected = {
      city: 'Paris', country: 'France', code: 'CDG',
      lat: 49.01, lng: 2.55, region: 'Europe', type: 'City',
      duration: '7h 30m', aircraft: '787', fromCities: ['Toronto', 'Montreal'],
      season: 'Year-round',
    };
    const arcs = (component as any).buildArcs();
    expect(arcs.length).toBe(2);
    expect(arcs[0].stroke).toBeGreaterThan(arcs[1].stroke);
  });
});
