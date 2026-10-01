import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { EMPTY } from 'rxjs';
import { PROFILE_KEY } from '../../recs/model';
import { PROFILE_STORAGE, ProfileService } from '../../recs/profile.service';
import { RECS_NOW, RECS_PROFILE } from '../../recs/testing/recs-fixture';
import { NOW } from '../../state/app-state.service';
import { BlockedStorage, MemoryStorage } from '../../state/testing';
import { ProfilePage, toggled } from './profile.page';

const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function render(storage: Storage = new MemoryStorage()) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => RECS_NOW },
      { provide: PROFILE_STORAGE, useValue: storage },
      { provide: SwUpdate, useValue: { isEnabled: false, versionUpdates: EMPTY, unrecoverable: EMPTY } },
    ],
  });
  const fixture = TestBed.createComponent(ProfilePage);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends Element = HTMLElement>(sel: string) => el.querySelector(sel) as T;
  const click = async (sel: string) => {
    q<HTMLButtonElement>(sel).click();
    await fixture.whenStable();
  };
  const saved = () => JSON.parse(storage.getItem(PROFILE_KEY) ?? 'null');
  return { fixture, el, q, click, saved, storage };
}

describe('ProfilePage', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lays out the x12 controls with the privacy note', async () => {
    const { el, q } = await render();
    expect(squash(q('h1').textContent)).toBe('Travel profile');
    expect([...el.querySelectorAll('[data-style]')].map(b => squash(b.textContent))).toEqual(['Sun', 'City', 'Adventure']);
    expect([...el.querySelectorAll('[data-day]')].map(b => b.getAttribute('aria-label'))).toEqual(
      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    expect(el.textContent).toContain('Mondays that are holidays count too.');
    expect(el.textContent).toContain('Used to prefer days with more departures, never to guess seats.');
    expect(el.textContent).toContain('Any lets ideas include a train or bus past the airport.');
    expect(squash(q('.note').textContent)).toBe('Stays on this phone. Used only to pick suggestions. Not in share links.');
    expect(squash(q('[data-max-text]').textContent)).toBe('Any length');
    expect(q<HTMLInputElement>('[data-any]').checked).toBe(true);
    expect(q<HTMLInputElement>('[data-max]').disabled).toBe(true);
    expect(q<HTMLButtonElement>('[data-reset]').disabled).toBe(true);
    expect(el.textContent).not.toContain('%');
  });

  it('saves every control immediately and keeps it across a reload', async () => {
    const { click, q, saved, fixture, storage } = await render();
    await click('[data-style="Sun"]');
    await click('[data-style="City"]');
    expect(q('[data-style="Sun"]').getAttribute('aria-pressed')).toBe('true');
    expect(saved().styles).toEqual(['Sun', 'City']);

    await click('[data-length] button:nth-child(1)');
    expect(saved().length).toBe('day');

    const any = q<HTMLInputElement>('[data-any]');
    any.checked = false;
    any.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(saved().maxFlightHours).toBe(7);
    const range = q<HTMLInputElement>('[data-max]');
    range.value = '5';
    range.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(saved().maxFlightHours).toBe(5);
    expect(squash(q('[data-max-text]').textContent)).toBe('Up to 5h');

    await click('[data-party-plus]');
    await click('[data-party-plus]');
    await click('[data-party-minus]');
    expect(saved().party).toBe(2);
    expect(squash(q('[data-party]').textContent)).toBe('2');

    await click('[data-onward] button:nth-child(1)');
    expect(saved().onwardBudget).toBe('low');

    for (const d of [4, 5, 6, 7]) await click(`[data-day="${d}"]`);
    await click('[data-day="5"]');
    expect(saved().days).toEqual([4, 6, 7]);
    expect(q('[data-day="4"]').getAttribute('aria-pressed')).toBe('true');
    expect(saved().updatedAt).not.toBeNull();

    // A reload reads the same profile back.
    TestBed.resetTestingModule();
    const again = await render(storage);
    expect(again.q('[data-style="City"]').getAttribute('aria-pressed')).toBe('true');
    expect(again.q('[data-style="Adventure"]').getAttribute('aria-pressed')).toBe('false');
    expect(squash(again.q('[data-max-text]').textContent)).toBe('Up to 5h');
    expect(squash(again.q('[data-party]').textContent)).toBe('2');
    expect(again.q('[data-day="6"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('resets after a confirmation', async () => {
    const storage = new MemoryStorage();
    storage.setItem(PROFILE_KEY, JSON.stringify(RECS_PROFILE));
    const { click, q, el } = await render(storage);
    expect(q('[data-style="City"]').getAttribute('aria-pressed')).toBe('true');
    await click('[data-reset]');
    await click('[data-reset-cancel]');
    expect(TestBed.inject(ProfileService).isEmpty()).toBe(false);
    await click('[data-reset]');
    expect(el.textContent).toContain('Reset your travel profile?');
    await click('[data-reset-yes]');
    expect(TestBed.inject(ProfileService).isEmpty()).toBe(true);
    expect(q('[data-style="City"]').getAttribute('aria-pressed')).toBe('false');
    expect(JSON.parse(storage.getItem(PROFILE_KEY)!).updatedAt).toBeNull();
  });

  it('works for the session when storage is blocked', async () => {
    const { click, q } = await render(new BlockedStorage());
    await click('[data-style="Adventure"]');
    expect(q('[data-style="Adventure"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('toggles values in a list', () => {
    expect(toggled([1, 2], 2)).toEqual([1]);
    expect(toggled([1], 3)).toEqual([1, 3]);
  });
});
