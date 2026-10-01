import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { GROUND_FETCH } from '../ground-timetable.service';
import { FIXTURE_GROUND_FILE } from '../testing/ground-fixture';
import { setGroundTimetables } from '../timetable';
import { GroundCreditComponent } from './ground-credit.component';

async function render(file: unknown) {
  TestBed.configureTestingModule({ providers: [{ provide: GROUND_FETCH, useValue: async () => structuredClone(file) }] });
  const f = TestBed.createComponent(GroundCreditComponent);
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('GroundCreditComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    setGroundTimetables(null);
  });

  it('credits each timetable source with its licence, and the file under ODbL', async () => {
    const el = await render(FIXTURE_GROUND_FILE);
    expect(el.querySelector('summary')!.textContent).toContain('Timetable credits');
    const text = el.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Renfe Renfe Viajeros (data.renfe.com), CC BY 4.0 · downloaded 2026-10-01');
    expect(text).toContain('Open Database License (ODbL 1.0)');
    expect(text).toContain('Timetables, not bookings or live times.');
    const links = [...el.querySelectorAll('a')];
    expect(links.every(a => a.target === '_blank' && a.rel.includes('noopener'))).toBe(true);
    expect(links.map(a => a.href)).toEqual(expect.arrayContaining([
      'https://creativecommons.org/licenses/by/4.0/', 'https://opendatacommons.org/licenses/odbl/1-0/', 'https://data.renfe.com/',
    ]));
  });

  it('renders nothing when the file is missing', async () => {
    const el = await render(null);
    expect(el.querySelector('details')).toBeNull();
  });
});
