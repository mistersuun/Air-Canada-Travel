import { ChangeDetectionStrategy, Component, DOCUMENT, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppStateService } from '../../state/app-state.service';
import type { Trip } from '../../trips/model';
import { groupPath } from '../../ui/links';
import { MAX_NAME } from '../group-doc';
import { GroupService, type GroupRecord } from '../group.service';
import { shareOrCopy } from '../share-link';

/** Trip menu section: start a group trip (E2E encrypted link) or manage the one already started. */
@Component({
  selector: 'app-group-section',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="grp" data-group>
      <div>
        <h3 class="ui-h3">Group trip</h3>
        <p class="ui-sub">One link for your travel companions: the plan plus who is on which flight. End-to-end encrypted, no accounts.</p>
      </div>
      @if (rec(); as r) {
        <p class="ui-sub gt__warn" data-group-warning>Anyone with this link can see and update the plan. Keep it to your travel companions. Don't share pass or listing details.</p>
        <div class="gt__acts">
          <button type="button" class="ui-btn ui-btn--sm ui-btn--dark" data-group-copy (click)="copy(r)">Copy link</button>
          <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost" data-group-share (click)="share(r)">Share</button>
        </div>
        <a class="gt__open" data-group-open [routerLink]="path(r)">Open the group page</a>
      } @else if (starting()) {
        <label class="gt__f"><span class="ui-label">Your nickname (shown to the group)</span>
          <input type="text" [maxLength]="maxName" autocomplete="off" data-group-name [value]="nick()" (input)="nick.set($any($event.target).value)" /></label>
        <div class="gt__acts">
          <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost" (click)="starting.set(false)">Cancel</button>
          <button type="button" class="ui-btn ui-btn--sm ui-btn--dark" data-group-create [disabled]="busy() || !nick().trim()" (click)="create()">Create link</button>
        </div>
      } @else {
        <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost gt__start" data-group-start (click)="starting.set(true)">Start a group trip</button>
      }
      @if (problem()) { <p class="ui-sub gt__warn" role="status">{{ problem() }}</p> }
    </section>
  `,
  styles: [`
    .grp { display: grid; gap: 12px; padding: 14px 16px; border-radius: 18px; background: var(--fill); }
    .grp .ui-sub { margin-top: 2px; }
    .gt__warn { font-size: 13px; }
    .gt__f { display: grid; gap: 4px; background: var(--surface); border-radius: 14px; padding: 10px 12px; }
    .gt__f input { border: 0; background: none; color: var(--ink); font: 400 15px/1.4 var(--sans); padding: 0; outline: none; min-height: 24px; }
    .gt__f:focus-within { box-shadow: 0 0 0 2px var(--blue); }
    .gt__acts { display: flex; gap: 8px; }
    .gt__acts .ui-btn { flex: 1; min-height: 44px; }
    .gt__acts .ui-btn--ghost, .gt__start { background: var(--surface); }
    .gt__start { justify-self: start; min-height: 40px; }
    .gt__open { justify-self: start; font-size: 14px; font-weight: 600; color: var(--blue); min-height: 44px; display: inline-flex; align-items: center; }
  `],
})
export class GroupSectionComponent {
  private readonly groups = inject(GroupService);
  private readonly state = inject(AppStateService);
  private readonly doc = inject(DOCUMENT);

  readonly trip = input.required<Trip>();
  protected readonly maxName = MAX_NAME;
  protected readonly starting = signal(false);
  protected readonly busy = signal(false);
  protected readonly nick = signal('');
  protected readonly problem = signal('');
  protected readonly rec = computed<GroupRecord | null>(() => { this.groups.all(); return this.groups.forTrip(this.trip().id); });

  protected path(r: GroupRecord): string[] { return groupPath(r.id); }

  protected async create(): Promise<void> {
    this.busy.set(true);
    this.problem.set('');
    try {
      const r = await this.groups.create(this.trip(), this.nick());
      if (!r.ok) {
        this.problem.set(r.reason === 'too-large' ? 'This trip is too large to share as a group.' : 'Group sharing needs the online service. Try again when you are connected.');
        return;
      }
      this.state.flash('Group link ready');
    } finally {
      this.busy.set(false);
    }
  }

  private url(r: GroupRecord): string {
    return this.groups.urlOf(this.groups.linkOf(r));
  }

  protected async copy(r: GroupRecord): Promise<void> {
    const out = await shareOrCopy(this.doc.defaultView, this.url(r), this.trip().name, 'Our group trip plan', false);
    this.state.flash(out === 'copied' ? 'Link copied' : 'Could not copy the link');
  }

  protected async share(r: GroupRecord): Promise<void> {
    const out = await shareOrCopy(this.doc.defaultView, this.url(r), this.trip().name, 'Our group trip plan');
    if (out === 'copied') this.state.flash('Link copied');
    else if (out === 'failed') this.state.flash('Could not share the link');
  }
}
