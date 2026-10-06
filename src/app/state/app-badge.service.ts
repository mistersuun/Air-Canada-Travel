import { Injectable, effect, inject } from '@angular/core';
import { badgeCount } from '../trips/engine/coming-up';
import { TripsService } from '../trips/trips.service';
import { AppStateService } from './app-state.service';

export interface BadgeNav { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }

/** Sets the installed app's icon badge from what is waiting (see badgeCount). No-op where the Badging API is missing. Never notifies. */
@Injectable({ providedIn: 'root' })
export class AppBadgeService {
  private readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  private last = -1;

  constructor() {
    effect(() => this.apply(badgeCount(this.trips.readOnly() ? [] : this.trips.trips(), this.trips.pendingOutcomes().length, this.state.nowMs())));
  }

  apply(count: number, nav: BadgeNav | undefined = typeof navigator === 'undefined' ? undefined : (navigator as BadgeNav)): void {
    if (count === this.last || !nav) return;
    try {
      const p = count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.();
      if (!p) return;
      this.last = count;
      p.catch(() => undefined);
    } catch { /* the badge is a nicety */ }
  }
}
