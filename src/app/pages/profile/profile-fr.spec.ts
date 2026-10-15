import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { EMPTY } from 'rxjs';
import { setLocale } from '../../i18n/locale';
import { PROFILE_STORAGE } from '../../recs/profile.service';
import { RECS_NOW } from '../../recs/testing/recs-fixture';
import { NOW } from '../../state/app-state.service';
import { MemoryStorage } from '../../state/testing';
import { ProfilePage } from './profile.page';

const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

describe('ProfilePage in French', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    setLocale('en');
  });

  it('shows the controls in French', async () => {
    setLocale('fr');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: NOW, useValue: () => RECS_NOW },
        { provide: PROFILE_STORAGE, useValue: new MemoryStorage() },
        { provide: SwUpdate, useValue: { isEnabled: false, versionUpdates: EMPTY, unrecoverable: EMPTY } },
      ],
    });
    const fixture = TestBed.createComponent(ProfilePage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(squash(el.querySelector('h1')!.textContent)).toBe('Profil de voyage');
    expect([...el.querySelectorAll('[data-style]')].map(b => squash(b.textContent))).toEqual(['Soleil', 'Ville', 'Aventure']);
    expect([...el.querySelectorAll('[data-day]')].map(b => b.getAttribute('aria-label')).slice(0, 2)).toEqual(['lundi', 'mardi']);
    expect([...el.querySelectorAll('[data-day]')].map(b => squash(b.textContent))).toEqual(['L', 'M', 'M', 'J', 'V', 'S', 'D']);
    expect(squash(el.querySelector('[data-max-text]')!.textContent)).toBe('Peu importe');
    expect(squash(el.querySelector('.note')!.textContent)).toContain('Reste sur ce téléphone');
    // The text of a long French sentence is not truncated away: nothing in the page still reads as English.
    expect(el.textContent).not.toContain('Travel profile');
  });
});
