import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { PROFILE_STORAGE } from '../../recs/profile.service';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import type { RouteEntry } from '../../utils/routes';
import { SurpriseSheetComponent } from './surprise-sheet.component';

const entry = (code: string): RouteEntry => ({
  destination: { code, city: code, type: 'City', lat: 51, lng: 0 } as RouteEntry['destination'],
  isDirect: true, weekDays: [], daysFlying: 1, isFavourite: false,
  flights: [{ depUtc: Date.UTC(2031, 0, 1), dateKey: '2031-01-01', depLocal: '10:00' } as RouteEntry['flights'][number]],
});

describe('SurpriseSheetComponent weekend toggle', () => {
  beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
  afterEach(() => resetScheduleSource());

  it('says why when this weekend is beyond the published schedules, instead of searching', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
        { provide: PROFILE_STORAGE, useValue: new MemoryStorage() },
        { provide: NOW, useValue: () => Date.parse('2031-06-04T12:00:00Z') },
      ],
    });
    TestBed.inject(AppStateService);
    const fixture = TestBed.createComponent(SurpriseSheetComponent);
    fixture.componentRef.setInput('entries', [entry('LHR')]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-surprise]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const sw = document.querySelector('[data-surprise-weekend]') as HTMLInputElement;
    sw.checked = true;
    sw.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    const msg = document.querySelector('[data-surprise-empty]');
    expect(msg?.textContent).toMatch(/Schedules only go to/);
  });
});
