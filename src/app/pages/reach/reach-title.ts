import { DestroyRef, Signal, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { t } from '../../i18n/t';

/**
 * Sets "<Place> · Reach · Routes" once the place is known, and again after every
 * navigation (the router resets the route title when only query params change).
 * Call in an injection context.
 */
export function reachTitle(name: Signal<string>): void {
  const title = inject(Title);
  const ended = signal(0);
  const sub = inject(Router).events.subscribe(e => {
    if (e instanceof NavigationEnd) ended.update(n => n + 1);
  });
  inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  effect(() => {
    ended();
    const n = name();
    if (n) title.setTitle(t('places.reach.pageTitle', { name: n }));
  });
}
