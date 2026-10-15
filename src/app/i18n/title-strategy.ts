import { EnvironmentInjector, Injectable, effect, inject, runInInjectionContext, untracked } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRouteSnapshot, Resolve, ResolveFn, RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { locale } from './locale';
import { isMsgKey, t } from './t';

/**
 * document.title in the UI language. A route's `title` is either a message
 * key ('shell.title.map') or a synchronous ResolveFn that builds its text
 * with t(). On a language switch the current title is rebuilt: keys are
 * translated again and the resolver is re-run, so the tab title follows
 * without a navigation.
 */
@Injectable({ providedIn: 'root' })
export class I18nTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly injector = inject(EnvironmentInjector);
  private last: RouterStateSnapshot | null = null;

  constructor() {
    super();
    // Tracks the locale only: a title resolver that reads other signals must not
    // re-run the effect (titles otherwise change on navigation).
    effect(() => {
      locale();
      untracked(() => {
        if (this.last) this.updateTitle(this.last);
      });
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.last = snapshot;
    const text = this.titleFor(snapshot);
    if (text !== undefined) this.title.setTitle(text);
  }

  /** The deepest route's title, translated (or re-resolved) in the current language. */
  titleFor(snapshot: RouterStateSnapshot): string | undefined {
    let owner: ActivatedRouteSnapshot | null = null;
    for (let r: ActivatedRouteSnapshot | null = snapshot.root; r; r = r.firstChild) {
      if (r.routeConfig?.title !== undefined) owner = r;
    }
    const raw = owner?.routeConfig?.title;
    // A ResolveFn (class-based resolvers keep the value Angular resolved).
    if (typeof raw === 'function' && !(raw.prototype as Partial<Resolve<string>> | undefined)?.resolve) {
      const fn = raw as ResolveFn<string>;
      const out = runInInjectionContext(this.injector, () => fn(owner!, snapshot));
      return typeof out === 'string' ? out : this.buildTitle(snapshot);
    }
    const built = typeof raw === 'string' ? raw : this.buildTitle(snapshot);
    return built !== undefined && isMsgKey(built) ? t(built) : built;
  }
}
