import { Injectable, inject, signal } from '@angular/core';
import { PlatformLocation } from '@angular/common';
import { ProfileService } from '../recs/profile.service';
import { PREFS_KEY, PREFS_STORAGE } from '../state/prefs.service';

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
    try {
      this.storage?.setItem(ONBOARDED_KEY, '1');
    } catch {
      // Blocked or full: it stays closed for this session.
    }
  }

  private shouldShow(): boolean {
    try {
      if (!this.storage) return false;
      if ((this.location.pathname || '/') !== '/') return false;
      if (this.storage.getItem(ONBOARDED_KEY) !== null) return false;
      if (this.storage.getItem(PREFS_KEY) !== null) return false;
      return this.profile.isEmpty();
    } catch {
      return false;
    }
  }
}
