import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PlaneIconComponent } from './plane-icon.component';

describe('PlaneIconComponent', () => {
  it('defaults to a decorative 14px glyph', () => {
    const fixture = TestBed.createComponent(PlaneIconComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const svg = el.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('14');
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(svg.style.transform).toBe('');
  });

  it('supports size, rotation and a label', () => {
    const fixture = TestBed.createComponent(PlaneIconComponent);
    fixture.componentRef.setInput('size', 20);
    fixture.componentRef.setInput('rotate', -45);
    fixture.componentRef.setInput('label', 'Departure');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const svg = el.querySelector('svg')!;
    expect(svg.getAttribute('height')).toBe('20');
    expect(svg.style.transform).toBe('rotate(-45deg)');
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('Departure');
  });
});
