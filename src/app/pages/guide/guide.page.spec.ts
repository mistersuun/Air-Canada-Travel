import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { setLocale } from '../../i18n/locale';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { GuidePage } from './guide.page';

describe('GuidePage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: PREFS_STORAGE, useValue: new MemoryStorage() }] });
  });
  afterEach(() => setLocale('en'));

  async function render() {
    const fixture = TestBed.createComponent(GuidePage);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the five sections and the ten-term glossary', async () => {
    const el = await render();
    expect([...el.querySelectorAll('h2')].map(h => h.textContent!.trim())).toEqual([
      'What standby means', 'How the list works, in general', 'Before you go', 'At the airport', 'If you do not get on', 'Glossary',
    ]);
    expect(el.querySelectorAll('dt').length).toBe(10);
    expect(el.querySelector('a.ui-link')!.getAttribute('href')).toMatch(/^\/(\?|$)/);
  });

  it('makes no airline-specific claims and links nowhere outside the app', async () => {
    const el = await render();
    expect(el.textContent).not.toMatch(/Air Canada/i);
    expect(el.querySelectorAll('a[href^="http"]').length).toBe(0);
    expect(el.textContent).toContain('Your employee’s travel site has the rules that apply to you.');
  });

  it('is in French', async () => {
    setLocale('fr');
    const el = await render();
    expect(el.querySelector('h2')!.textContent).toContain('disponibilité');
    expect(el.querySelectorAll('dt').length).toBe(10);
  });
});
