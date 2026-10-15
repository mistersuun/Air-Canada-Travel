import { NavigationEnd, type Router } from '@angular/router';
import type { AppStateService } from './state/app-state.service';
import { holdsReload, isEditingField } from './state/pwa-update.service';

/** How long the first render waits for the schedules and route network. */
export const STARTUP_BUDGET_MS = 8_000;
/** sessionStorage flag: the app already reloaded once for late data in this tab session. */
export const LATE_RELOAD_KEY = 'ac:late-data-reload';

type StartupState = Pick<AppStateService, 'reportDataLoad' | 'reportDataPending' | 'reportDataReady' | 'reloadPage'>;

/** Decides whether a surprise reload is harmless right now. */
export interface ReloadGuard {
  allowed(): boolean;
}

/**
 * A reload for late data is allowed only while the user has done nothing since the
 * first render: no tap or key, no navigation past the first, not on a page that holds
 * a reload (passes, group links, imports), no field in focus, no dialog open.
 */
export function createReloadGuard(doc: Document, router: Pick<Router, 'events' | 'url'>): ReloadGuard {
  let touched = false;
  let navs = 0;
  const mark = () => { touched = true; };
  doc.addEventListener('pointerdown', mark, true);
  doc.addEventListener('keydown', mark, true);
  router.events.subscribe(e => { if (e instanceof NavigationEnd) navs++; });
  return {
    allowed: () => !touched && navs <= 1 && !holdsReload(router.url.split(/[?#]/)[0]) && !isEditingField(doc) && !doc.querySelector('dialog[open]'),
  };
}

/** sessionStorage, or null when blocked. */
function sessionOf(doc: Document): Pick<Storage, 'getItem' | 'setItem'> | null {
  try { return doc.defaultView?.sessionStorage ?? null; } catch { return null; }
}

/**
 * App-initializer body: resolves when the schedules and route network have loaded, or
 * after the budget so a slow network cannot hold the first render. (The photo credits
 * are not waited for: they are reactive.) Whatever has not finished keeps loading:
 * the state shows "still loading", then
 * - a late failure shows the usual Retry banner;
 * - a late success reloads the page if the user has not touched anything (once per tab
 *   session), else shows "ready, refresh". Either way scheduleRev is bumped, so lists
 *   that read it update in place.
 */
export function startupLoad(
  state: StartupState,
  schedulesOk: Promise<boolean>,
  networkLoad: Promise<unknown>,
  onLoaded: () => void,
  guard: ReloadGuard,
  doc: Document,
  budgetMs: number = STARTUP_BUDGET_MS,
): Promise<void> {
  let gaveUp = false;
  const settled = Promise.all([schedulesOk, networkLoad]).then(([ok]) => {
    if (!gaveUp) {
      state.reportDataLoad(ok);
      onLoaded();
      return;
    }
    if (!ok) {
      state.reportDataLoad(false);
      return;
    }
    const session = sessionOf(doc);
    let already = true;
    try { already = session?.getItem(LATE_RELOAD_KEY) != null; } catch { /* treat as already reloaded */ }
    onLoaded();
    if (!already && session && guard.allowed()) {
      try { session.setItem(LATE_RELOAD_KEY, '1'); } catch { state.reportDataReady(); return; }
      state.reportDataLoad(true);
      state.reloadPage();
    } else {
      state.reportDataReady();
    }
  });
  return new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      gaveUp = true;
      state.reportDataPending();
      resolve();
    }, budgetMs);
    void settled.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
