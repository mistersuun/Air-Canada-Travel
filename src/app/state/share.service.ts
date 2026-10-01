import { DOCUMENT, Injectable, inject } from '@angular/core';
import { AppStateService } from './app-state.service';

/**
 * Share the current page: the URL carries the hub, week, day and the page
 * itself (/to/LIS, /flight/…), so sharing it reproduces the view.
 * Web Share when available, else copy to the clipboard and confirm.
 */
@Injectable({ providedIn: 'root' })
export class ShareService {
  private readonly doc = inject(DOCUMENT);
  private readonly state = inject(AppStateService);

  async share(title: string): Promise<void> {
    const win = this.doc.defaultView;
    const nav = win?.navigator;
    const url = win?.location.href ?? '';
    if (nav?.share) {
      try {
        await nav.share({ title, url });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return; // user cancelled
      }
    }
    try {
      if (!nav?.clipboard) throw new Error('no clipboard');
      await nav.clipboard.writeText(url);
      this.state.flash('Link copied');
    } catch {
      this.state.flash('Could not copy the link');
    }
  }
}
