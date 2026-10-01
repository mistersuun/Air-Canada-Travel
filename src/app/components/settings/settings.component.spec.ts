import { describe, it, expect, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BrowserPlatformLocation, PlatformLocation } from '@angular/common';
import { SettingsComponent } from './settings.component';
import { DEFAULT_PREFS, PREFS_KEY, PREFS_STORAGE, PrefsService } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { AppStateService } from '../../state/app-state.service';

async function setup() {
  const storage = new MemoryStorage();
  TestBed.configureTestingModule({
    imports: [SettingsComponent],
    providers: [
      { provide: PREFS_STORAGE, useValue: storage },
      // Real history, so a ?from= in the URL reaches AppStateService.
      { provide: PlatformLocation, useClass: BrowserPlatformLocation },
    ],
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
    const titleId = dialog.getAttribute('aria-labelledby')!;
    expect(el.querySelector(`#${titleId}`)?.textContent).toBe('Settings');
  });

  it('writes each control to prefs', async () => {
    const { el, fixture, prefs, storage } = await setup();
    const select = el.querySelector<HTMLSelectElement>('#settings-hub')!;
    select.value = 'YVR';
    select.dispatchEvent(new Event('change'));

    const seg = (name: string, label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>(`app-seg[data-setting="${name}"] button`)].find(b => b.textContent?.trim() === label)!;
    seg('theme', 'Dark').click();
    seg('time', '10:10 PM').click();
    seg('min', '90m').click();
    seg('max', '8h').click();
    el.querySelector<HTMLInputElement>('#settings-overnight')!.click();
    el.querySelector<HTMLInputElement>('#settings-connections')!.click();
    await fixture.whenStable();
    expect(seg('theme', 'Dark').getAttribute('aria-pressed')).toBe('true');
    await fixture.whenStable();

    expect(prefs.prefs()).toMatchObject({
      hub: 'YVR', theme: 'dark', timeFormat: '12h', minConnect: 90, maxLayover: 480, allowOvernight: true,
      showConnections: false,
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

  it('the Keyboard shortcuts row swaps settings for the shortcuts sheet', async () => {
    const { el } = await setup();
    const state = TestBed.inject(AppStateService);
    state.openSettings();
    [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('Keyboard shortcuts'))!.click();
    expect(state.settingsOpen()).toBe(false);
    expect(state.shortcutsOpen()).toBe(true);
  });

  it('shows the schedule coverage line', async () => {
    const { el } = await setup();
    expect(el.textContent).toContain('data to');
  });

  it('Done, the close button and a backdrop click close it and emit (closed)', async () => {
    const { el, fixture } = await setup();
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    el.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')!.click();
    expect(closed).toHaveBeenCalledTimes(1);
    el.querySelector('dialog')!.showModal();
    el.querySelector<HTMLButtonElement>('[data-done]')!.click();
    expect(closed).toHaveBeenCalledTimes(2);
    closed.mockClear();

    const dialog = el.querySelector('dialog')!;
    dialog.showModal();
    // Click inside the dialog's box (its padding): stays open.
    dialog.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100 }) as DOMRect;
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 }));
    expect(closed).not.toHaveBeenCalled();
    // Click on the backdrop, outside the box.
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 300 }));
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
