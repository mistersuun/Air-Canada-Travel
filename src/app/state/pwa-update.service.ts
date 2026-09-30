import { DOCUMENT, DestroyRef, Injectable, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';

/**
 * New-deploy detection. When the service worker has downloaded a new version
 * (new schedules ship inside the bundle), `ready` turns true and the shell
 * shows a "New schedules available · Reload" toast.
 *
 * SwUpdate is optional so the service works in tests and in dev (worker
 * disabled). Specs can provide a stub:
 *   { provide: SwUpdate, useValue: { isEnabled: true, versionUpdates: subject, checkForUpdate: vi.fn() } }
 */
@Injectable({ providedIn: 'root' })
export class PwaUpdateService {
  private readonly sw = inject(SwUpdate, { optional: true });
  private readonly doc = inject(DOCUMENT);
  readonly ready = signal(false);

  constructor() {
    if (!this.sw?.isEnabled) return;
    const sub = this.sw.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => this.ready.set(true));
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  /** Ask the worker to look for a new version (on tab focus). Never throws. */
  check(): void {
    if (!this.sw?.isEnabled) return;
    this.sw.checkForUpdate().catch(() => undefined);
  }

  reload(): void {
    this.doc.defaultView?.location.reload();
  }

  dismiss(): void {
    this.ready.set(false);
  }
}
