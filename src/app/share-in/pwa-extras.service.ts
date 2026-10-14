import { DOCUMENT, Injectable, Injector, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { getSchedulesMeta } from '../data/schedule-index';
import { PwaUpdateService } from '../state/pwa-update.service';
import { ShareInboxService } from './share-inbox.service';
import { t } from '../i18n/t';

interface LaunchParams { files?: { getFile(): Promise<File> }[] }
interface LaunchQueueLike { setConsumer(cb: (p: LaunchParams) => void): void }

/**
 * Wires the app to the extras in public/sw.js, all feature-detected (iOS and
 * Firefox simply skip them):
 *  - File Handling: files opened with the installed app arrive through
 *    launchQueue and are routed to /share-in like a share.
 *  - Tells the worker which schedules this tab loaded, so a background check
 *    does not announce what the user already sees.
 *  - Posts the notification wording (in the UI language) for the worker to keep.
 *  - When the worker says schedules changed while a window is open, asks
 *    ngsw to look for the new version (the usual "Reload" toast follows).
 */
@Injectable({ providedIn: 'root' })
export class PwaExtrasService {
  private readonly win = inject(DOCUMENT).defaultView;
  private readonly router = inject(Router);
  private readonly inbox = inject(ShareInboxService);
  private readonly pwa = inject(PwaUpdateService);
  private readonly injector = inject(Injector);

  init(): void {
    const win = this.win;
    if (!win) return;
    const lq = (win as unknown as { launchQueue?: LaunchQueueLike }).launchQueue;
    lq?.setConsumer(params => {
      const handles = params.files ?? [];
      if (!handles.length) return;
      void Promise.all(handles.map(h => h.getFile())).then(files => {
        this.inbox.offerFiles(files);
        void this.router.navigate(['/share-in']);
      }).catch(() => undefined);
    });

    const sw = win.navigator.serviceWorker;
    if (!sw) return;
    sw.addEventListener('message', e => {
      if ((e.data as { type?: unknown } | null)?.type === 'ac:schedules-updated') this.pwa.check();
    });
    // The worker cannot import t(): it keeps the notification wording the page last posted, in the UI language.
    effect(() => {
      const msg = { type: 'ac:notify-text', title: t('shareIn.notify.title'), body: t('shareIn.notify.body') };
      void sw.ready.then(reg => reg.active?.postMessage(msg)).catch(() => undefined);
    }, { injector: this.injector });
  }

  /** Call once the schedules have loaded. */
  announceSchedules(): void {
    const sw = this.win?.navigator.serviceWorker;
    const generatedAt = getSchedulesMeta()?.generatedAt;
    if (sw && generatedAt) void sw.ready.then(reg => reg.active?.postMessage({ type: 'ac:schedules-seen', generatedAt })).catch(() => undefined);
  }
}
