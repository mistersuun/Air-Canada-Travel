import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { DestCompareButtonComponent } from './dest-compare-button.component';

describe('DestCompareButtonComponent', () => {
  beforeEach(() => {
    const storage = new MemoryStorage();
    storage.setItem('ac.prefs.v1', JSON.stringify({ hub: 'YUL' }));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: PREFS_STORAGE, useValue: storage }, { provide: NOW, useValue: () => Date.parse('2026-10-06T13:00:00Z') }],
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('opens a picker without this destination and goes to /compare?c=THIS,OTHER', async () => {
    const fixture = TestBed.createComponent(DestCompareButtonComponent);
    fixture.componentRef.setInput('code', 'LIS');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    expect(el.querySelector('app-dest-picker')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-compare]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-compare]')!.textContent).toContain('Compare');
    expect(el.querySelector('[data-pick="LIS"]')).toBeNull();
    const first = el.querySelector<HTMLButtonElement>('[data-pick]')!;
    const other = first.getAttribute('data-pick')!;
    first.click();
    expect(nav).toHaveBeenCalledWith(['/compare'], expect.objectContaining({ queryParams: expect.objectContaining({ c: `LIS,${other}` }) }));
  });
});
