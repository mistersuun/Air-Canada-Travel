import { DOCUMENT, Directive, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AppStateService } from '../state/app-state.service';
import { shortcutAllowed } from './keyboard';
import { isDetailPath } from './nav-model';

/** Pages mark their search field with this attribute; '/' focuses the first one. */
export const SEARCH_INPUT_SELECTOR = '[data-search-input]';

/** Frames to wait for a lazy page's search field after navigating to Explore. */
const FOCUS_RETRIES = 40;

/**
 * App-wide single-key shortcuts, on the shell host (hostDirectives):
 *   /    focus the page's search field (or open Explore and focus it)
 *   ?    keyboard shortcuts sheet
 *   Esc  back from /to, /flight, /calendar; on Explore, clear the search
 * Week keys (←/→, 0–7, T) live in ui/week-strip with [shortcuts]="true".
 */
@Directive({
  selector: '[appShellShortcuts]',
  standalone: true,
  host: { '(document:keydown)': 'onKey($event)' },
})
export class ShellShortcutsDirective {
  private readonly doc = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly state = inject(AppStateService);

  onKey(e: KeyboardEvent): void {
    if (!shortcutAllowed(e, this.doc)) return;
    if (e.key === '/') {
      e.preventDefault();
      this.focusSearch();
    } else if (e.key === '?') {
      e.preventDefault();
      this.state.openShortcuts();
    } else if (e.key === 'Escape') {
      const path = this.state.path();
      if (isDetailPath(path)) {
        e.preventDefault();
        this.state.goBack();
      } else if (path === '/' && this.state.query()) {
        e.preventDefault();
        this.state.setQuery('');
      }
    }
  }

  private focusSearch(): void {
    if (this.tryFocus()) return;
    void this.router.navigate(['/'], { queryParams: this.state.globalParams() }).then(() => {
      let n = 0;
      const step = () => {
        if (this.tryFocus() || ++n > FOCUS_RETRIES) return;
        (this.doc.defaultView?.requestAnimationFrame ?? setTimeout)(step);
      };
      step();
    });
  }

  private tryFocus(): boolean {
    const el = this.doc.querySelector<HTMLInputElement>(SEARCH_INPUT_SELECTOR);
    if (!el) return false;
    el.focus();
    el.select?.();
    return true;
  }
}
