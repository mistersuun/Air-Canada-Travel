/**
 * Shared guard for the app's single-key shortcuts (shell: '/', '?', Esc;
 * week strip: arrows, 0-7). A shortcut is ignored when:
 * - a modifier is held (so Ctrl+F, Cmd+1 etc. keep their browser meaning),
 * - focus is in a text field, select or contenteditable,
 * - any <dialog> is open (flight modal, settings, filter sheet), or
 * - another handler already called preventDefault().
 */
export function shortcutAllowed(e: KeyboardEvent, doc: Document): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
  const t = e.target as HTMLElement | null;
  if (t && t !== doc.body && t.closest) {
    if (t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return false;
  }
  return !doc.querySelector('dialog[open]');
}
