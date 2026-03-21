import { describe, it, expect, vi } from 'vitest';
import { SidebarComponent } from './sidebar.component';
import { Destination } from '../../data/destinations';

const destination: Destination = {
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
};

describe('SidebarComponent', () => {
  it('returns visited country status', () => {
    const component = new SidebarComponent();
    component.visitedCountries = ['France'];

    expect(component.isVisited('France')).toBe(true);
    expect(component.isVisited('Japan')).toBe(false);
  });

  it('emits toggle events for visited country', () => {
    const component = new SidebarComponent();
    const emitSpy = vi.spyOn(component.visitedCountryToggled, 'emit');
    const event = { stopPropagation: vi.fn() } as unknown as Event;

    component.toggleVisited(event, 'France');
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith('France');
  });

  it('emits destination on Enter key press', () => {
    const component = new SidebarComponent();
    const emitSpy = vi.spyOn(component.destinationSelected, 'emit');
    const event = {
      key: 'Enter',
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;

    component.onCardKeydown(event, destination);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(destination);
  });

  it('returns region color and code track key', () => {
    const component = new SidebarComponent();

    expect(component.getColor('Europe')).toBeTruthy();
    expect(component.getColor('Unknown')).toBe('#888');
    expect(component.trackByCode(0, destination)).toBe('CDG');
  });
});
