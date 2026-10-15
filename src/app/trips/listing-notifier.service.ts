import { DOCUMENT, Injectable, inject } from '@angular/core';
import { t } from '../i18n/t';
import { PrefsService } from '../state/prefs.service';
import { airportName } from '../utils/airports';
import { listingOpenedSince } from './engine/listing';
import { TripsService } from './trips.service';

export const LISTING_SEEN_KEY = 'ac.listing-seen.v1';

/**
 * A local notification when a flight's listing window opened since the app was
 * last check. Only where the Notifications permission is already granted (this
 * never asks), only on app open and whenever the app comes back to the foreground, and nothing leaves the device: no push, no
 * server. Listing stays the traveller's own step.
 */
@Injectable({ providedIn: 'root' })
export class ListingNotifierService {
  private readonly trips = inject(TripsService);
  private readonly prefs = inject(PrefsService);
  private readonly doc = inject(DOCUMENT);

  /** Notify for windows opened since the last check, then remember `nowMs`. Returns how many were shown. */
  check(nowMs: number): number {
    const store = this.storage();
    let since = nowMs;
    try {
      const raw = Number(store?.getItem(LISTING_SEEN_KEY));
      if (Number.isFinite(raw) && raw > 0 && raw <= nowMs) since = raw;
    } catch { /* storage blocked: treat as a first open */ }
    try { store?.setItem(LISTING_SEEN_KEY, String(nowMs)); } catch { /* ignore */ }
    if (this.trips.readOnly() || !this.granted()) return 0;
    const opened = listingOpenedSince(this.trips.trips(), since, nowMs, this.prefs.listingHours());
    for (const { trip, leg, refIndex } of opened) {
      const ref = leg.refs[refIndex];
      this.show(t('trips.notify.title', { flight: ref.flightNumber }), t('trips.notify.body', { from: airportName(ref.origin), to: airportName(ref.dest), trip: trip.name }), `listing-${leg.id}-${refIndex}`);
    }
    return opened.length;
  }

  private granted(): boolean {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  }

  private storage(): Storage | null {
    try { return this.doc.defaultView?.localStorage ?? null; } catch { return null; }
  }

  private show(title: string, body: string, tag: string): void {
    try {
      const sw = this.doc.defaultView?.navigator.serviceWorker;
      const reg = sw?.controller ? sw.ready : null;
      if (reg) { void reg.then(r => r.showNotification(title, { body, tag })).catch(() => undefined); return; }
      new Notification(title, { body, tag });
    } catch { /* notifications are a nicety */ }
  }
}
