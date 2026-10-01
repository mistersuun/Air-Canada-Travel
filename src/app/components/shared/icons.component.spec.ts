import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ICON_PATHS, IconComponent, IconName } from './icons.component';

function render(inputs: Partial<{ name: IconName; size: number; filled: boolean; label: string }>) {
  const fixture = TestBed.createComponent(IconComponent);
  for (const [k, v] of Object.entries({ name: 'gear', ...inputs })) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('IconComponent', () => {
  it('renders one path per path string, sized by input', () => {
    const el = render({ name: 'calendar', size: 18 });
    const svg = el.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('18');
    expect(el.querySelectorAll('path').length).toBe(ICON_PATHS.calendar.length);
    expect(el.getAttribute('data-icon')).toBe('calendar');
  });

  it('is decorative (aria-hidden) without a label', () => {
    const el = render({ name: 'share' });
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.getAttribute('role')).toBeNull();
  });

  it('exposes role=img and aria-label when labelled', () => {
    const el = render({ name: 'warning', label: 'Estimated leg' });
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('Estimated leg');
    expect(el.getAttribute('aria-hidden')).toBeNull();
  });

  it('fills only fillable icons', () => {
    expect(render({ name: 'star', filled: true }).querySelector('svg')!.getAttribute('fill')).toBe('currentColor');
    expect(render({ name: 'star' }).querySelector('svg')!.getAttribute('fill')).toBe('none');
    expect(render({ name: 'gear', filled: true }).querySelector('svg')!.getAttribute('fill')).toBe('none');
  });

  it('reacts to input changes (zoneless)', async () => {
    const fixture = TestBed.createComponent(IconComponent);
    fixture.componentRef.setInput('name', 'sun');
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).getAttribute('data-icon')).toBe('sun');
    fixture.componentRef.setInput('name', 'moon');
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).getAttribute('data-icon')).toBe('moon');
  });

  it('has the Trips v2 icons', () => {
    for (const n of ['suitcase', 'train', 'bus', 'car', 'home', 'check', 'retry', 'note', 'more', 'external', 'pin'] as IconName[]) {
      expect(ICON_PATHS[n]?.length, n).toBeGreaterThan(0);
      expect(render({ name: n }).getAttribute('data-icon')).toBe(n);
    }
  });

  it('every icon has at least one non-empty path', () => {
    for (const [name, paths] of Object.entries(ICON_PATHS)) {
      expect(paths.length, name).toBeGreaterThan(0);
      for (const d of paths) expect(d.trim().startsWith('M') || d.trim().startsWith('m'), name).toBe(true);
    }
  });
});
