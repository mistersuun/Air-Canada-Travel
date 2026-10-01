import { ChangeDetectionStrategy, Component, DOCUMENT, EnvironmentInjector, afterNextRender, computed, inject, input } from '@angular/core';
import { AppStateService } from '../../state/app-state.service';
import { formatKey } from '../../utils/time';
import type { OutcomePrompt } from '../engine/today';
import { OUTCOME_LABEL, OutcomeKind, instanceKey } from '../model';
import { TripsService } from '../trips.service';

export interface OutcomeChoice { kind: OutcomeKind; label: string; primary: boolean }

/** The answers offered: "Some of us" only when more than one person travels. */
export function outcomeChoices(partySize: number): OutcomeChoice[] {
  const solo = partySize <= 1;
  const kinds: OutcomeKind[] = solo ? ['allBoarded', 'noneBoarded', 'didntTry'] : ['allBoarded', 'someBoarded', 'noneBoarded', 'didntTry'];
  return kinds.map(kind => ({
    kind,
    label: solo && kind === 'allBoarded' ? 'I boarded' : OUTCOME_LABEL[kind],
    primary: kind === 'allBoarded',
  }));
}

/** 'AC864 · Fri Oct 9 · YUL → LHR'. */
export function outcomeHeading(p: OutcomePrompt): string {
  const day = formatKey(p.ref.dateKey, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  return `${p.ref.flightNumber} · ${day} · ${p.ref.origin} → ${p.ref.dest}`;
}

/**
 * "How did it go?" (mockup g6), asked once a flight left over 30 min ago.
 * Recording sets the trip leg's status (TripsService.recordOutcome) and the
 * card goes away; Undo puts both back (focus moves to the toast's Undo, since
 * the focused card is removed). "Skip this flight" dismisses it for good.
 * History shows counts, never percentages.
 */
@Component({
  selector: 'app-outcome-prompt',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ui-card op" [attr.aria-labelledby]="hid()" data-outcome-prompt>
      <p class="ui-label op__k tn">{{ heading() }}</p>
      <h2 class="ui-h3 op__h" [id]="hid()">How did it go?</h2>
      <div class="op__g" [class.op__g--3]="choices().length === 3">
        @for (c of choices(); track c.kind) {
          <button type="button" class="ui-btn op__b" [class.ui-btn--dark]="c.primary" [class.ui-btn--ghost]="!c.primary"
                  [attr.data-kind]="c.kind" (click)="record(c.kind)">{{ c.label }}</button>
        }
      </div>
      <button type="button" class="ui-link op__skip" data-skip (click)="skip()">Skip this flight</button>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .op { padding: 16px; text-align: center; display: grid; justify-items: stretch; }
    .op__k { margin: 0; line-height: 1.4; }
    .op__h { margin: 4px 0 0; }
    .op__g { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
    .op__g--3 > :last-child { grid-column: 1 / -1; }
    .op__b { min-height: 48px; padding: 10px 12px; font-size: 14px; white-space: normal; }
    .op__skip { justify-self: center; margin-top: 6px; min-height: 40px; padding: 0 12px; font-size: 13px; color: var(--ink-2); }
  `],
})
export class OutcomePromptComponent {
  protected readonly trips = inject(TripsService);
  private readonly state = inject(AppStateService);
  private readonly doc = inject(DOCUMENT);
  /** Outlives this card, which is removed as soon as an answer is saved. */
  private readonly env = inject(EnvironmentInjector);

  readonly prompt = input.required<OutcomePrompt>();

  protected readonly heading = computed(() => outcomeHeading(this.prompt()));
  protected readonly choices = computed(() => outcomeChoices(this.prompt().partySize));
  protected readonly hid = computed(() => `op-${this.prompt().key.replace(/[^A-Za-z0-9-]/g, '-')}`);

  protected record(kind: OutcomeKind): void {
    const p = this.prompt();
    const trip = p.tripId ? this.trips.trip(p.tripId) : null;
    const leg = trip?.legs.find(l => l.id === p.legId) ?? null;
    const before = leg ? { tripId: trip!.id, legId: leg.id, status: leg.status } : null;
    this.trips.recordOutcome({
      flightNumber: p.ref.flightNumber, origin: p.ref.origin, dest: p.ref.dest, dateKey: p.ref.dateKey,
      kind, partySize: p.partySize, tripId: p.tripId, note: '',
    });
    const key = instanceKey(p.ref);
    const saved = this.trips.outcomes().find(o => instanceKey(o) === key && o.tripId === p.tripId);
    this.state.flash(`${p.ref.flightNumber}: ${OUTCOME_LABEL[kind]} · saved`, {
      label: 'Undo',
      run: () => {
        if (saved) this.trips.removeOutcome(saved.id);
        if (before) this.trips.setLegStatus(before.tripId, before.legId, before.status);
      },
    });
    this.refocus('.toast__action');
  }

  protected skip(): void {
    this.trips.dismissOutcome(this.prompt().key);
    this.refocus('[data-outcome-prompt] button, main h1, h1');
  }

  /** The focused card is about to be removed: move focus somewhere stable once it is gone. */
  private refocus(selector: string): void {
    afterNextRender(() => {
      const el = this.doc.querySelector<HTMLElement>(selector);
      if (!el) return;
      if (!el.matches('button, a, input, [tabindex]')) el.setAttribute('tabindex', '-1');
      el.focus();
    }, { injector: this.env });
  }
}
