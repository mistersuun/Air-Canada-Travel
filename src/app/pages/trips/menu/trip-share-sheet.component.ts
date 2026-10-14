import { ChangeDetectionStrategy, Component, DOCUMENT, effect, inject, input, output, signal, untracked } from '@angular/core';
import { AppStateService } from '../../../state/app-state.service';
import type { Trip } from '../../../trips/model';
import { TripsService } from '../../../trips/trips.service';
import { GlassSheetComponent } from '../../../ui/glass-sheet.component';
import { GroupSectionComponent } from '../../../group/ui/group-section.component';
import { ShareEntryComponent } from '../../../share/ui/share-entry.component';

const TOO_LARGE = 'This trip is too large to share as a link · use Export trips in Settings';

/**
 * The one Share sheet. Three labelled choices, each saying exactly what it
 * shares: the live group plan (everyone can update it, end-to-end encrypted;
 * edit and view-only links), a snapshot link (read-only copy that includes
 * your notes) and an image or text.
 */
@Component({
  selector: 'app-trip-share-sheet',
  standalone: true,
  imports: [GlassSheetComponent, GroupSectionComponent, ShareEntryComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-glass-sheet [title]="'Share ' + trip().name" [open]="true" (closed)="closed.emit()">
      <div class="ts">
        <app-group-section [trip]="trip()" [startOpen]="startGroup()" />

        <section class="grp" data-share>
          <div>
            <h3 class="ui-h3">Snapshot link</h3>
            <p class="ui-sub" data-snapshot-desc>A read-only copy that does not update. Includes your notes on legs, "If we split up" and your load notes, so only send it to people you trust with them. Changes need a new link.</p>
          </div>
          <label class="split">
            <span class="ui-label">If we split up (in the snapshot only)</span>
            <textarea rows="2" maxlength="400" placeholder="Where you meet, who books the room…" data-split
                      [value]="trip().party.splitNote" (change)="saveSplit($any($event.target).value)"></textarea>
          </label>
          <button type="button" class="ui-btn ui-btn--sm ui-btn--dark ts__copy" data-copy (click)="copyLink()" [disabled]="busy()">Copy snapshot link</button>
        </section>

        <section class="grp" data-share-image>
          <div>
            <h3 class="ui-h3">Image or text</h3>
            <p class="ui-sub">A picture or plain text of the plan, to post or message. Shows flights and times, and "If we split up" only if you choose to. Never your leg notes.</p>
          </div>
          <app-share-entry [trip]="trip()" />
        </section>
      </div>
    </app-glass-sheet>
  `,
  styles: [`
    .ts { display: grid; gap: 14px; }
    .grp { display: grid; gap: 12px; padding: 14px 16px; border-radius: 18px; background: var(--fill); }
    .grp .ui-sub { margin-top: 2px; }
    .split { display: grid; gap: 4px; background: var(--surface); border-radius: 14px; padding: 10px 12px; }
    .split textarea {
      border: 0; background: none; resize: vertical; min-height: 44px; color: var(--ink);
      font: 400 14px/1.45 var(--sans); padding: 0; outline: none;
    }
    .split:focus-within { box-shadow: 0 0 0 2px var(--blue); }
    .ts__copy { min-height: 44px; }
  `],
})
export class TripShareSheetComponent {
  private readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  private readonly doc = inject(DOCUMENT);

  readonly trip = input.required<Trip>();
  /** Open the live group section on its nickname field. */
  readonly startGroup = input(false);
  readonly closed = output<void>();

  protected readonly busy = signal(false);

  /**
   * The snapshot link, built when the sheet opens (and again when the trip changes) so that
   * Copy can call navigator.share / clipboard.writeText inside the tap itself: after an
   * await some browsers (Safari, iOS) no longer treat the call as a user gesture.
   */
  private readonly link = signal<{ url: string } | 'too-large' | null>(null);
  private building: Promise<void> = Promise.resolve();
  private buildSeq = 0;

  constructor() {
    effect(() => {
      this.trip();
      untracked(() => { this.building = this.buildLink(); });
    });
  }

  protected saveSplit(text: string): void {
    const splitNote = text.trim().slice(0, 400);
    if (splitNote === this.trip().party.splitNote) return;
    this.trips.update(this.trip().id, t => ({ ...t, party: { ...t.party, splitNote } }));
  }

  private async buildLink(): Promise<void> {
    const seq = ++this.buildSeq;
    // The previous link stays until the new one resolves, so a tap during a rebuild still shares synchronously.
    let next: { url: string } | 'too-large' | null;
    try {
      const url = await this.trips.shareLink(this.trip().id);
      next = url ? { url } : null;
    } catch {
      next = 'too-large';
    }
    // A newer build (the trip changed meanwhile) owns the signal.
    if (seq === this.buildSeq) this.link.set(next);
  }

  protected copyLink(): Promise<void> {
    const ready = this.link();
    if (ready === 'too-large') {
      this.state.flash(TOO_LARGE);
      return Promise.resolve();
    }
    // Normal case: the link is ready, so share/copy start synchronously inside the tap.
    if (ready) return this.deliver(ready.url);
    const nav = this.doc.defaultView?.navigator;
    const win = this.doc.defaultView as (Window & { ClipboardItem?: typeof ClipboardItem }) | null;
    if (!nav?.share && nav?.clipboard?.write && win?.ClipboardItem) {
      // Not built yet: a clipboard item can take the link as a promise and still count as the tap.
      const text = this.building.then(() => {
        const l = this.link();
        if (!l || l === 'too-large') throw new Error('no link');
        return new Blob([l.url], { type: 'text/plain' });
      });
      return this.busyWhile(async () => {
        try {
          await nav.clipboard.write([new win.ClipboardItem!({ 'text/plain': text })]);
          this.state.flash('Link copied');
        } catch {
          this.state.flash(this.link() === 'too-large' ? TOO_LARGE : 'Could not copy the link');
        }
      });
    }
    return this.busyWhile(async () => {
      await this.building;
      const l = this.link();
      if (l === 'too-large') this.state.flash(TOO_LARGE);
      else if (l) await this.deliver(l.url);
    });
  }

  private async busyWhile(run: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await run();
    } finally {
      this.busy.set(false);
    }
  }

  /** navigator.share when there is one, else the clipboard. The first call happens before any await. */
  private deliver(url: string): Promise<void> {
    const nav = this.doc.defaultView?.navigator;
    return this.busyWhile(async () => {
      if (nav?.share) {
        try {
          await nav.share({ title: this.trip().name, text: `${this.trip().name}: our standby plan`, url });
          return;
        } catch (e) {
          if ((e as DOMException)?.name === 'AbortError') return;
        }
      }
      try {
        if (!nav?.clipboard) throw new Error('no clipboard');
        await nav.clipboard.writeText(url);
        this.state.flash('Link copied');
      } catch {
        this.state.flash('Could not copy the link');
      }
    });
  }
}
