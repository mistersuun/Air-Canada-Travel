import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DataCreditsComponent } from './data-credits.component';

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
});
