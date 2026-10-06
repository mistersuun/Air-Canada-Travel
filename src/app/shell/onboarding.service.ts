import { Injectable, inject, signal } from '@angular/core';
import { PlatformLocation } from '@angular/common';
import { ProfileService } from '../recs/profile.service';
import { PREFS_STORAGE } from '../state/prefs.service';

export const ONBOARDED_KEY = 'ac.onboarded.v1';

/**
 * First-run setup. Shown once, only when the user has never touched anything:
 * no saved prefs (PrefsService writes the key only on a change), an empty
 * travel profile and no onboarded flag. Never on a deep link (anything but
 * "/") so a shared link is not interrupted, and never when storage is blocked
 * (it could not remember that it was shown).
 */
@Injectable({ providedIn: 'root' })
export class OnboardingService {
  private readonly storage = inject(PREFS_STORAGE);
  private readonly profile = inject(ProfileService);
  private readonly location = inject(PlatformLocation);

  private readonly open = signal(this.shouldShow());
  readonly visible = this.open.asReadonly();

  /** Dismiss (done or skipped) and remember it. */
  finish(): void {
    this.open.set(false);
    this.remember();
  }

  private hasExistingData(): boolean {
    const s = this.storage;
    if (!s) return false;
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith('ac.') && k !== ONBOARDED_KEY) return true;
    }
    return false;
  }

  private remember(): void {
    try {
      this.storage?.setItem(ONBOARDED_KEY, '1');
    } catch {
      // Blocked or full.
    }
  }

  private shouldShow(): boolean {
    try {
      if (!this.storage) return false;
      if ((this.location.pathname || '/') !== '/') return false;
      if (this.storage.getItem(ONBOARDED_KEY) !== null) return false;
      // Any other saved app data (trips, flight log, recents, files, prefs, profile) means an existing user:
      // never show, and remember it so a later first-time-looking state cannot bring it back.
      if (this.hasExistingData() || !this.profile.isEmpty()) {
        this.remember();
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}
