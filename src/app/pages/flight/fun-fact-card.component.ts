import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { IconComponent } from '../../components/shared/icons.component';
import { destinationFact, dismissFact, dismissedFacts } from './fun-fact';

/** A small, dismissible "Did you know" line for the destination (one a day, per destination). */
@Component({
  selector: 'app-fun-fact-card',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown(); as f) {
      <aside class="ff" data-fun-fact aria-label="A fact about {{ city() }}">
        <app-icon name="sparkle" [size]="16" />
        <p><b>While you wait</b> {{ f }}</p>
        <button type="button" class="ff__x" aria-label="Hide facts about {{ city() }}" data-fun-fact-dismiss (click)="hide()">
          <app-icon name="close" [size]="14" />
        </button>
      </aside>
    }
  `,
  styles: [`
    :host { display: block; }
    .ff {
      display: flex; align-items: flex-start; gap: 10px; padding: 10px 6px 10px 14px; border-radius: 14px;
      background: color-mix(in srgb, var(--blue) 8%, transparent); color: var(--ink-2); font-size: 13px;
    }
    .ff app-icon { flex: none; margin-top: 2px; color: var(--blue); }
    .ff p { flex: 1; min-width: 0; margin: 2px 0 0; }
    .ff b { color: var(--ink); font-weight: 650; margin-right: 4px; }
    .ff__x { flex: none; width: 44px; height: 44px; margin: -8px 0; display: grid; place-items: center; border-radius: 50%; color: var(--ink-3); cursor: pointer; }
  `],
})
export class FunFactCardComponent {
  readonly code = input.required<string>();
  readonly hub = input.required<string>();
  readonly nowMs = input.required<number>();
  readonly city = input('this destination');

  private readonly off = signal<ReadonlySet<string>>(dismissedFacts());
  protected readonly shown = computed(() =>
    this.off().has(this.code().toUpperCase()) ? null : destinationFact(this.code(), this.hub(), this.nowMs()));

  protected hide(): void {
    this.off.set(dismissFact(this.code()));
  }
}
