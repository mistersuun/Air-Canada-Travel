import { ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, computed, inject, signal } from '@angular/core';
import { PlatformLocation } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MsgKey, t } from '../../i18n/t';
import { intlLocale } from '../../i18n/locale';
import { IconComponent } from '../../components/shared/icons.component';
import { GROUP_ID_RE, type GroupLink, parseGroupFragment } from '../../group/group-crypto';
import {
  type GroupDoc, MAX_MEETUP, MAX_NAME, MAX_PLAN_LABEL, MEMBER_LEG_STATUSES, everyoneBoarded, friendsOnLeg, groupIsFull, memberList, planLabelSuggestions,
} from '../../group/group-doc';
import { GroupService, POLL_MS, type GroupFailure, type GroupRecord } from '../../group/group.service';
import { shareOrCopy } from '../../group/share-link';
import { AppStateService } from '../../state/app-state.service';
import { AvatarChipComponent } from '../../group/ui/avatar-chip.component';
import { type FlightLeg, type LegStatus, type SharedTripPreview } from '../../trips/model';
import { tripPath, tripsPath } from '../../ui/links';
import { toUtcMs, utcToLocal } from '../../utils/time';
import { dayLabel } from '../trips/trips-model';
import { TripCardComponent } from '../trips/plan/trip-card.component';

type View = 'loading' | 'invalid' | 'unavailable' | 'gone' | 'ready';

const MESSAGES: Record<GroupFailure, MsgKey> = {
  unavailable: 'group.section.offline',
  gone: 'group.err.gone',
  invalid: 'group.err.invalid',
  forbidden: 'group.err.forbidden',
  'too-large': 'group.err.tooLarge',
  budget: 'group.section.budget',
};
const FULL: MsgKey = 'group.err.full';
const LEG_KEYS: Partial<Record<LegStatus, MsgKey>> = {
  planned: 'group.status.planned', listed: 'group.status.listed', checkedIn: 'group.status.checkedIn',
  boarded: 'group.status.boarded', notBoarded: 'group.status.notBoarded',
};
const CONFETTI_KEY = 'ac.group.confetti.v1';
const CONFETTI_MS = 2600;
/** The burst: 22 pieces fanned out radially (golden angle, three rings), each with its own end point and delay. */
const PIECES = Array.from({ length: 22 }, (_, i) => {
  const a = (i * 137.5 * Math.PI) / 180;
  const r = 70 + (i % 3) * 45;
  return { i, dx: Math.round(Math.cos(a) * r), dy: Math.round(Math.sin(a) * r) };
});

/**
 * A group trip (/g/:id#k=<key>[&w=<token>]). The plan and every member's status
 * are decrypted here; the server holds only ciphertext. The key is read from the
 * fragment once (the router then drops it) and kept on this device.
 */
@Component({
  selector: 'app-group-page',
  standalone: true,
  imports: [RouterLink, IconComponent, TripCardComponent, AvatarChipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare gp">
      <header class="gp__head">
        <button type="button" class="ui-circ ui-circ--glass" [attr.aria-label]="t('group.back')" (click)="back()"><app-icon name="arrow-left" [size]="18" /></button>
        <h1 class="ui-h3">{{ t('group.title') }}</h1>
        <span class="gp__sp" aria-hidden="true"></span>
      </header>

      @switch (view()) {
        @case ('loading') { <p class="ui-sub gp__msg" role="status">{{ t('group.opening') }}</p> }
        @case ('ready') {
          @if (preview(); as p) {
            <p class="ui-label gp__lbl" data-group-label>{{ t('group.sharedPlan') }}</p>
            <app-trip-card [trip]="p.trip" mode="static" />
            @if (p.trip.party.splitNote) {
              <div class="ui-card gp__box"><div class="ui-label">{{ t('group.split') }}</div><p>{{ p.trip.party.splitNote }}</p></div>
            }
          }

          @if (flights().length) {
            <section class="ui-card gp__box" data-legs>
              <h2 class="ui-h3">{{ t('group.whichFlight') }}</h2>
              <ul class="gp__list">
                @for (f of flights(); track f.id) {
                  <li data-leg [attr.data-leg-id]="f.id">
                    <b>{{ f.label }}</b>
                    <span>{{ f.when }}</span>
                    @if (f.friends.length) {
                      <span class="gp__av">
                        @for (fr of f.friends; track fr.id) { <app-avatar-chip [name]="fr.name" [status]="fr.status" /> }
                      </span>
                    }
                  </li>
                }
              </ul>
            </section>
          }

          <section class="ui-card gp__box" data-members>
            <h2 class="ui-h3">{{ t('group.whoWhere') }}</h2>
            @if (members().length) {
              <ul class="gp__list">
                @for (m of members(); track m.id) {
                  <li data-member>
                    <b class="gp__who"><app-avatar-chip [name]="m.status.name" [showName]="false" />{{ m.status.name }}{{ m.me ? ' ' + t('group.you') : '' }}</b>
                    <span>{{ m.status.planLabel || t('group.noPlan') }}</span>
                    @if (m.status.arrival) { <span class="gp__when">{{ t('group.arrives', { when: when(m.status.arrival) }) }}</span> }
                  </li>
                }
              </ul>
            } @else {
              <p class="ui-sub">{{ t('group.nobody') }}</p>
            }
            @if (doc()?.meetup?.text; as mt) { <p class="gp__meet" data-meetup><span class="ui-label">{{ t('group.meetUp') }}</span> {{ mt }}</p> }
          </section>

          @if (canWrite()) {
            <section class="ui-card gp__box" data-mine>
              <h2 class="ui-h3">{{ t('group.yourStatus') }}</h2>
              <label class="gp__f"><span class="ui-label">{{ t('group.nickname') }}</span>
                <input type="text" [maxLength]="maxName" autocomplete="off" data-name [value]="name()" (input)="name.set($any($event.target).value)" /></label>
              <label class="gp__f"><span class="ui-label">{{ t('group.yourPlan') }}</span>
                <input type="text" [maxLength]="maxPlan" autocomplete="off" [attr.placeholder]="t('group.planPlaceholder')" data-plan-label [value]="label()" (input)="label.set($any($event.target).value)" /></label>
              @if (suggestions().length) {
                <div class="gp__chips">
                  @for (s of suggestions(); track s) { <button type="button" class="gp__chip" (click)="label.set(s)">{{ s }}</button> }
                </div>
              }
              @for (f of flights(); track f.id) {
                <label class="gp__f"><span class="ui-label">{{ f.label }}</span>
                  <select data-leg-status [attr.data-leg-id]="f.id" (change)="setLegStatus(f.id, $any($event.target).value)">
                    <option value="" [selected]="!mine()[f.id]">{{ t('group.notSet') }}</option>
                    @for (o of legOptions(); track o.value) { <option [value]="o.value" [selected]="mine()[f.id] === o.value">{{ o.label }}</option> }
                  </select></label>
              }
              <label class="gp__f"><span class="ui-label" data-arrival-label>{{ t('group.arrival', { zone: zoneLabel() }) }}</span>
                <input type="datetime-local" data-arrival [value]="arrival()" (input)="arrival.set($any($event.target).value)" /></label>
              <label class="gp__f"><span class="ui-label">{{ t('group.meetPoint') }}</span>
                <input type="text" [maxLength]="maxMeet" autocomplete="off" [attr.placeholder]="t('group.meetPlaceholder')" data-meetup-input [value]="meet()" (input)="editMeet($any($event.target).value)" /></label>
              <button type="button" class="ui-btn" data-save-status [disabled]="busy() || !name().trim()" (click)="saveStatus()">{{ t('group.update') }}</button>
            </section>
          } @else {
            <p class="ui-sub gp__fine" data-view-only>{{ t('group.viewOnly') }}</p>
          }

          <div class="gp__acts">
            <button type="button" class="ui-btn ui-btn--ghost" data-copy-link (click)="copyLink(false)">{{ t('group.copyLink') }}</button>
            <button type="button" class="ui-btn" data-save-copy (click)="saveCopy()">{{ t('group.saveCopy') }}</button>
          </div>
          @if (canWrite()) {
            <button type="button" class="gp__link" data-copy-view (click)="copyLink(true)">{{ t('group.copyViewLink') }}</button>
          }
          @if (owner()) {
            @if (confirmStop()) {
              <div class="ui-card gp__box"><p>{{ t('group.stopText') }}</p>
                <div class="gp__acts"><button type="button" class="ui-btn ui-btn--ghost" (click)="confirmStop.set(false)">{{ t('group.keep') }}</button>
                  <button type="button" class="ui-btn ui-btn--dark" data-stop-confirm [disabled]="busy()" (click)="stop()">{{ t('group.stop') }}</button></div></div>
            } @else {
              <button type="button" class="gp__del" data-stop (click)="confirmStop.set(true)">{{ t('group.stop') }}</button>
            }
          }
          @if (note()) { <p class="ui-sub gp__fine" role="status" data-note>{{ note() }}</p> }
        }
        @default {
          <div class="ui-card gp__bad" data-group-problem>
            <h2 class="ui-h3">{{ view() === 'unavailable' ? t('group.bad.offlineTitle') : view() === 'gone' ? t('group.bad.goneTitle') : t('group.bad.invalidTitle') }}</h2>
            <p class="ui-sub">{{ view() === 'unavailable' ? t('group.bad.offlineText') : view() === 'gone' ? t('group.bad.goneText') : t('group.bad.invalidText') }}</p>
            @if (view() === 'unavailable') { <button type="button" class="ui-btn ui-btn--ghost" (click)="refresh()">{{ t('group.bad.retry') }}</button> }
            <a class="ui-btn ui-btn--dark" [routerLink]="tripsPath()" [queryParams]="state.globalParams()">{{ t('group.bad.goTrips') }}</a>
          </div>
        }
      }

      @if (burst()) {
        <div class="gp__confetti" aria-hidden="true" data-confetti>
          @for (p of pieces; track p.i) { <i [style.--i]="p.i" [style.--dx.px]="p.dx" [style.--dy.px]="p.dy"></i> }
        </div>
      }
      <p class="ui-sub gp__fine" data-pass-rules>{{ t('group.passRules') }}</p>
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
    .gp__who { display: inline-flex; align-items: center; gap: 8px; }
    .gp__av { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
    .gp__f select { border: 0; background: none; color: var(--ink); font: 400 15px/1.4 var(--sans); padding: 0; outline: none; min-height: 28px; }
    .gp__confetti { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 60; }
    .gp__confetti i {
      position: absolute; left: 50%; top: 38%; width: 8px; height: 12px; border-radius: 2px;
      background: hsl(calc(var(--i) * 47), 70%, 55%);
      animation: gp-burst 1.9s cubic-bezier(.16,.8,.3,1) calc(var(--i) * 18ms) both;
    }
    @keyframes gp-burst {
      0% { transform: translate(0, 0) rotate(0); opacity: 1; }
      70% { opacity: 1; }
      100% { transform: translate(var(--dx), calc(var(--dy) + 36px)) rotate(calc(var(--i) * 83deg)); opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) { .gp__confetti { display: none; } }
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
  protected readonly t = t;
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
  /** My status on each flight leg, by leg id. */
  protected readonly mine = signal<Record<string, LegStatus>>({});
  protected readonly burst = signal(false);
  protected readonly pieces = PIECES;
  protected readonly legOptions = computed(() => MEMBER_LEG_STATUSES.map(value => ({ value, label: t(LEG_KEYS[value] ?? 'group.status.planned') })));

  private link: GroupLink | null = null;
  private version = 0;
  private expiresAt: string | null = null;
  private memberId = '';
  /** Only on the device that created the group: needed to stop it and to lengthen its life. */
  private ownerToken: string | null = null;
  /** True once this device holds a record for the group (from an earlier visit or from remember()). */
  private remembered = false;
  private loadedOnce = false;
  /** True once the meet-up field was edited since the last sync: only then is it written back. */
  private meetDirty = false;
  private lastPlan = '';
  private burstTimer: ReturnType<typeof setTimeout> | null = null;
  /** Legs celebrated during this visit, so blocked storage cannot make every poll burst again. */
  private readonly celebrated = new Set<string>();
  /** My leg statuses as last saved or loaded; kept in this device's record (see MemberStatus.legs). */
  private savedLegs: Record<string, LegStatus> = {};
  private restoring = false;

  protected readonly canWrite = computed(() => this.view() === 'ready' && !!this.link?.write);
  protected readonly owner = signal(false);
  protected readonly members = computed(() => { const d = this.doc(); return d ? memberList(d, this.memberId) : []; });
  /** The trip's destination zone: arrival times are entered and shown there. Null when the plan does not say. */
  protected readonly tz = computed(() => { const z = this.preview()?.trip.goal.tz ?? null; return z && validZone(z) ? z : null; });
  protected readonly zoneLabel = computed(() => {
    const p = this.preview();
    return this.tz() && p ? t('group.zoneTime', { city: p.trip.goal.name }) : t('group.deviceTime');
  });
  protected readonly flights = computed(() => {
    const p = this.preview();
    const d = this.doc();
    if (!p) return [];
    return p.trip.legs.filter((l): l is FlightLeg => l.kind === 'flight' && l.refs.length > 0).map(l => ({
      id: l.id,
      label: t('group.flightLabel', { flights: l.refs.map(r => r.flightNumber).join(' + '), from: l.refs[0].origin, to: l.refs[l.refs.length - 1].dest }),
      when: `${dayLabel(l.refs[0].dateKey)} · ${l.refs[0].depLocal}`,
      friends: d ? friendsOnLeg(d, l.id, this.memberId) : [],
    }));
  });
  protected readonly suggestions = computed(() => { const p = this.preview(); return p ? planLabelSuggestions(p.trip) : []; });

  constructor() {
    // Read the fragment now: the app rewrites the URL (and drops it) on its first navigation.
    const fragment = inject(ActivatedRoute).snapshot.fragment ?? inject(PlatformLocation).hash.replace(/^#/, '');
    const id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
    const rec = GROUP_ID_RE.test(id) ? this.groups.recordFor(id) : null;
    const fromUrl = parseGroupFragment(id, fragment);
    // A link in the URL wins; otherwise this device's copy of an earlier visit.
    this.link = fromUrl ?? (rec ? this.groups.linkOf(rec) : null);
    // The key is now in memory (and on this device): take it out of the address bar and history.
    if (fromUrl) { try { history.replaceState(history.state, '', location.pathname + location.search); } catch { /* not critical */ } }
    if (!this.link) {
      this.view.set('invalid');
      return;
    }
    this.remembered = !!rec;
    this.savedLegs = { ...(rec?.myLegs ?? {}) };
    this.memberId = rec?.memberId ?? this.groups.newMember();
    this.name.set(rec?.name ?? '');
    this.owner.set(rec?.owner === true && rec.key === this.link.key);
    this.ownerToken = this.owner() ? (rec?.ownerToken ?? null) : null;
    void this.refresh();

    const destroyRef = inject(DestroyRef);
    // Every 2 minutes while the page is visible; and straight away when it becomes visible again.
    const timer = setInterval(() => { if (this.doc_.visibilityState !== 'hidden') void this.poll(); }, POLL_MS);
    const onVisible = () => { if (this.doc_.visibilityState === 'visible' && this.loadedOnce) void this.poll(); };
    this.doc_.addEventListener('visibilitychange', onVisible);
    destroyRef.onDestroy(() => { clearInterval(timer); if (this.burstTimer) clearTimeout(this.burstTimer); this.doc_.removeEventListener('visibilitychange', onVisible); });
  }

  protected async refresh(): Promise<void> {
    if (!this.link) return;
    this.view.set(this.loadedOnce ? this.view() : 'loading');
    const r = await this.groups.load(this.link);
    if (!r.ok) {
      // Offline right now: keep the link on this device, since the address bar no longer has it.
      if (r.reason === 'unavailable') this.remember();
      this.view.set(r.reason === 'gone' ? 'gone' : r.reason === 'invalid' ? 'invalid' : 'unavailable');
      return;
    }
    await this.apply(r.doc, r.version, r.expiresAt);
    if (!this.loadedOnce) {
      this.loadedOnce = true;
      const mine = r.doc.members[this.memberId];
      if (mine) { this.name.set(mine.name); this.label.set(mine.planLabel); this.arrival.set(toLocalInput(mine.arrival, this.tz())); this.savedLegs = { ...(mine.legs ?? this.savedLegs) }; this.mine.set({ ...this.savedLegs }); }
      this.remember();
      await this.extendLife();
    }
    this.view.set('ready');
  }

  /** The owner opening the group: lengthen its life when the trip now ends well after it. Quiet on failure. */
  private async extendLife(): Promise<void> {
    const d = this.doc();
    if (!this.link?.write || !this.owner() || !d) return;
    const expiresAt = this.groups.ownerExpiry(this.groups.recordFor(this.link.id), this.expiresAt);
    if (!expiresAt) return;
    const r = await this.groups.save(this.link, d, this.version, expiresAt, this.ownerToken);
    if (r.ok) {
      await this.apply(r.doc, r.version, r.expiresAt ?? this.expiresAt);
      this.remember();
    }
  }

  /** Background refresh: quiet on failure, and it never touches what is being typed. */
  private async poll(): Promise<void> {
    if (!this.link || this.busy()) return;
    const r = await this.groups.load(this.link);
    if (r.ok && r.version > this.version) await this.apply(r.doc, r.version, r.expiresAt);
    else if (!r.ok && r.reason === 'gone') this.view.set('gone');
  }

  private async apply(doc: GroupDoc, version: number, expiresAt: string | null): Promise<void> {
    this.doc.set(doc);
    this.version = version;
    this.expiresAt = expiresAt;
    // What others set shows up unless I am in the middle of editing it.
    if (!this.meetDirty) this.meet.set(doc.meetup?.text ?? '');
    if (doc.plan !== this.lastPlan) {
      this.lastPlan = doc.plan;
      this.preview.set(await this.groups.previewOf(doc));
    }
    this.maybeCelebrate(doc);
    void this.restoreLegs(doc);
  }

  /** An older client saved my entry without my leg statuses: quietly write them back from this device's copy. */
  private async restoreLegs(doc: GroupDoc): Promise<void> {
    const mine = doc.members[this.memberId];
    if (!this.link?.write || this.restoring || this.busy() || !mine || mine.legs || !Object.keys(this.savedLegs).length) return;
    this.restoring = true;
    try {
      const next = this.groups.withMember(doc, this.memberId, { name: mine.name, legs: this.currentLegs(this.savedLegs) });
      const r = await this.groups.save(this.link, next, this.version);
      if (r.ok) await this.apply(r.doc, r.version, r.expiresAt ?? this.expiresAt);
    } finally {
      this.restoring = false;
    }
  }

  /** Only statuses for legs the plan still has. */
  private currentLegs(legs: Record<string, LegStatus>): Record<string, LegStatus> {
    const ids = new Set(this.flights().map(f => f.id));
    return Object.fromEntries(Object.entries(legs).filter(([id]) => ids.has(id)));
  }

  /** A short burst when everyone in the group has boarded a leg; once per leg on this device. */
  private maybeCelebrate(doc: GroupDoc): void {
    const p = this.preview();
    if (!p || !this.link) return;
    const done = readCelebrated();
    for (const l of p.trip.legs) {
      const key = `${this.link.id}:${l.id}`;
      if (l.kind !== 'flight' || done.includes(key) || this.celebrated.has(key) || !everyoneBoarded(doc, l.id)) continue;
      this.celebrated.add(key);
      writeCelebrated([...done, key].slice(-200));
      if (reducedMotion()) return;
      this.burst.set(true);
      if (this.burstTimer) clearTimeout(this.burstTimer);
      this.burstTimer = setTimeout(() => this.burst.set(false), CONFETTI_MS);
      return;
    }
  }

  protected setLegStatus(legId: string, value: string): void {
    this.mine.update(m => {
      const { [legId]: _old, ...rest } = m;
      return (MEMBER_LEG_STATUSES as readonly string[]).includes(value) ? { ...rest, [legId]: value as LegStatus } : rest;
    });
  }

  /** Nicknames of the group (me first), kept for the little avatars on the trip card. */
  private nicknames(): string[] | undefined {
    const d = this.doc();
    return d ? memberList(d, this.memberId).map(m => m.status.name).slice(0, 6) : undefined;
  }

  private remember(): void {
    if (!this.link) return;
    const old = this.groups.recordFor(this.link.id);
    const rec: GroupRecord = {
      id: this.link.id, key: this.link.key, write: this.link.write ?? old?.write ?? null, memberId: this.memberId,
      name: this.name().trim().slice(0, MAX_NAME), owner: this.owner(), ownerToken: this.ownerToken ?? old?.ownerToken ?? null, tripId: old?.tripId ?? null, expiresAt: this.expiresAt ?? old?.expiresAt ?? null,
      names: this.nicknames() ?? old?.names, myLegs: Object.keys(this.savedLegs).length ? this.savedLegs : undefined,
    };
    // Once this device has the group, only update it: if another tab stopped or forgot it, do not bring it back.
    if (this.remembered) this.groups.update(rec);
    else {
      this.groups.remember(rec);
      this.remembered = true;
    }
  }

  protected async saveStatus(): Promise<void> {
    const d = this.doc();
    if (!this.link || !d || !this.name().trim()) return;
    if (groupIsFull(d, this.memberId)) {
      this.note.set(t(FULL));
      return;
    }
    this.busy.set(true);
    try {
      const now = Date.now();
      let next = this.groups.withMember(d, this.memberId, {
        name: this.name().trim().slice(0, MAX_NAME), planLabel: this.label().trim().slice(0, MAX_PLAN_LABEL), arrival: fromLocalInput(this.arrival(), this.tz()), legs: this.currentLegs(this.mine()),
      }, now);
      const meet = this.meet().trim().slice(0, MAX_MEETUP);
      if (this.meetDirty && meet !== (d.meetup?.text ?? '')) next = { ...next, meetup: { text: meet, updatedAt: new Date(now).toISOString() } };
      const expiresAt = this.owner() ? this.groups.ownerExpiry(this.groups.recordFor(this.link.id), this.expiresAt) : undefined;
      const r = await this.groups.save(this.link, next, this.version, expiresAt, this.ownerToken);
      if (!r.ok) {
        this.note.set(t(MESSAGES[r.reason]));
        return;
      }
      this.meetDirty = false;
      this.savedLegs = this.currentLegs(this.mine());
      await this.apply(r.doc, r.version, r.expiresAt ?? this.expiresAt);
      this.remember();
      this.note.set(t('group.updated'));
    } finally {
      this.busy.set(false);
    }
  }

  protected editMeet(v: string): void {
    this.meetDirty = true;
    this.meet.set(v);
  }

  protected async copyLink(viewOnly: boolean): Promise<void> {
    if (!this.link) return;
    const url = this.groups.urlOf(viewOnly ? { ...this.link, write: null } : this.link);
    const out = await shareOrCopy(this.doc_.defaultView, url, t('group.title'), t('group.shareText'), false);
    this.state.flash(t(out === 'copied' ? (viewOnly ? 'group.viewCopied' : 'group.linkCopied') : 'group.copyFailed'));
  }

  protected saveCopy(): void {
    const p = this.preview();
    if (!p) return;
    const trip = this.groups.saveCopy(p);
    this.state.flash(t('group.saved', { name: trip.name }));
    void this.router.navigate(tripPath(trip.id), { queryParams: this.state.globalParams() });
  }

  protected async stop(): Promise<void> {
    if (!this.link) return;
    this.busy.set(true);
    try {
      if (!(await this.groups.stop(this.link, this.ownerToken))) {
        this.note.set(MESSAGES.unavailable);
        return;
      }
      this.groups.forget(this.link.id);
      this.state.flash(t('group.stopped'));
      void this.router.navigate(tripsPath(), { queryParams: this.state.globalParams(), replaceUrl: true });
    } finally {
      this.busy.set(false);
    }
  }

  protected back(): void {
    void this.router.navigate(tripsPath(), { queryParams: this.state.globalParams() });
  }

  protected when(iso: string): string {
    const opts: Intl.DateTimeFormatOptions = { weekday: 'short', hour: 'numeric', minute: '2-digit' };
    const tz = this.tz();
    if (tz) {
      try { return new Date(iso).toLocaleString(intlLocale(), { ...opts, timeZone: tz, timeZoneName: 'short' }); } catch { /* unknown zone: device time */ }
    }
    return new Date(iso).toLocaleString(intlLocale(), opts);
  }
}

/** ISO instant -> the value of a datetime-local input, read in `tz` (the destination) or, without one, the device's zone. */
export function toLocalInput(iso: string | null, tz: string | null = null): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  if (tz) {
    try {
      const l = utcToLocal(ms, tz);
      return `${l.dateKey}T${l.hhmm}`;
    } catch { /* unknown zone: device time */ }
  }
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The value of a datetime-local input, typed as wall-clock time in `tz` (or the device's zone), -> ISO instant. */
export function fromLocalInput(v: string, tz: string | null = null): string | null {
  if (!v) return null;
  if (tz) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(v);
    if (m) {
      try { return new Date(toUtcMs(m[1], m[2], tz)).toISOString(); } catch { /* unknown zone: device time */ }
    }
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function validZone(tz: string): boolean {
  try { new Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; }
}

function readCelebrated(): string[] {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(CONFETTI_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeCelebrated(keys: string[]): void {
  try { globalThis.localStorage?.setItem(CONFETTI_KEY, JSON.stringify(keys)); } catch { /* storage blocked: it may celebrate again */ }
}

function reducedMotion(): boolean {
  try { return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; } catch { return false; }
}
