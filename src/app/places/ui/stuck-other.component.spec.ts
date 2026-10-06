import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AIRPORT_HOTELS_FETCH } from '../airport-hotels';
import { airportEnd } from '../ground';
import { OtherWaysComponent } from './other-ways.component';
import { StuckTonightComponent } from './stuck-tonight.component';

const FILE = {
  v: 1, builtAt: '2026-10-06', license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors',
  airports: { YUL: [['Hotel B', 45.47, -73.74, 1500], ['Hotel A', 45.47, -73.74, 400]] },
};

async function stuck(file: unknown) {
  TestBed.configureTestingModule({ providers: [{ provide: AIRPORT_HOTELS_FETCH, useValue: async () => file }] });
  const f = TestBed.createComponent(StuckTonightComponent);
  f.componentRef.setInput('code', 'YUL');
  f.componentRef.setInput('airportName', 'Montréal');
  f.componentRef.setInput('checkIn', '2026-10-08');
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('StuckTonightComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists the nearest hotels first with distances, the three links and the OSM credit', async () => {
    const el = await stuck(structuredClone(FILE));
    const items = [...el.querySelectorAll('[data-hotels] li')].map(li => li.textContent!.replace(/\s+/g, ' ').trim());
    expect(el.textContent).toContain('Hotels near the airport:');
    expect(items).toEqual(['Hotel Aabout 0.5 km', 'Hotel Babout 1.5 km']);
    expect([...el.querySelectorAll('[data-stay]')].map(a => a.getAttribute('data-stay'))).toEqual(['booking', 'hostelworld', 'maps']);
    expect(el.textContent).toContain('OpenStreetMap contributors');
    expect(el.textContent).not.toMatch(/\$|€|per night/);
    expect([...el.querySelectorAll('a')].every(a => a.rel.includes('noopener') && a.target === '_blank')).toBe(true);
  });

  it('degrades to the search links when there is no hotel file', async () => {
    const el = await stuck(null);
    expect(el.querySelector('[data-hotels]')).toBeNull();
    expect(el.querySelectorAll('[data-stay]').length).toBe(3);
    expect(el.textContent).not.toContain('Hotels near the airport:');
    expect(el.textContent).not.toContain('OpenStreetMap');
  });
});

describe('OtherWaysComponent', () => {
  it('renders "Search on X ↗" links', () => {
    const f = TestBed.createComponent(OtherWaysComponent);
    f.componentRef.setInput('from', airportEnd('YUL')!);
    f.componentRef.setInput('to', { name: 'Québec City', lat: 46.81, lng: -71.21 });
    f.componentRef.setInput('dateKey', '2026-10-09');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('h2')!.textContent).toBe('Other ways there');
    const labels = [...el.querySelectorAll('[data-way]')].map(a => a.textContent);
    expect(labels).toContain('Search YUL → Québec City on Busbud ↗');
    expect(labels).toContain('Search YUL → Québec City on Rome2Rio ↗');
    TestBed.resetTestingModule();
  });
});
