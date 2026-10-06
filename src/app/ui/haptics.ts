/**
 * Small vibration cues for touch devices. Every call is a no-op when the
 * browser has no Vibration API (iOS Safari, desktop) or the person prefers
 * reduced motion.
 */

function allowed(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  try {
    return !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

function buzz(pattern: number | number[]): void {
  if (!allowed()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* some browsers throw without a user gesture */
  }
}

/** A light tap: a toggle or a selection. */
export function tap(): void { buzz(8); }
/** Something worked. */
export function success(): void { buzz([12, 60, 18]); }
/** Something needs a second look. */
export function warn(): void { buzz([30, 40, 30]); }
