import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DataCreditsComponent } from './data-credits.component';
import { resetRouteNetworkSource, setRouteNetworkSource } from '../../data/route-network';
import { ROUTE_NETWORK_FIXTURE } from '../../data/testing/route-network-fixtures';

describe('DataCreditsComponent', () => {
  it('credits GeoNames under CC BY 4.0 and the AC Vacations schedules', () => {
    const f = TestBed.createComponent(DataCreditsComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('summary')!.textContent).toContain('Data credits');
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('City search GeoNames (geonames.org), CC BY 4.0, compacted to names, coordinates, population and time zones.');
    expect(text).toContain("Air Canada Vacations 'Where We Fly' (published schedules, not seat availability)");
    const links = [...el.querySelectorAll('a')];
    expect(links.every(a => a.target === '_blank' && a.rel.includes('noopener'))).toBe(true);
    expect(links.map(a => a.href)).toContain('https://creativecommons.org/licenses/by/4.0/');
  });

  afterEach(() => resetRouteNetworkSource());

  it('credits the route list to Wikipedia (CC BY-SA 4.0) and OurAirports, with the checked date', () => {
    setRouteNetworkSource(ROUTE_NETWORK_FIXTURE);
    const f = TestBed.createComponent(DataCreditsComponent);
    f.detectChanges();
    const li = (f.nativeElement as HTMLElement).querySelector('[data-route-list]')!;
    const text = li.textContent!.replace(/\s+/g, ' ').trim();
    expect(text).toContain('Route list Wikipedia airport articles');
    expect(text).toContain('CC BY-SA 4.0');
    expect(text).toContain('OurAirports (public domain)');
    expect(text).toContain('Says a route is flown, not when');
    expect(text).toContain('Checked Oct 1, 2026.');
    expect([...li.querySelectorAll('a')].map(a => a.href)).toContain('https://creativecommons.org/licenses/by-sa/4.0/');
  });

  it('leaves out the checked date when no route list is loaded', () => {
    setRouteNetworkSource(null);
    const f = TestBed.createComponent(DataCreditsComponent);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('[data-route-list]')!.textContent).not.toContain('Checked');
  });
});
