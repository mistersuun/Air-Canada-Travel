import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, rec, route } from '../../data/testing/schedule-fixtures';
import { PROFILE_KEY } from '../../recs/model';
import { PROFILE_STORAGE } from '../../recs/profile.service';
import { NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { toUtcMs } from '../../utils/time';
import { CommutePage } from './commute.page';

const A = '2026-09-01';
const B = '2027-03-31';
const ALL = 'Mon,Tue,Wed,Thu,Fri,Sat,Sun';
const ROUTES = [
  route('YOW', 'YYZ',
    rec('AC401', '05:30', '06:40', A, B, 'Mon,Tue,Wed,Thu,Fri', '223'),
    rec('AC403', '07:00', '08:10', A, B, ALL, '223'),
    rec('AC407', '17:00', '18:10', A, B, ALL, '223')),
  route('YYZ', 'YOW', rec('AC404', '17:30', '18:40', A, B, ALL, '223')),
];
/** Sun 2026-11-08 00:30 Toronto. */
const CLOCK = toUtcMs('2026-11-08', '00:30', 'America/Toronto');

describe('CommutePage', () => {
  let profile: MemoryStorage;
  beforeEach(() => {
    setScheduleSource(ROUTES, FIXTURE_META);
    profile = new MemoryStorage();
    const prefs = new MemoryStorage();
    prefs.setItem('ac.prefs.v1', JSON.stringify({ hub: 'YYZ' }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), { provide: NOW, useValue: () => CLOCK },
        { provide: PROFILE_STORAGE, useValue: profile }, { provide: PREFS_STORAGE, useValue: prefs },
      ],
    });
  });
  afterEach(() => resetScheduleSource());

  async function render() {
    const fixture = TestBed.createComponent(CommutePage);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const flat = () => (el.textContent ?? '').replace(/\s+/g, ' ');
    const q = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T;
    const change = async (sel: string, value: string) => {
      const input = q<HTMLInputElement | HTMLSelectElement>(sel);
      input.value = value;
      input.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, el, flat, q, change };
  }

  it('asks for a home airport first and shows the footer', async () => {
    const { flat, q } = await render();
    expect(q('[data-problem]').textContent).toContain('Choose your home airport');
    expect(q('[data-options]')).toBeNull();
    expect(flat()).toContain("Published schedules, not seats. Follow your contract's commuter rules.");
  });

  it('saves settings to the profile and lists flights that arrive before report', async () => {
    const { fixture, flat, q, change } = await render();
    await change('[data-home]', 'YOW');
    expect(JSON.parse(profile.getItem(PROFILE_KEY)!).commute).toEqual({ home: 'YOW', base: 'YYZ', bufferMin: 60 });
    q<HTMLButtonElement>('[data-buffer="90"]').click();
    fixture.detectChanges();
    expect(JSON.parse(profile.getItem(PROFILE_KEY)!).commute.bufferMin).toBe(90);
    q<HTMLButtonElement>('[data-buffer="60"]').click();
    fixture.detectChanges();
    // Tomorrow 08:00, arrive by 07:00: AC401 (06:40) and the evening before (AC407).
    expect(q('[data-summary]').textContent).toContain('2 flights arrive by 07:00');
    expect(flat()).toContain('AC407');
    expect(flat()).toContain('day before');
    expect(flat()).toContain('last that works');
    expect(q('[data-latest]').textContent).toContain('AC401');
    expect(flat()).toContain('Report Mon, Nov 9 at 08:00');
  });

  it('lists the trip home after release', async () => {
    const { q, change } = await render();
    await change('[data-home]', 'YOW');
    // Release 17:00: the 17:30 flight is only 30 min later.
    expect(q('[data-home-summary]').textContent).toContain('No scheduled flight leaves after 17:00');
    await change('[data-release-time]', '16:30');
    expect(q('[data-home-summary]').textContent).toContain('1 flight leaves after 16:30');
    expect(q('[data-home-options]').textContent).toContain('AC404');
  });

  it('shows 14 days and flags days with fewer than 2 options', async () => {
    const { fixture, el, q, change } = await render();
    await change('[data-home]', 'YOW');
    await change('[data-report-time]', '12:00');
    [...el.querySelectorAll<HTMLButtonElement>('app-seg button')].find(b => b.textContent!.includes('Next 14 days'))!.click();
    fixture.detectChanges();
    const rows = [...el.querySelectorAll('[data-days] li')];
    expect(rows).toHaveLength(14);
    // Sun Nov 8 is today (flights already gone are not counted, so never flagged).
    expect(rows[0].textContent).not.toContain('fewer than 2 options');
    // Mon Nov 9: AC401 and AC403, plus the evening-before arrival still to leave.
    expect(rows[1].textContent).toContain('3 flights arrive by 11:00');
    expect(rows[1].textContent).toContain('incl. 1 the evening before');
    expect(rows[1].textContent).not.toContain('fewer than 2 options');
    expect(q('[data-days]').textContent).not.toMatch(/risk/i);
  });
});
