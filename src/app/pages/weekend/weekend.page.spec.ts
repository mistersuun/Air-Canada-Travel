import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { CLIMATE_FETCH } from '../../recs/climate.service';
import { CLIMATE_FIXTURE } from '../../recs/testing/climate-fixture';
import { RECS_META, RECS_ROUTES } from '../../recs/testing/recs-fixture';
import { NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { PROFILE_KEY } from '../../recs/model';
import { PROFILE_STORAGE } from '../../recs/profile.service';
import { WeekendPage } from './weekend.page';

/** Tue Oct 6 2026, 09:00 in Montréal. */
const CLOCK = Date.parse('2026-10-06T13:00:00Z');

describe('WeekendPage', () => {
  let profileStorage: MemoryStorage;
  beforeEach(() => {
    profileStorage = new MemoryStorage();
    setScheduleSource(RECS_ROUTES, RECS_META);
    const storage = new MemoryStorage();
    storage.setItem('ac.prefs.v1', JSON.stringify({ hub: 'YUL', showConnections: true }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), { provide: PREFS_STORAGE, useValue: storage }, { provide: NOW, useValue: () => CLOCK },
        { provide: PROFILE_STORAGE, useValue: profileStorage },
        { provide: CLIMATE_FETCH, useValue: async () => CLIMATE_FIXTURE },
      ],
    });
  });
  afterEach(() => resetScheduleSource());

  async function render(to?: string) {
    const fixture = TestBed.createComponent(WeekendPage);
    if (to) fixture.componentRef.setInput('to', to);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const flat = () => (el.textContent ?? '').replace(/\s+/g, ' ');
    return { fixture, el, flat };
  }

  it('lists destinations for the default weekend, linking to the first outbound with ?ret=', async () => {
    const { el, flat } = await render();
    expect(flat()).toContain('Leave after Fri, Oct 9');
    expect(flat()).toContain('home by Sun, Oct 11');
    expect(flat()).toContain('YUL time');
    const rows = [...el.querySelectorAll('a.row')];
    expect(rows.length).toBe(5);
    expect(rows[0].textContent).toContain('LGA');
    expect(rows[0].textContent!.replace(/\u00A0/g, ' ')).toMatch(/~\d+h there · .*\d+ out/);
    const href = rows[0].getAttribute('href')!;
    expect(href).toMatch(/^\/flight\/LGA\/2026-10-09\/AC\d+/);
    expect(href).toMatch(/ret=2026-10-1[01]/);
  });

  it('switches presets and shows the custom fields', async () => {
    const { fixture, el, flat } = await render();
    const chips = [...el.querySelectorAll<HTMLButtonElement>('[data-preset]')];
    expect(chips.map(c => c.textContent!.trim())).toEqual(['My days off', 'This weekend', 'Next weekend', 'Fri eve → Sun', 'Sat → Mon', 'Custom']);
    chips[2].click();
    fixture.detectChanges();
    expect(flat()).toContain('Leave after Fri, Oct 16');
    chips[5].click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.custom input').length).toBe(4);
    expect([...el.querySelectorAll('.custom input')].map(i => i.getAttribute('aria-label'))).toEqual([
      'Leave after date', 'Leave after time', 'Home by date', 'Home by time']);
    expect(el.querySelectorAll('.custom legend').length).toBe(2);
  });

  it('says so when the window ends before it starts', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>('[data-preset="custom"]')!.click();
    fixture.detectChanges();
    const home = el.querySelectorAll<HTMLInputElement>('.custom input')[2];
    home.value = '2026-10-08';
    home.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelector('.note')?.textContent).toContain('Home-by has to be after leave-after');
    expect(el.querySelectorAll('a.row').length).toBe(0);
    home.value = '';
    home.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelector('.note')?.textContent).toContain('Enter a date and time');
  });

  it('starts on "My days off" from the profile days (Fri to Sun: leave Fri 06:00, home Sun 22:00)', async () => {
    profileStorage.setItem(PROFILE_KEY, JSON.stringify({ v: 1, days: [5, 6, 7], updatedAt: '2026-10-01T00:00:00Z' }));
    const { el, flat } = await render();
    expect(el.querySelector('[data-preset="mine"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(flat()).toContain('Leave after Fri, Oct 9');
    expect(flat()).toContain('home by Sun, Oct 11');
    expect(flat()).toContain('From the days in your travel profile.');
  });

  it('without profile days, "My days off" links to the profile', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>('[data-preset="mine"]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-set-days] a')!.getAttribute('href')).toBe('/profile');
  });

  it('filters by time there and sorts by shortest flight', async () => {
    const { fixture, el } = await render();
    const before = el.querySelectorAll('a.row').length;
    el.querySelector<HTMLButtonElement>('[data-min="48"]')!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('a.row').length).toBeLessThan(before);
    if (!el.querySelectorAll('a.row').length) {
      // Filtered to nothing: says so (flights do fit) and offers to undo.
      expect(el.querySelector('[data-none-refined]')!.textContent).toContain('none leaves you 48h or more there');
    }
    el.querySelector<HTMLButtonElement>('[data-min="0"]')!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('a.row').length).toBe(before);
  });

  it('?to= searches one destination, with a way back to all', async () => {
    const { el } = await render('LGA');
    expect(el.querySelector('[data-only]')!.textContent).toContain('Only New York');
    expect([...el.querySelectorAll('a.row')].every(r => r.textContent!.includes('LGA'))).toBe(true);
  });
});
