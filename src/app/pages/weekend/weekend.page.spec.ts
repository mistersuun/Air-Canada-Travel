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
import { WeekendPage } from './weekend.page';

/** Tue Oct 6 2026, 09:00 in Montréal. */
const CLOCK = Date.parse('2026-10-06T13:00:00Z');

describe('WeekendPage', () => {
  beforeEach(() => {
    setScheduleSource(RECS_ROUTES, RECS_META);
    const storage = new MemoryStorage();
    storage.setItem('ac.prefs.v1', JSON.stringify({ hub: 'YUL', showConnections: true }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), { provide: PREFS_STORAGE, useValue: storage }, { provide: NOW, useValue: () => CLOCK },
        { provide: CLIMATE_FETCH, useValue: async () => CLIMATE_FIXTURE },
      ],
    });
  });
  afterEach(() => resetScheduleSource());

  async function render() {
    const fixture = TestBed.createComponent(WeekendPage);
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
    const rows = [...el.querySelectorAll('a.row')];
    expect(rows.length).toBe(5);
    expect(rows[0].textContent).toContain('LGA');
    expect(rows[0].textContent).toContain('11 tries home');
    const href = rows[0].getAttribute('href')!;
    expect(href).toMatch(/^\/flight\/LGA\/2026-10-09\/AC\d+/);
    expect(href).toContain('ret=2026-10-11');
  });

  it('switches presets and shows the custom fields', async () => {
    const { fixture, el, flat } = await render();
    const chips = [...el.querySelectorAll<HTMLButtonElement>('.chip')];
    expect(chips.map(c => c.textContent!.trim())).toEqual(['This weekend', 'Next weekend', 'Fri eve → Sun', 'Sat → Mon', 'Custom']);
    chips[1].click();
    fixture.detectChanges();
    expect(flat()).toContain('Leave after Fri, Oct 16');
    chips[4].click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.custom input').length).toBe(4);
  });

  it('says so when the window ends before it starts', async () => {
    const { fixture, el } = await render();
    const chips = [...el.querySelectorAll<HTMLButtonElement>('.chip')];
    chips[4].click();
    fixture.detectChanges();
    const home = el.querySelectorAll<HTMLInputElement>('.custom input')[2];
    home.value = '2026-10-08';
    home.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelector('.note')?.textContent).toContain('Home-by has to be after leave-after');
    expect(el.querySelectorAll('a.row').length).toBe(0);
  });
});
