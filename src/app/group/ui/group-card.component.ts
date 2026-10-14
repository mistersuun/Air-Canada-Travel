import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppStateService } from '../../state/app-state.service';
import type { Trip } from '../../trips/model';
import { groupPath } from '../../ui/links';
import { memberList, type GroupDoc } from '../group-doc';
import { GroupService } from '../group.service';
import { AvatarChipComponent } from './avatar-chip.component';

/**
 * "Travelling with friends?" on the Plan tab: starts a group trip (opens the
 * Share sheet on the live group), or, when this trip has one, shows who is on
 * which flight and the meet-up point and opens the group page.
 */
@Component({
  selector: 'app-group-card',
  standalone: true,
  imports: [RouterLink, AvatarChipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rec(); as r) {
      <a class="ui-card gc" data-group-card [routerLink]="path(r.id)" [queryParams]="state.globalParams()">
        <span class="gc__t"><b>Group trip</b><span class="ui-sub">{{ summary() }}</span></span>
        <span class="gc__av">
          @for (n of names(); track n) { <app-avatar-chip [name]="n" [showName]="false" /> }
        </span>
        @if (rows().length) {
          <ul class="gc__l" data-group-status>
            @for (m of rows(); track m.id) { <li><b>{{ m.status.name }}</b> {{ m.status.planLabel || 'No plan set' }}</li> }
          </ul>
        }
        @if (meetup()) { <p class="gc__m" data-group-meetup><span class="ui-label">Meet up</span> {{ meetup() }}</p> }
        <span class="gc__go">Open the group page</span>
      </a>
    } @else {
      <section class="ui-card gc gc--start" data-group-prompt>
        <span class="gc__t"><b>Travelling with friends?</b><span class="ui-sub">Start a group trip: one private link where everyone adds which flight they are on.</span></span>
        <button type="button" class="ui-btn ui-btn--sm ui-btn--ghost" data-group-start-card (click)="start.emit()">Start a group trip</button>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .gc { display: grid; gap: 8px; padding: 14px 16px; color: var(--ink); text-decoration: none; }
    .gc__t { display: grid; gap: 2px; }
    .gc__t b { font-size: 15.5px; font-weight: 650; }
    .gc__av { display: flex; }
    .gc__l { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; font-size: 14px; color: var(--ink-2); }
    .gc__l b { color: var(--ink); font-weight: 600; }
    .gc__m { font-size: 14px; margin: 0; }
    .gc__go { color: var(--blue); font-size: 14px; font-weight: 600; }
    .gc--start .ui-btn { justify-self: start; min-height: 44px; }
  `],
})
export class GroupCardComponent {
  protected readonly state = inject(AppStateService);
  private readonly groups = inject(GroupService);

  readonly trip = input.required<Trip>();
  readonly start = output<void>();

  protected readonly rec = computed(() => { this.groups.all(); return this.groups.forTrip(this.trip().id); });
  private readonly doc = signal<GroupDoc | null>(null);
  protected readonly rows = computed(() => { const d = this.doc(); const r = this.rec(); return d ? memberList(d, r?.memberId ?? null) : []; });
  protected readonly names = computed(() => (this.rows().length ? this.rows().map(m => m.status.name) : (this.rec()?.names ?? [this.rec()?.name ?? '']).filter(Boolean)));
  protected readonly meetup = computed(() => this.doc()?.meetup?.text ?? '');
  protected readonly summary = computed(() => {
    const n = this.names().length;
    return n > 1 ? `${n} people in this group` : 'Just you so far. Share the link with your friends.';
  });

  constructor() {
    // One quiet read when the card shows (offline: the cached nicknames stay).
    effect(() => {
      const r = this.rec();
      if (!r) return;
      untracked(() => { void this.groups.load(this.groups.linkOf(r)).then(res => { if (res.ok) this.doc.set(res.doc); }); });
    });
  }

  protected path(id: string): string[] { return groupPath(id); }
}
