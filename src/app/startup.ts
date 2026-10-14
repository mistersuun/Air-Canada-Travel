import type { AppStateService } from './state/app-state.service';

/** How long the first render waits for the schedules, route network and photo credits. */
export const STARTUP_BUDGET_MS = 8_000;

type StartupState = Pick<AppStateService, 'reportDataLoad' | 'reportDataPending' | 'reloadPage'>;

/**
 * App-initializer body: resolves when the data has loaded, or after the budget
 * so a slow network cannot hold the first render. Whatever has not finished
 * keeps loading: the state shows "still loading", then a late success reloads
 * the page (most pages read the schedule index without a reactive dependency,
 * the same reason retryDataLoad reloads) and a late failure shows the usual
 * Retry banner.
 */
export function startupLoad(
  state: StartupState,
  schedulesOk: Promise<boolean>,
  rest: Promise<unknown>,
  onLoaded: () => void,
  budgetMs: number = STARTUP_BUDGET_MS,
): Promise<void> {
  let gaveUp = false;
  const settled = Promise.all([schedulesOk, rest]).then(([ok]) => {
    state.reportDataLoad(ok);
    if (!gaveUp) onLoaded();
    else if (ok) state.reloadPage();
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
