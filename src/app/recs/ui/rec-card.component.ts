import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { AppStateService } from '../../state/app-state.service';
import { ProvenanceTagComponent } from '../../trips/ui/provenance-tag.component';
import { DestPhotoComponent } from '../../ui/dest-photo.component';
import { typicalText } from '../climate';
import { whyText } from '../engine';
import type { RecGroup, RecLine, Recommendation } from '../model';
import { ProfileService } from '../profile.service';

/** A line's label tag shows once per run of equal labels, on the run's last line. */
export function tagged(lines: readonly RecLine[], i: number): boolean {
  const l = lines[i]?.label;
  return !!l && lines[i + 1]?.label !== l;
}

/** The distinct "Why this" texts of a card's items, in order. */
export function whyTexts(items: readonly Recommendation[]): string[] {
  return [...new Set(items.map(whyText).filter(Boolean))];
}

/** 'Thanksgiving long weekend in 8 days' → { name: 'Thanksgiving long weekend', when: 'in 8 days' }. */
export function splitGroupTitle(title: string): { name: string; when: string | null } {
  const m = /^(.*\blong weekend) (in \d+ days|tomorrow|today)$/.exec(title);
  return m ? { name: m[1], when: m[2] } : { name: title, when: null };
}

/** Hide a recommendation ("Not for me") with an Undo toast. */
export function dismissWithUndo(profile: ProfileService, state: AppStateService, r: Recommendation): void {
  profile.dismiss(r.id);
  state.flash(`Hidden ${r.title}`, { label: 'Undo', run: () => profile.undismiss(r.id) });
}

/**
 * One suggestion row: thumb, "New York LGA", the labelled fact lines, the
 * typical weather, a chevron (the whole row links), and a "Not for me" ×.
 * The internal rank is never rendered.
 */
@Component({
  selector: 'app-rec-row',
  standalone: true,
  imports: [RouterLink, IconComponent, ProvenanceTagComponent, DestPhotoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-rec]': 'rec().id', '[attr.data-kind]': 'rec().kind' },
  template: `
    @let r = rec();
    <a class="rr__main" [routerLink]="r.link.path" [queryParams]="query()">
      @if (thumb()) {
        @if (r.code) {
          <app-dest-photo class="th" [code]="r.code" size="thumb" />
        } @else {
          <span class="th th--place" aria-hidden="true"><app-icon name="train" [size]="20" /></span>
        }
      }
      <span class="rt">
        <span class="nm"><b>{{ r.title }}</b>@if (r.code) {&ngsp;<span class="c">{{ r.code }}</span>}</span>
        @for (l of r.lines; track $index) {
          <span class="m tn" data-line>{{ l.text }}@if (tagged(r.lines, $index)) {&ngsp;@if (l.label === 'typical') {
              <span class="ui-tag ui-tag--neutral tg" aria-label="Typical, not a forecast">Typical</span>
            } @else {
              <app-provenance-tag class="tg" [value]="l.label!" />
            }
          }</span>
        }
        @if (r.weather; as w) {
          <span class="wx tn" data-weather><app-icon name="thermo" [size]="14" />{{ typical(w) }}
            <span class="ui-tag ui-tag--neutral tg" aria-label="Typical, not a forecast">Typical</span></span>
        }
      </span>
      <app-icon class="chev" name="chevron-right" [size]="16" />
    </a>
    <button type="button" class="x" [attr.aria-label]="'Not for me: ' + r.title" title="Not for me" data-dismiss
            (click)="dismiss.emit(r)">
      <app-icon name="close" [size]="15" />
    </button>
  `,
  styles: [`
    :host { display: flex; align-items: flex-start; gap: 4px; padding: 12px 0; border-bottom: 1px solid var(--hair); min-width: 0; }
    :host(:last-child) { border-bottom: 0; }
    .rr__main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; color: var(--ink); text-decoration: none; min-height: 44px; border-radius: 12px; }
    .rr__main:hover b { color: var(--blue); }
    .th { width: 46px; height: 46px; border-radius: var(--radius-thumb); flex: none; }
    .th--place { display: grid; place-items: center; background: color-mix(in srgb, var(--teal) 14%, transparent); color: var(--teal); }
    .rt { flex: 1; min-width: 0; display: grid; gap: 1px; }
    .nm { display: flex; align-items: baseline; gap: 5px; min-width: 0; }
    .nm b { font-size: 15px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .c { color: var(--ink-3); font-size: 12px; font-weight: 600; flex: none; }
    .m { font-size: 12.5px; color: var(--ink-2); line-height: 1.45; }
    .tg { margin-left: 5px; vertical-align: 1px; }
    .tg.ui-tag, .tg ::ng-deep .ui-tag { font-size: 10.5px; padding: 1px 6px; }
    .wx { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 12px; color: var(--ink-2); margin-top: 2px; }
    .wx app-icon { color: var(--amber); }
    .wx .tg { margin-left: 2px; }
    .chev { color: var(--ink-3); flex: none; }
    .x {
      width: 44px; height: 44px; margin: 0 -12px 0 0; flex: none; display: grid; place-items: center;
      color: var(--ink-2); border-radius: 12px; cursor: pointer;
    }
    .x:hover { color: var(--ink); background: var(--fill); }
  `],
})
export class RecRowComponent {
  private readonly state = inject(AppStateService);
  readonly rec = input.required<Recommendation>();
  /** Show the photo / code tile (off inside a photo card). */
  readonly thumb = input(true);
  readonly dismiss = output<Recommendation>();

  protected readonly tagged = tagged;
  protected readonly typical = typicalText;
  protected readonly query = computed(() => ({ ...this.state.globalParams(), ...this.rec().link.query }));
}

/**
 * A "For you" card (mock x13): a long-weekend group (amber tag, "in 8 days",
 * the dates) with its rows, a "Season ends soon" photo card, or a single
 * suggestion; each ends with "Why this" and the plain reasons.
 */
@Component({
  selector: 'app-rec-card',
  standalone: true,
  imports: [RecRowComponent, DestPhotoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="ui-card fy" [attr.data-group]="group()?.id ?? null">
      @if (hero(); as code) {
        <div class="fy__img"><app-dest-photo [code]="code" size="card" /><span class="fy__tag">{{ heroTag() }}</span></div>
      }
      @if (head(); as h) {
        <header class="fy__h">
          <div class="fy__hl"><span class="ui-tag ui-tag--amber" data-holiday>{{ h.name }}</span>
            @if (h.when) { <span class="when tn">{{ h.when }}</span> }</div>
          @if (h.aside) { <h3 class="ui-h3 tn fy__dates">{{ h.aside }}</h3> }
        </header>
      }
      <div class="fy__b">
        @for (r of items(); track r.id) {
          <app-rec-row [rec]="r" [thumb]="!hero()" (dismiss)="dismiss.emit($event)" />
        }
      </div>
      @for (w of whys(); track w) {
        <p class="why" data-why><b>Why this</b>&ngsp;<span>{{ w }}</span></p>
      }
    </article>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .fy { overflow: hidden; display: flex; flex-direction: column; height: 100%; }
    .fy__img { position: relative; height: 112px; }
    .fy__img app-dest-photo { position: absolute; inset: 0; }
    .fy__tag {
      position: absolute; left: 12px; top: 12px; padding: 3px 8px; border-radius: var(--radius-tag);
      font-size: 11px; font-weight: 650; background: rgba(255, 255, 255, .92); color: #7A5418;
    }
    .fy__h { padding: 14px 16px 0; }
    .fy__hl { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .when { font-size: 13px; color: var(--ink-2); white-space: nowrap; }
    .fy__dates { margin: 6px 0 0; }
    .fy__b { padding: 0 16px 2px; flex: 1; }
    .why { display: flex; gap: 8px; align-items: flex-start; margin: 0; padding: 10px 16px; background: var(--fill); font-size: 12.5px; color: var(--ink-2); }
    .why + .why { padding-top: 0; }
    .why b { color: var(--ink); font-weight: 650; flex: none; }
  `],
})
export class RecCardComponent {
  readonly items = input.required<Recommendation[]>();
  /** The long-weekend group (shows the header); null for single cards. */
  readonly group = input<RecGroup | null>(null);
  /** A photo header for this code ("Season ends soon"). */
  readonly hero = input<string | null>(null);
  readonly heroTag = input('');
  readonly dismiss = output<Recommendation>();

  protected readonly head = computed(() => {
    const g = this.group();
    if (!g) return null;
    return { ...splitGroupTitle(g.title), aside: g.aside };
  });
  protected readonly whys = computed(() => whyTexts(this.items()));
}

/** How a group's items become cards: one card per long weekend, else one per item. */
export interface CardSpec { key: string; items: Recommendation[]; group: RecGroup | null; hero: string | null; heroTag: string }

export function cardsFor(g: RecGroup): CardSpec[] {
  if (g.id.startsWith('lw:')) return [{ key: g.id, items: g.items, group: g, hero: null, heroTag: '' }];
  return g.items.map(r => ({
    key: r.id,
    items: [r],
    group: null,
    hero: g.id === 'season' && r.code ? r.code : null,
    heroTag: g.id === 'season' ? 'Season ends soon' : '',
  }));
}
