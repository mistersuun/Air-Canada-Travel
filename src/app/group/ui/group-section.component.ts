import { ChangeDetectionStrategy, Component, DOCUMENT, ElementRef, afterNextRender, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { t } from '../../i18n/t';
import { AppStateService } from '../../state/app-state.service';
import type { Trip } from '../../trips/model';
import { groupPath } from '../../ui/links';
import { MAX_NAME } from '../group-doc';
import { GroupService, type GroupRecord } from '../group.service';
import { shareOrCopy } from '../share-link';

/** Share sheet section: start a live group plan (E2E encrypted link) or manage the one already started (edit link, view-only link). */
@Component({
  selector: 'app-group-section',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="grp" data-group>
      <div>
        <h3 class="ui-h3">{{ t('group.section.title') }}</h3>
        <p class="ui-sub">{{ t('group.section.intro') }}</p>
        <p class="ui-sub gt__warn" data-group-shared>{{ t('group.section.shared') }}</p>
      </div>
      @if (rec(); as r) {
        <div class="gt__opt" data-group-edit>
          <b>{{ t('group.section.editLink') }}</b>
          <span class="ui-sub" data-group-warning>{{ t('group.section.warning') }}</span>
          <div class="gt__acts">
            <button type="button" class="ui-btn ui-btn--sm ui-btn--dark" data-group-copy (click)="copy(r)">{{ t('group.section.copyEdit') }}</button>
            <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost" data-group-share (click)="share(r)">{{ t('group.section.share') }}</button>
          </div>
        </div>
        <div class="gt__opt" data-group-view>
          <b>{{ t('group.section.viewLink') }}</b>
          <span class="ui-sub">{{ t('group.section.viewText') }}</span>
          <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost" data-group-copy-view (click)="copy(r, true)">{{ t('group.section.copyView') }}</button>
        </div>
        <a class="gt__open" data-group-open [routerLink]="path(r)">{{ t('group.openPage') }}</a>
      } @else if (starting()) {
        <label class="gt__f"><span class="ui-label">{{ t('group.section.nickname') }}</span>
          <input type="text" [maxLength]="maxName" autocomplete="off" data-group-name [value]="nick()" (input)="nick.set($any($event.target).value)" /></label>
        <div class="gt__acts">
          <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost" (click)="starting.set(false)">{{ t('group.cancel') }}</button>
          <button type="button" class="ui-btn ui-btn--sm ui-btn--dark" data-group-create [disabled]="busy() || !nick().trim()" (click)="create()">{{ t('group.section.create') }}</button>
        </div>
      } @else {
        <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost gt__start" data-group-start (click)="starting.set(true)">{{ t('group.start') }}</button>
      }
      @if (problem()) { <p class="ui-sub gt__warn" role="status">{{ problem() }}</p> }
    </section>
  `,
  styles: [`
    .grp { display: grid; gap: 12px; padding: 14px 16px; border-radius: 18px; background: var(--fill); }
    .grp .ui-sub { margin-top: 2px; }
    .gt__warn { font-size: 13px; }
    .gt__opt { display: grid; gap: 6px; padding: 10px 12px; border-radius: 14px; background: var(--surface); }
    .gt__opt b { font-size: 14.5px; font-weight: 650; }
    .gt__f { display: grid; gap: 4px; background: var(--surface); border-radius: 14px; padding: 10px 12px; }
    .gt__f input { border: 0; background: none; color: var(--ink); font: 400 15px/1.4 var(--sans); padding: 0; outline: none; min-height: 24px; }
    .gt__f:focus-within { box-shadow: 0 0 0 2px var(--blue); }
    .gt__acts { display: flex; gap: 8px; }
    .gt__acts .ui-btn { flex: 1; min-height: 44px; }
    .gt__opt > .ui-btn { min-height: 44px; }
    .gt__acts .ui-btn--ghost, .gt__start { background: var(--surface); }
    .gt__opt .ui-btn--ghost { background: var(--fill); }
    .gt__opt .gt__acts .ui-btn--ghost { background: var(--fill); }
    .gt__start { justify-self: start; min-height: 44px; }
    .gt__open { justify-self: start; font-size: 14px; font-weight: 600; color: var(--blue); min-height: 44px; display: inline-flex; align-items: center; }
  `],
})
export class GroupSectionComponent {
  protected readonly t = t;
  private readonly groups = inject(GroupService);
  private readonly state = inject(AppStateService);
  private readonly doc = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly trip = input.required<Trip>();
  /** Open straight on the nickname field (from the "Travelling with friends?" card). */
  readonly startOpen = input(false);
  protected readonly maxName = MAX_NAME;
  protected readonly starting = linkedSignal(() => this.startOpen());
  protected readonly busy = signal(false);
  protected readonly nick = signal('');
  protected readonly problem = signal('');
  protected readonly rec = computed<GroupRecord | null>(() => { this.groups.all(); return this.groups.forTrip(this.trip().id); });

  constructor() {
    // Opened from the "Travelling with friends?" card: the nickname is the next thing to type.
    afterNextRender(() => { if (this.startOpen()) this.host.nativeElement.querySelector<HTMLInputElement>('[data-group-name]')?.focus(); });
  }

  protected path(r: GroupRecord): string[] { return groupPath(r.id); }

  protected async create(): Promise<void> {
    this.busy.set(true);
    this.problem.set('');
    try {
      const r = await this.groups.create(this.trip(), this.nick());
      if (!r.ok) {
        this.problem.set(t(r.reason === 'too-large' ? 'group.section.tooLarge'
          : r.reason === 'budget' ? 'group.section.budget'
          : 'group.section.offline'));
        return;
      }
      this.state.flash(t('group.section.ready'));
    } finally {
      this.busy.set(false);
    }
  }

  private url(r: GroupRecord, viewOnly = false): string {
    return this.groups.urlOf(this.groups.linkOf(r, viewOnly));
  }

  protected async copy(r: GroupRecord, viewOnly = false): Promise<void> {
    const out = await shareOrCopy(this.doc.defaultView, this.url(r, viewOnly), this.trip().name, t('group.shareText'), false);
    this.state.flash(t(out === 'copied' ? (viewOnly ? 'group.viewCopied' : 'group.linkCopied') : 'group.copyFailed'));
  }

  protected async share(r: GroupRecord): Promise<void> {
    const out = await shareOrCopy(this.doc.defaultView, this.url(r), this.trip().name, t('group.shareText'));
    if (out === 'copied') this.state.flash(t('group.linkCopied'));
    else if (out === 'failed') this.state.flash(t('group.shareFailed'));
  }
}
