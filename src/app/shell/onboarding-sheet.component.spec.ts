import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { EMPTY } from 'rxjs';
import { PROFILE_KEY } from '../recs/model';
import { PROFILE_STORAGE } from '../recs/profile.service';
import { PREFS_STORAGE } from '../state/prefs.service';
import { MemoryStorage } from '../state/testing';
import { OnboardingSheetComponent } from './onboarding-sheet.component';

describe('OnboardingSheetComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function render() {
    const store = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PROFILE_STORAGE, useValue: store },
        { provide: PREFS_STORAGE, useValue: store },
        { provide: SwUpdate, useValue: { isEnabled: false, versionUpdates: EMPTY, unrecoverable: EMPTY } },
      ],
    });
    const fixture = TestBed.createComponent(OnboardingSheetComponent);
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const click = async (sel: string) => {
      (el.querySelector(sel) as HTMLElement).click();
      await fixture.whenStable();
    };
    return { el, click, store, closed: () => closed };
  }

  it('walks three steps and writes the profile from step 2', async () => {
    const { el, click, store, closed } = await render();
    expect(el.querySelector('[data-step]')?.textContent).toContain('Step 1 of 3');
    await click('[data-next]');
    await click('[data-style="Sun"]');
    await click('[data-day="6"]');
    await click('[data-next]');
    expect(el.querySelector('[data-step]')?.textContent).toContain('Step 3 of 3');
    expect(el.textContent).toContain('Add to Home Screen');
    const p = JSON.parse(store.getItem(PROFILE_KEY)!);
    expect(p.styles).toEqual(['Sun']);
    expect(p.days).toEqual([6]);
    await click('[data-next]');
    expect(closed()).toBe(1);
  });

  it('skipping leaves the profile untouched', async () => {
    const { click, store, closed } = await render();
    await click('[data-next]');
    await click('[data-skip]');
    expect(store.getItem(PROFILE_KEY)).toBeNull();
    expect(closed()).toBe(1);
  });
});
