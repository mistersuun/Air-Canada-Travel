import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * 14px plane glyph pointing right (east), drawn in currentColor.
 * Decorative by default; pass `label` to expose it to assistive tech.
 *
 *   <app-plane-icon class="ui-route-line__plane" />
 *   <app-plane-icon [size]="20" [rotate]="-45" label="Departure" />
 */
@Component({
  selector: 'app-plane-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    style: 'display:inline-flex;line-height:0',
    '[attr.role]': 'label() ? "img" : null',
    '[attr.aria-label]': 'label() || null',
    '[attr.aria-hidden]': 'label() ? null : "true"',
  },
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      [attr.width]="size()"
      [attr.height]="size()"
      [style.transform]="rotate() ? 'rotate(' + rotate() + 'deg)' : null"
      fill="currentColor"
      focusable="false"
    >
      <path transform="rotate(90 12 12)" d="M21.5 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13.5 19v-5.5l8 2.5Z"/>
    </svg>
  `,
})
export class PlaneIconComponent {
  readonly size = input<number>(14);
  /** Degrees clockwise; 0 = pointing right. */
  readonly rotate = input<number>(0);
  readonly label = input<string>('');
}
