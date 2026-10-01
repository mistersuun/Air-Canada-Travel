import { isDestinationCode, currentDestinationCode } from '../state/prefs.service';

const GLOBAL_KEYS = ['from', 'week', 'day', 'region', 'q'] as const;

/**
 * Runs once before the router's first navigation (app initializer).
 *
 * A link that lands on a detail page (/to/LIS?from=YYZ, or a legacy
 * /?dest=LHR) gets an Explore entry staged underneath it: the landing entry
 * is rewritten to '/?query' and the page is pushed on top. Back from the
 * deep-linked page then returns to Explore inside the app instead of leaving
 * it, as the old modal did.
 *
 * Returns true when it staged an entry (AppStateService.markStagedBack).
 */
export function stageDeepLink(win: Window | null | undefined): boolean {
  if (!win) return false;
  try {
    if (!freshLanding(win)) return false;
    const { pathname, search, hash } = win.location;
    const params = new URLSearchParams(search);
    let target: string | null = null;

    const path = pathname.replace(/\/+$/, '') || '/';
    if (path !== '/') {
      target = `${path}${search}${hash}`;
    } else if (params.has('dest')) {
      const code = currentDestinationCode(params.get('dest')?.toUpperCase());
      params.delete('dest');
      if (isDestinationCode(code)) {
        const q = params.toString();
        target = `/to/${code}${q ? `?${q}` : ''}${hash}`;
      }
    }
    if (!target) return false;

    // Explore's entry keeps only the global keys (page keys like ?tab= stay on the page).
    const globals = new URLSearchParams();
    for (const k of GLOBAL_KEYS) {
      const v = params.get(k);
      if (v !== null) globals.set(k, v);
    }
    const base = globals.toString();
    win.history.replaceState(null, '', `/${base ? `?${base}` : ''}`);
    win.history.pushState(null, '', target);
    return true;
  } catch {
    return false; // sandboxed frames can refuse history writes
  }
}

/**
 * Only a fresh landing is staged. A reload or a back/forward load of an
 * entry the app already wrote (the router stores its navigationId in
 * history.state) keeps the history as it is: staging again would stack
 * another Explore entry per reload, or truncate the forward history.
 */
function freshLanding(win: Window): boolean {
  const state = win.history?.state as { navigationId?: unknown; ɵrouterPageId?: unknown } | null;
  if (state && typeof state === 'object' && ('navigationId' in state || 'ɵrouterPageId' in state)) return false;
  const nav = win.performance?.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined;
  return !nav || (nav.type !== 'reload' && nav.type !== 'back_forward');
}
