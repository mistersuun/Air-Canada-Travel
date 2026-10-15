import { DOCUMENT, DestroyRef, Injectable, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { isPassView } from '../shell/nav-model';

/**
 * New-deploy detection. When the service worker has downloaded a new version
 * (new schedules ship inside the bundle), `ready` turns true and the shell
 * shows a "A new version is available · Reload" toast.
 *
 * If the version lands while the app is hidden, or the app is hidden after it
 * lands, the next resume reloads on its own (`reloadOnResume`), unless the user
 * could be mid-edit (a form page or a focused field).
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
  /** True once the app was in the background while an update was waiting. */
  private hiddenWithUpdate = false;
  private hiddenAt: number | null = null;

  constructor() {
    const nav = this.router.events.subscribe(e => {
      if (e instanceof NavigationEnd) clearChunkReloadFlag(this.doc.defaultView, e.urlAfterRedirects);
    });
    inject(DestroyRef).onDestroy(() => nav.unsubscribe());
    if (!this.sw?.isEnabled) return;
    const sub = this.sw.versionUpdates.subscribe((e: VersionEvent) => {
      if (e.type === 'VERSION_READY') {
        this.ready.set(true);
        if (this.doc.visibilityState === 'hidden') this.hiddenWithUpdate = true;
      }
      else if (e.type === 'VERSION_INSTALLATION_FAILED') console.warn('[sw] new version failed to install:', e.error);   // i18n-ignore
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

  /** Activates the waiting version first, so the reload boots it rather than the old one. */
  reload(): void {
    const win = this.doc.defaultView;
    const reload = () => win?.location.reload();
    const activate = this.sw?.isEnabled ? this.sw.activateUpdate?.() : undefined;
    if (activate) activate.catch(() => false).then(reload);
    else reload();
  }

  /** Call when the document becomes hidden. */
  noteHidden(): void {
    if (this.ready()) this.hiddenWithUpdate = true;
    this.hiddenAt ??= Date.now();
  }

  /** Call when the document becomes visible again. Returns true if it reloaded. */
  reloadOnResume(path: string): boolean {
    const hiddenFor = this.hiddenAt === null ? Infinity : Date.now() - this.hiddenAt;
    this.hiddenAt = null;
    if (!this.ready() || !this.hiddenWithUpdate) return false;
    // A short trip to a file picker or the camera is not "coming back to the app".
    if (hiddenFor < MIN_HIDDEN_MS) return false;
    if (holdsReload(path) || isEditingField(this.doc) || this.doc.querySelector('dialog[open]')) return false;
    this.hiddenWithUpdate = false;
    this.reload();
    return true;
  }

  dismiss(): void {
    this.ready.set(false);
  }

  dismissBroken(): void {
    this.broken.set(false);
  }
}

/** The app must have been in the background this long before an update reloads it on resume. */
const MIN_HIDDEN_MS = 60_000;

/** Pages where a surprise reload would lose typing or interrupt a pass: boarding passes, the add flow, group links, imports. */
export function holdsReload(path: string): boolean {
  return isPassView(path) || /^\/(g\/|share-in|trips\/import)/.test(path);
}

export function isEditingField(doc: Document): boolean {
  const el = doc.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable === true);
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
