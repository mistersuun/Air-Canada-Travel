import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Line icons (24x24 grid, 1.75 stroke, currentColor). Decorative by default;
 * pass `label` when the icon carries meaning on its own (e.g. an icon-only
 * button should instead put aria-label on the <button>).
 *
 *   <app-icon name="gear" />
 *   <app-icon name="star" [filled]="isFav" [size]="18" />
 */
export type IconName =
  | 'plane'
  | 'star'
  | 'gear'
  | 'calendar'
  | 'share'
  | 'warning'
  | 'search'
  | 'close'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'clock'
  | 'sun'
  | 'moon'
  | 'auto'
  | 'swap'
  | 'download'
  | 'info';

/** Path data per icon. Paths are stroked; FILLABLE icons also take fill when `filled`. */
export const ICON_PATHS: Record<IconName, string[]> = {
  // points up (north); rotate with CSS for other headings
  plane: ['M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5Z'],
  star: [
    'm12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z',
  ],
  gear: [
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z',
    'M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3 1a7.5 7.5 0 0 0-2.6-1.5L14.2 2.6h-4l-.3 2.5a7.5 7.5 0 0 0-2.6 1.5l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-1a7.5 7.5 0 0 0 2.6 1.5l.3 2.5h4l.3-2.5a7.5 7.5 0 0 0 2.6-1.5l2.3 1 2-3.4-2-1.5Z',
  ],
  calendar: [
    'M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-12Z',
    'M4.5 9.5h15M8.5 2.5v4M15.5 2.5v4',
  ],
  share: [
    'M12 15V3.5M7.5 8 12 3.5 16.5 8',
    'M5 12.5v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  ],
  warning: [
    'M10.3 4.2 2.6 17.5a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z',
    'M12 9.5v4M12 17h.01',
  ],
  search: ['M10.5 17.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20.5 20.5l-5-5'],
  close: ['M6 6l12 12M18 6 6 18'],
  'chevron-left': ['M14.5 5.5 8 12l6.5 6.5'],
  'chevron-right': ['M9.5 5.5 16 12l-6.5 6.5'],
  'chevron-down': ['M5.5 9.5 12 16l6.5-6.5'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3.5 2'],
  sun: [
    'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    'M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
  ],
  moon: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z'],
  auto: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 3v18'],
  swap: ['M7 4 3.5 7.5 7 11M3.5 7.5h13M17 13l3.5 3.5L17 20M20.5 16.5h-13'],
  download: ['M12 3.5V15M7.5 10.5 12 15l4.5-4.5', 'M4.5 19.5h15'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 11v5.5M12 7.5h.01'],
};

const FILLABLE: ReadonlySet<IconName> = new Set<IconName>(['star', 'plane', 'moon']);

@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    style: 'display:inline-flex;line-height:0;flex-shrink:0',
    '[attr.role]': 'label() ? "img" : null',
    '[attr.aria-label]': 'label() || null',
    '[attr.aria-hidden]': 'label() ? null : "true"',
    '[attr.data-icon]': 'name()',
  },
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.fill]="fill()"
      stroke="currentColor"
      [attr.stroke-width]="strokeWidth()"
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
    >
      @for (d of paths(); track $index) {
        <path [attr.d]="d" />
      }
    </svg>
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input<number>(20);
  readonly filled = input<boolean>(false);
  readonly strokeWidth = input<number>(1.75);
  readonly label = input<string>('');

  protected readonly paths = computed(() => ICON_PATHS[this.name()] ?? []);
  protected readonly fill = computed(() =>
    this.filled() && FILLABLE.has(this.name()) ? 'currentColor' : 'none',
  );
}
