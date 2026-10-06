import { ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, computed, inject, signal } from '@angular/core';
import { PlatformLocation } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { GROUP_ID_RE, type GroupLink, parseGroupFragment } from '../../group/group-crypto';
import { type GroupDoc, MAX_MEETUP, MAX_NAME, MAX_PLAN_LABEL, memberList, planLabelSuggestions } from '../../group/group-doc';
import { GroupService, POLL_MS, type GroupFailure } from '../../group/group.service';
import { shareOrCopy } from '../../group/share-link';
import { AppStateService } from '../../state/app-state.service';
import type { SharedTripPreview } from '../../trips/model';
import { tripPath, tripsPath } from '../../ui/links';
import { TripCardComponent } from '../trips/plan/trip-card.component';

type View = 'loading' | 'invalid' | 'unavailable' | 'gone' | 'ready';

const MESSAGES: Record<GroupFailure, string> = {
  unavailable: 'Group sharing needs the online service. Try again when you are connected.',
  gone: 'This group has ended or expired.',
  invalid: 'This link could not be opened.',
  forbidden: 'This link is view only, so it cannot change the plan.',
  'too-large': 'This plan is too large to share as a group.',
};

/**
 * A group trip (/g/:id#k=<key>[&w=<token>]). The plan and every member's status
 * are decrypted here; the server holds only ciphertext. The key is read from the
 * fragment once (the router then drops it) and kept on this device.
 */
@Component({
  selector: 'app-group-page',
  standalone: true,
  imports: [RouterLink, IconComponent, TripCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare gp">
      <header class="gp__head">
        <button type="button" class="ui-circ ui-circ--glass" aria-label="Back" (click)="back()"><app-icon name="arrow-left" [size]="18" /></button>
        <h1 class="ui-h3">Group trip</h1>
        <span class="gp__sp" aria-hidden="true"></span>
      </header>

      @switch (view()) {
        @case ('loading') { <p class="ui-sub gp__msg" role="status">Opening the group…</p> }
        @case ('ready') {
          @if (preview(); as p) {
            <p class="ui-label gp__lbl" data-group-label>Shared plan · read only</p>
            <app-trip-card [trip]="p.trip" mode="static" />
            @if (p.trip.party.splitNote) {
              <div class="ui-card gp__box"><div class="ui-label">If we split up</div><p>{{ p.trip.party.splitNote }}</p></div>
            }
          }

          <section class="ui-card gp__box" data-members>
            <h2 class="ui-h3">Who is where</h2>
            @if (members().length) {
              <ul class="gp__list">
                @for (m of members(); track m.id) {
                  <li data-member>
                    <b>{{ m.status.name }}{{ m.me ? ' (you)' : '' }}</b>
                    <span>{{ m.status.planLabel || 'No plan set' }}</span>
                    @if (m.status.arrival) { <span class="gp__when">Arrives {{ when(m.status.arrival) }}</span> }
                  </li>
                }
              </ul>
            } @else {
              <p class="ui-sub">Nobody has added a status yet.</p>
            }
            @if (doc()?.meetup?.text; as t) { <p class="gp__meet" data-meetup><span class="ui-label">Meet up</span> {{ t }}</p> }
          </section>

          @if (canWrite()) {
            <section class="ui-card gp__box" data-mine>
              <h2 class="ui-h3">Your status</h2>
              <label class="gp__f"><span class="ui-label">Nickname</span>
                <input type="text" [maxLength]="maxName" autocomplete="off" data-name [value]="name()" (input)="name.set($any($event.target).value)" /></label>
              <label class="gp__f"><span class="ui-label">Your plan</span>
                <input type="text" [maxLength]="maxPlan" autocomplete="off" placeholder="On AC834, Bus to YUL…" data-plan-label [value]="label()" (input)="label.set($any($event.target).value)" /></label>
              @if (suggestions().length) {
                <div class="gp__chips">
                  @for (s of suggestions(); track s) { <button type="button" class="gp__chip" (click)="label.set(s)">{{ s }}</button> }
                </div>
              }
              <label class="gp__f"><span class="ui-label">Arrival (your time zone)</span>
                <input type="datetime-local" data-arrival [value]="arrival()" (input)="arrival.set($any($event.target).value)" /></label>
              <label class="gp__f"><span class="ui-label">Meet-up point</span>
                <input type="text" [maxLength]="maxMeet" autocomplete="off" placeholder="Gate B12 coffee shop" data-meetup-input [value]="meet()" (input)="meet.set($any($event.target).value)" /></label>
              <button type="button" class="ui-btn" data-save-status [disabled]="busy() || !name().trim()" (click)="saveStatus()">Update status</button>
            </section>
          } @else {
            <p class="ui-sub gp__fine" data-view-only>This is a view-only link. You can read the plan but not change statuses.</p>
          }

          <div class="gp__acts">
            <button type="button" class="ui-btn ui-btn--ghost" data-copy-link (click)="copyLink(false)">Copy link</button>
            <button type="button" class="ui-btn" data-save-copy (click)="saveCopy()">Save a copy to my trips</button>
          </div>
          @if (canWrite()) {
            <button type="button" class="gp__link" data-copy-view (click)="copyLink(true)">Copy a view-only link</button>
          }
          @if (owner()) {
            @if (confirmStop()) {
              <div class="ui-card gp__box"><p>This deletes the shared plan for everyone. Saved copies stay on their devices.</p>
                <div class="gp__acts"><button type="button" class="ui-btn ui-btn--ghost" (click)="confirmStop.set(false)">Keep sharing</button>
                  <button type="button" class="ui-btn ui-btn--dark" data-stop-confirm [disabled]="busy()" (click)="stop()">Stop sharing</button></div></div>
            } @else {
              <button type="button" class="gp__del" data-stop (click)="confirmStop.set(true)">Stop sharing</button>
            }
          }
          @if (note()) { <p class="ui-sub gp__fine" role="status" data-note>{{ note() }}</p> }
        }
        @default {
          <div class="ui-card gp__bad" data-group-problem>
            <h2 class="ui-h3">{{ view() === 'unavailable' ? 'Group sharing needs the online service' : view() === 'gone' ? 'This group has ended' : 'This link could not be opened' }}</h2>
            <p class="ui-sub">{{ view() === 'unavailable' ? 'Try again when you are connected.' : view() === 'gone' ? 'The owner stopped sharing, or it expired.' : 'It may be cut short. Ask for the link again, and open it in full.' }}</p>
            @if (view() === 'unavailable') { <button type="button" class="ui-btn ui-btn--ghost" (click)="refresh()">Try again</button> }
            <a class="ui-btn ui-btn--dark" [routerLink]="tripsPath()" [queryParams]="state.globalParams()">Go to Trips</a>
          </div>
        }
      }

      <p class="ui-sub gp__fine" data-pass-rules>Air Canada pass rules do not allow sharing passes or listing details. Share plans and times only.</p>
    </div>
  `,
  styles: [`
    .gp { max-width: 600px; margin-inline: auto; display: flex; flex-direction: column; gap: 12px; }
    .gp__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .gp__head h1 { margin: 0; }
    .gp__sp { width: 40px; flex: none; }
    .gp__msg { text-align: center; padding: 32px 0; }
    .gp__bad { padding: 28px 24px; text-align: center; display: grid; gap: 8px; justify-items: center; }
    .gp__lbl { margin: 4px 2px 0; }
    .gp__box { padding: 14px 16px; display: grid; gap: 10px; }
    .gp__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .gp__list li { display: grid; gap: 1px; }
    .gp__list span { font-size: 14px; color: var(--ink-2); }
    .gp__meet { font-size: 14px; }
    .gp__f { display: grid; gap: 4px; background: var(--fill); border-radius: 14px; padding: 10px 12px; }
    .gp__f input { border: 0; background: none; color: var(--ink); font: 400 15px/1.4 var(--sans); padding: 0; outline: none; min-height: 24px; }
    .gp__f:focus-within { box-shadow: 0 0 0 2px var(--blue); }
    .gp__chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .gp__chip { min-height: 36px; padding: 0 12px; border-radius: 18px; background: var(--fill); font-size: 13.5px; }
    .gp__acts { display: flex; gap: 10px; }
    .gp__acts .ui-btn { flex: 1; }
    .gp__link { justify-self: center; font-size: 14px; font-weight: 600; min-height: 44px; color: var(--blue); }
    .gp__del { justify-self: center; color: var(--red-ink); font-size: 14px; font-weight: 600; min-height: 44px; padding: 0 12px; }
    .gp__fine { text-align: center; font-size: 12.5px; }
    @media (min-width: 720px) { .gp { padding-top: 24px; } }
  `],
})
export class GroupPage {
  protected readonly state = inject(AppStateService);
  private readonly groups = inject(GroupService);
  private readonly router = inject(Router);
  private readonly doc_ = inject(DOCUMENT);
  protected readonly tripsPath = tripsPath;
  protected readonly maxName = MAX_NAME;
  protected readonly maxPlan = MAX_PLAN_LABEL;
  protected readonly maxMeet = MAX_MEETUP;

  protected readonly view = signal<View>('loading');
  protected readonly doc = signal<GroupDoc | null>(null);
  protected readonly preview = signal<SharedTripPreview | null>(null);
  protected readonly busy = signal(false);
  protected readonly note = signal('');
  protected readonly confirmStop = signal(false);
  protected readonly name = signal('');
  protected readonly label = signal('');
  protected readonly arrival = signal('');
  protected readonly meet = signal('');

  private link: GroupLink | null = null;
  private version = 0;
  private expiresAt: string | null = null;
  private memberId = '';
  private loadedOnce = false;
  private lastPlan = '';

  protected readonly canWrite = computed(() => this.view() === 'ready' && !!this.link?.write);
  protected readonly owner = signal(false);
  protected readonly members = computed(() => { const d = this.doc(); return d ? memberList(d, this.memberId) : []; });
  protected readonly suggestions = computed(() => { const p = this.preview(); return p ? planLabelSuggestions(p.trip) : []; });

  constructor() {
    // Read the fragment now: the app rewrites the URL (and drops it) on its first navigation.
    const fragment = inject(ActivatedRoute).snapshot.fragment ?? inject(PlatformLocation).hash.replace(/^#/, '');
    const id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
    const rec = GROUP_ID_RE.test(id) ? this.groups.recordFor(id) : null;
    const fromUrl = parseGroupFragment(id, fragment);
    // A link in the URL wins; otherwise this device's copy of an earlier visit.
    this.link = fromUrl ?? (rec ? this.groups.linkOf(rec) : null);
    if (!this.link) {
      this.view.set('invalid');
      return;
    }
    this.memberId = rec?.memberId ?? this.groups.newMember();
    this.name.set(rec?.name ?? '');
    this.owner.set(rec?.owner === true && rec.key === this.link.key);
    void this.refresh();

    const destroyRef = inject(DestroyRef);
    // Every 2 minutes while the page is visible; and straight away when it becomes visible again.
    const timer = setInterval(() => { if (this.doc_.visibilityState !== 'hidden') void this.poll(); }, POLL_MS);
    const onVisible = () => { if (this.doc_.visibilityState === 'visible' && this.loadedOnce) void this.poll(); };
    this.doc_.addEventListener('visibilitychange', onVisible);
    destroyRef.onDestroy(() => { clearInterval(timer); this.doc_.removeEventListener('visibilitychange', onVisible); });
  }

  protected async refresh(): Promise<void> {
    if (!this.link) return;
    this.view.set(this.loadedOnce ? this.view() : 'loading');
    const r = await this.groups.load(this.link);
    if (!r.ok) {
      this.view.set(r.reason === 'gone' ? 'gone' : r.reason === 'invalid' ? 'invalid' : 'unavailable');
      return;
    }
    await this.apply(r.doc, r.version, r.expiresAt);
    if (!this.loadedOnce) {
      this.loadedOnce = true;
      const mine = r.doc.members[this.memberId];
      if (mine) { this.name.set(mine.name); this.label.set(mine.planLabel); this.arrival.set(toLocalInput(mine.arrival)); }
      this.meet.set(r.doc.meetup?.text ?? '');
      this.remember();
    }
    this.view.set('ready');
  }

  /** Background refresh: quiet on failure, and it never touches what is being typed. */
  private async poll(): Promise<void> {
    if (!this.link || this.busy()) return;
    const r = await this.groups.load(this.link);
    if (r.ok && r.version !== this.version) await this.apply(r.doc, r.version, r.expiresAt);
    else if (!r.ok && r.reason === 'gone') this.view.set('gone');
  }

  private async apply(doc: GroupDoc, version: number, expiresAt: string | null): Promise<void> {
    this.doc.set(doc);
    this.version = version;
    this.expiresAt = expiresAt;
    if (doc.plan !== this.lastPlan) {
      this.lastPlan = doc.plan;
      this.preview.set(await this.groups.previewOf(doc));
    }
  }

  private remember(): void {
    if (!this.link) return;
    const old = this.groups.recordFor(this.link.id);
    this.groups.remember({
      id: this.link.id, key: this.link.key, write: this.link.write ?? old?.write ?? null, memberId: this.memberId,
      name: this.name().trim().slice(0, MAX_NAME), owner: this.owner(), tripId: old?.tripId ?? null,
    });
  }

  protected async saveStatus(): Promise<void> {
    const d = this.doc();
    if (!this.link || !d || !this.name().trim()) return;
    this.busy.set(true);
    try {
      const now = Date.now();
      let next = this.groups.withMember(d, this.memberId, {
        name: this.name().trim().slice(0, MAX_NAME), planLabel: this.label().trim().slice(0, MAX_PLAN_LABEL), arrival: fromLocalInput(this.arrival()),
      }, now);
      const meet = this.meet().trim().slice(0, MAX_MEETUP);
      if (meet !== (d.meetup?.text ?? '')) next = { ...next, meetup: { text: meet, updatedAt: new Date(now).toISOString() } };
      const r = await this.groups.save(this.link, next, this.version);
      if (!r.ok) {
        this.note.set(MESSAGES[r.reason]);
        return;
      }
      await this.apply(r.doc, r.version, this.expiresAt);
      this.remember();
      this.note.set('Status updated');
    } finally {
      this.busy.set(false);
    }
  }

  protected async copyLink(viewOnly: boolean): Promise<void> {
    if (!this.link) return;
    const url = this.groups.urlOf(viewOnly ? { ...this.link, write: null } : this.link);
    const out = await shareOrCopy(this.doc_.defaultView, url, 'Group trip', 'Our group trip plan', false);
    this.state.flash(out === 'copied' ? (viewOnly ? 'View-only link copied' : 'Link copied') : 'Could not copy the link');
  }

  protected saveCopy(): void {
    const p = this.preview();
    if (!p) return;
    const trip = this.groups.saveCopy(p);
    this.state.flash(`Saved ${trip.name} to your trips`);
    void this.router.navigate(tripPath(trip.id), { queryParams: this.state.globalParams() });
  }

  protected async stop(): Promise<void> {
    if (!this.link) return;
    this.busy.set(true);
    try {
      if (!(await this.groups.stop(this.link))) {
        this.note.set(MESSAGES.unavailable);
        return;
      }
      this.groups.forget(this.link.id);
      this.state.flash('Stopped sharing. The group was deleted.');
      void this.router.navigate(tripsPath(), { queryParams: this.state.globalParams(), replaceUrl: true });
    } finally {
      this.busy.set(false);
    }
  }

  protected back(): void {
    void this.router.navigate(tripsPath(), { queryParams: this.state.globalParams() });
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }
}

/** ISO instant -> the value of a datetime-local input in the device's time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
