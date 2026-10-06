import { DOCUMENT, DestroyRef, Injectable, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { SwUpdate, VersionEvent } from '@angular/service-worker';

/**
 * New-deploy detection. When the service worker has downloaded a new version
 * (new schedules ship inside the bundle), `ready` turns true and the shell
 * shows a "New schedules available · Reload" toast.
 *
 * `broken` turns true when the worker reports an unrecoverable state (its
 * cache is corrupt): the shell offers a reload to repair it. A failed
 * install of a new version is only logged; the current version keeps working.
 *
 * SwUpdate is optional so the service works in tests and in dev (worker
 * disabled). Specs can provide a stub:
 *   { provide: SwUpdate, useValue: { isEnabled: true, versionUpdates: subject, checkForUpdate: vi.fn() } }
 */
@Injectable({ providedIn: 'root' })
export class PwaUpdateService {
  private readonly sw = inject(SwUpdate, { optional: true });
  private readonly doc = inject(DOCUMENT);
  private readonly router = inject(Router);
  readonly ready = signal(false);
  readonly broken = signal(false);

  constructor() {
    const nav = this.router.events.subscribe(e => {
      if (e instanceof NavigationEnd) clearChunkReloadFlag(this.doc.defaultView, e.urlAfterRedirects);
    });
    inject(DestroyRef).onDestroy(() => nav.unsubscribe());
    if (!this.sw?.isEnabled) return;
    const sub = this.sw.versionUpdates.subscribe((e: VersionEvent) => {
      if (e.type === 'VERSION_READY') this.ready.set(true);
      else if (e.type === 'VERSION_INSTALLATION_FAILED') console.warn('[sw] new version failed to install:', e.error);
    });
    const broken = this.sw.unrecoverable?.subscribe(() => this.broken.set(true));
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      broken?.unsubscribe();
    });
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

  dismissBroken(): void {
    this.broken.set(false);
  }
}

/** sessionStorage key: set once a chunk-load failure has reloaded the page. */
export const CHUNK_RELOAD_KEY = 'ac:chunk-reload';

/** True for a failed lazy-route import (stale hashed chunk after a deploy, or offline). */
export function isChunkLoadError(err: unknown): boolean {
  const text = `${(err as { name?: string } | null)?.name ?? ''} ${(err as { message?: string } | null)?.message ?? err}`;
  return /ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(text);
}

/**
 * Router navigation-error handler: a chunk-load failure loads the target URL
 * afresh once (a full load fetches the current index and chunk names; reload()
 * would reload the page the user is still on). The sessionStorage flag holds
 * that URL and stops a loop when the chunk is genuinely unreachable: a second
 * failure for the same URL is 'blocked'. It clears when a navigation to that
 * URL ends successfully.
 */
export function reloadOnChunkError(err: unknown, win: Window | null, url: string): 'reloaded' | 'blocked' | 'ignored' {
  if (!win || !isChunkLoadError(err)) return 'ignored';
  try {
    if (win.sessionStorage.getItem(CHUNK_RELOAD_KEY) === url) return 'blocked';
    win.sessionStorage.setItem(CHUNK_RELOAD_KEY, url);
  } catch {
    return 'blocked'; // no storage: cannot guard against a loop, so do not reload
  }
  win.location.assign(url);
  return 'reloaded';
}

/** Clears the one-reload guard once a navigation to the flagged URL succeeds. */
export function clearChunkReloadFlag(win: Window | null, url: string): void {
  try {
    if (win?.sessionStorage.getItem(CHUNK_RELOAD_KEY) === url) win.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch { /* ignore */ }
}
