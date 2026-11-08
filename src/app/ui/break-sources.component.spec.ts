import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { setLocale } from '../i18n/locale';
import { BreakSourcesComponent } from './break-sources.component';

afterEach(() => setLocale('en'));

describe('BreakSourcesComponent', () => {
  it('links each board calendar with its reviewed date', async () => {
    const f = TestBed.createComponent(BreakSourcesComponent);
    f.componentRef.setInput('hub', 'YVR');
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('School break sources:');
    const a = el.querySelector('a')!;
    expect(a.textContent).toBe('Vancouver School Board');
    expect(a.href).toContain('compact-vsb-calendar-2026-2027');
    expect(el.textContent).toContain('reviewed Nov 8, 2026');
  });
  it('only lists breaks inside a window, and nothing without any', async () => {
    const f = TestBed.createComponent(BreakSourcesComponent);
    f.componentRef.setInput('hub', 'YVR');
    f.componentRef.setInput('from', '2027-05-01');
    f.componentRef.setInput('to', '2027-05-03');
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).querySelector('[data-break-sources]')).toBeNull();
  });
});
