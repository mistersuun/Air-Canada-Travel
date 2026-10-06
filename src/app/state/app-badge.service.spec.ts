import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { AppBadgeService } from './app-badge.service';

function svc(): AppBadgeService {
  TestBed.configureTestingModule({});
  return TestBed.inject(AppBadgeService);
}

describe('AppBadgeService', () => {
  it('sets the badge for a count and clears it at 0, once per change', () => {
    const nav = { setAppBadge: vi.fn().mockResolvedValue(undefined), clearAppBadge: vi.fn().mockResolvedValue(undefined) };
    const s = svc();
    s.apply(3, nav);
    s.apply(3, nav);
    expect(nav.setAppBadge).toHaveBeenCalledTimes(1);
    expect(nav.setAppBadge).toHaveBeenCalledWith(3);
    s.apply(0, nav);
    expect(nav.clearAppBadge).toHaveBeenCalledTimes(1);
  });

  it('does nothing without the Badging API and swallows errors', () => {
    const s = svc();
    expect(() => s.apply(2, {})).not.toThrow();
    expect(() => s.apply(5, { setAppBadge: () => { throw new Error('x'); } })).not.toThrow();
    expect(() => s.apply(6, { setAppBadge: () => Promise.reject(new Error('x')) })).not.toThrow();
  });
});
