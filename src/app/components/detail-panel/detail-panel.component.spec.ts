import { describe, it, expect, vi } from 'vitest';
import { DetailPanelComponent } from './detail-panel.component';

describe('DetailPanelComponent', () => {
  it('resolves fallback hub code', () => {
    const component = new DetailPanelComponent();
    component.homeCity = 'Unknown City';

    expect(component.hubCode).toBe('YYZ');
  });

  it('emits closed event when closePanel is called', () => {
    const component = new DetailPanelComponent();
    const emitSpy = vi.spyOn(component.closed, 'emit');

    component.closePanel();
    expect(emitSpy).toHaveBeenCalled();
  });

  it('returns visited status by country', () => {
    const component = new DetailPanelComponent();
    component.visitedCountries = ['France'];

    expect(component.isVisited('France')).toBe(true);
    expect(component.isVisited('Japan')).toBe(false);
  });
});
