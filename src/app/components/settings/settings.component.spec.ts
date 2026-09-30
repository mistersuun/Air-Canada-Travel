import { describe, it, expect, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SettingsComponent } from './settings.component';
import { DEFAULT_PREFS, PREFS_KEY, PREFS_STORAGE, PrefsService } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { AppStateService } from '../../state/app-state.service';

async function setup() {
  const storage = new MemoryStorage();
  TestBed.configureTestingModule({
    imports: [SettingsComponent],
    providers: [{ provide: PREFS_STORAGE, useValue: storage }],
  });
  const fixture = TestBed.createComponent(SettingsComponent);
  await fixture.whenStable();
  const el: HTMLElement = fixture.nativeElement;
  const prefs = TestBed.inject(PrefsService);
  return { fixture, el, prefs, storage };
}

describe('SettingsComponent', () => {
  afterEach(() => document.documentElement.removeAttribute('data-theme'));

  it('opens itself as a modal dialog labelled by its title', async () => {
    const { el } = await setup();
    const dialog = el.querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe('settings-title');
    expect(el.querySelector('#settings-title')?.textContent).toBe('Settings');
  });

  it('writes each control to prefs', async () => {
    const { el, fixture, prefs, storage } = await setup();
    const select = el.querySelector<HTMLSelectElement>('#settings-hub')!;
    select.value = 'YVR';
    select.dispatchEvent(new Event('change'));

    const radio = (name: string, value: string) =>
      el.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!;
    radio('settings-theme', 'dark').click();
    radio('settings-time', '12h').click();
    radio('settings-min', '90').click();
    radio('settings-max', '480').click();
    el.querySelector<HTMLInputElement>('#settings-overnight')!.click();
    await fixture.whenStable();

    expect(prefs.prefs()).toMatchObject({
      hub: 'YVR', theme: 'dark', timeFormat: '12h', minConnect: 90, maxLayover: 480, allowOvernight: true,
    });
    expect(JSON.parse(storage.getItem(PREFS_KEY)!).theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('reset restores defaults and keeps favourites', async () => {
    const { el, fixture, prefs } = await setup();
    prefs.update({ hub: 'YYZ', minConnect: 120, favourites: ['LHR'] });
    await fixture.whenStable();
    [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('Reset'))!.click();
    expect(prefs.prefs()).toEqual({ ...DEFAULT_PREFS, favourites: ['LHR'] });
  });

  it('changing the home airport wins over a hub from the URL, and reset clears URL overrides', async () => {
    history.replaceState(null, '', '/?from=YYZ&region=Europe');
    try {
      const { el, fixture, prefs } = await setup();
      const state = TestBed.inject(AppStateService);
      expect(state.hub()).toBe('YYZ');
      expect(state.region()).toBe('Europe');
      const select = el.querySelector<HTMLSelectElement>('#settings-hub')!;
      select.value = 'YVR';
      select.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      expect(prefs.hub()).toBe('YVR');
      expect(state.hub()).toBe('YVR');

      [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('Reset'))!.click();
      expect(state.region()).toBe(DEFAULT_PREFS.region);
      expect(state.hub()).toBe(DEFAULT_PREFS.hub);
    } finally {
      history.replaceState(null, '', '/');
    }
  });

  it('Done, the close button and a backdrop click close it and emit (closed)', async () => {
    const { el, fixture } = await setup();
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    el.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')!.click();
    expect(closed).toHaveBeenCalledTimes(1);

    const dialog = el.querySelector('dialog')!;
    dialog.showModal();
    // Click inside the dialog's box (its padding): stays open.
    dialog.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100 }) as DOMRect;
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 }));
    expect(closed).toHaveBeenCalledTimes(1);
    // Click on the backdrop, outside the box.
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 300 }));
    expect(closed).toHaveBeenCalledTimes(2);
  });
});
