/**
 * Which shell chrome a path shows. Pure, so the top nav, the tab bar and the
 * shell's sky wash agree (and specs can check every route).
 */
export type NavSection = 'explore' | 'map' | 'trips' | 'calendar';

export function navSection(path: string): NavSection {
  if (path.startsWith('/map')) return 'map';
  if (/^\/(trips|today|saved)(\/|$)/.test(path)) return 'trips';
  if (path.startsWith('/calendar')) return 'calendar';
  return 'explore'; // '/', /to/*, /flight/*, /reach/*
}

/** Detail pages show their own back button instead of the mobile tab bar. */
export function isDetailPath(path: string): boolean {
  return /^\/(to|flight|calendar|today|reach|profile|logbook)(\/|$)/.test(path) || /^\/trips\/[^/]+/.test(path);
}

/** The desktop top nav is replaced by the destination hero's own buttons. */
export function hidesTopNav(path: string): boolean {
  return /^\/to\//.test(path);
}

/** Boarding-pass views (and the add flow): a held-up phone at the gate, where a reload prompt would be in the way. */
export function isPassView(path: string): boolean {
  return /^\/(trips\/[^/]+\/pass(?:es)?\/)/.test(path);
}

/** The shell paints the sky wash behind these pages; the others draw their own background. */
export function hasSkywash(path: string): boolean {
  return path === '/' || path === '' || path.startsWith('/saved') || path.startsWith('/flight/')
    || /^\/(trips|reach|profile|logbook)(\/|$)/.test(path);
}
