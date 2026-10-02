/**
 * /to/:code in a browser far from the airports: "Today" on each timeline is
 * the origin airport's calendar day (the hub for departures, the destination
 * for returns), never the device's. The device runs in Tokyo here.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { ShareService } from '../../state/share.service';
import { MemoryStorage } from '../../state/testing';
import { dateKey, toUtcMs } from '../../utils/time';
import { DestinationPage } from './destination.page';

// Thu Oct 1 20:00 in Montréal = Fri Oct 2 09:00 in Tokyo = Fri Oct 2 01:00 in London.
const NOW_MS = toUtcMs('2026-10-01', '20:00', 'America/Toronto');
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

describe('DestinationPage day labels (device in Tokyo)', () => {
  let savedTz: string | undefined;

  beforeAll(() => {
    savedTz = process.env['TZ'];
    process.env['TZ'] = 'Asia/Tokyo';
  });
  afterAll(() => {
    if (savedTz === undefined) delete process.env['TZ'];
    else process.env['TZ'] = savedTz;
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
        { provide: NOW, useValue: () => NOW_MS },
        { provide: ShareService, useValue: { share: vi.fn() } },
      ],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    resetScheduleSource();
  });

  it('really runs with the device already on Oct 2', () => {
    expect(new Date(NOW_MS).getTimezoneOffset()).toBe(-540);
    expect(dateKey(new Date(NOW_MS))).toBe('2026-10-02');
    expect(TestBed.inject(AppStateService).todayKey()).toBe('2026-10-02');
  });

  it("labels departures by the hub's day and returns by the destination's day", async () => {
    const fixture = TestBed.createComponent(DestinationPage);
    fixture.componentRef.setInput('code', 'LHR');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    // Tonight's AC864 at 22:10 in Montréal is still "Today, Oct 1" there.
    expect(clean(el.querySelector('.next__when')?.textContent)).toBe('Today · 22:10');
    const dep = el.querySelectorAll('.dep .ui-tl__it');
    expect(clean(dep[0].querySelector('.d')?.textContent)).toBe('Today, Oct 1 · in 2h 10m');
    expect(clean(dep[1].querySelector('.d')?.textContent)).toBe('Fri, Oct 2');
    // In London it is already Fri Oct 2: its first return today is "Today, Oct 2".
    const ret = [...el.querySelectorAll('.ret .ui-tl__it')].map(i => clean(i.querySelector('.d')?.textContent));
    expect(ret[0]).toBe('Today, Oct 2');
    expect(ret.some(l => l.startsWith('Today, Oct 1'))).toBe(false);
  });
});
