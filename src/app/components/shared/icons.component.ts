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
  | 'info'
  | 'compass'
  | 'map'
  | 'arrow-left'
  | 'filter'
  | 'locate'
  | 'currency'
  | 'suitcase'
  | 'train'
  | 'bus'
  | 'car'
  | 'home'
  | 'check'
  | 'retry'
  | 'note'
  | 'more'
  | 'external'
  | 'pin'
  | 'barcode'
  | 'camera'
  | 'image'
  | 'file'
  | 'doc'
  | 'paperclip'
  | 'trash'
  | 'copy'
  | 'lock'
  | 'sparkle'
  | 'thermo'
  | 'scan';

/** Path data per icon. Paths are stroked; FILLABLE icons also take fill when `filled`. */
export const ICON_PATHS: Record<IconName, string[]> = {
  // points up (north); rotate with CSS for other headings
  plane: ['M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5Z'],
  // Clear Sky tab bar set (src-2.html ico.e/m/s/g), drawn at stroke-width 2.
  star: ['m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z'],
  gear: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  ],
  compass: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm15.5 8.5-2 5-5 2 2-5Z'],
  map: ['M9 4 3 6v14l6-2 6 2 6-2V4l-6 2Z', 'M9 4v14M15 6v14'],
  calendar: [
    'M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-12Z',
    'M4.5 9.5h15M8.5 2.5v4M15.5 2.5v4',
  ],
  // ↗ (open / share out)
  share: ['M7 17 17 7', 'M8.5 7H17v8.5'],
  'arrow-left': ['M19 12H5', 'm11 18-6-6 6-6'],
  filter: ['M4 7h16M7 12h10M10 17h4'],
  locate: ['M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  currency: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
    'M14.6 9.2c-.5-.8-1.5-1.3-2.6-1.3-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 1.9 2.6.8 2.6 2-1.1 2-2.6 2c-1.1 0-2.1-.5-2.6-1.3M12 6.5v11',
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
  // Trips v2
  suitcase: [
    'M4 8.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9Z',
    'M9 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v1.5M4 12.5h16',
  ],
  train: [
    'M6.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-10Z',
    'M6.5 10h11M9.5 13.5h.01M14.5 13.5h.01M9 16.5 7 20.5M15 16.5l2 4',
  ],
  bus: [
    'M5 5.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-11Z',
    'M5 11h14M8.5 14.5h.01M15.5 14.5h.01M7.5 17.5v2M16.5 17.5v2',
  ],
  car: [
    'M4.5 16.5v-4l2-5a1.5 1.5 0 0 1 1.4-1h8.2a1.5 1.5 0 0 1 1.4 1l2 5v4a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1Z',
    'M4.5 12.5h15M8 15h.01M16 15h.01M6.5 17.5v1.5M17.5 17.5v1.5',
  ],
  home: ['M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z'],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  retry: ['M4.5 12a7.5 7.5 0 1 0 2.2-5.3', 'M4.5 4.5v4h4'],
  note: [
    'M6 3.5h8.5L19 8v11.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z',
    'M14 3.5V8.5h5M8.5 12.5h7M8.5 16h5',
  ],
  more: ['M6 12h.01M12 12h.01M18 12h.01'],
  external: ['M13.5 4.5h6v6', 'M19.5 4.5 11 13', 'M18 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H10'],
  pin: ['M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z', 'M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'],
  // Trip extras (passes, files, For you)
  barcode: ['M4 5.5v13M7 5.5v13M10.5 5.5v13M13 5.5v13M16.5 5.5v13M20 5.5v13'],
  camera: [
    'M3.5 8.5a2 2 0 0 1 2-2h2.2L9.2 4h5.6l1.5 2.5h2.2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9Z',
    'M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  ],
  image: [
    'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z',
    'm4 16 4.5-4.5 4 4 2.5-2.5L20 18M15.5 9.5h.01',
  ],
  file: ['M6 3.5h8.5L19 8v11.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z', 'M14 3.5V8.5h5'],
  doc: [
    'M6 3.5h8.5L19 8v11.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z',
    'M14 3.5V8.5h5M8 13h1.5a1.25 1.25 0 0 1 0 2.5H8V12.5M8 15.5V17',
  ],
  paperclip: ['M20 11.5 12.2 19.3a4.5 4.5 0 0 1-6.4-6.4l8-8a3 3 0 0 1 4.2 4.2l-8 8a1.5 1.5 0 0 1-2.1-2.1l7.3-7.3'],
  trash: ['M4.5 7h15M10 11v6M14 11v6', 'M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7'],
  copy: ['M9 9h10.5v11.5H9V9Z', 'M15 9V4.5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1V14a1 1 0 0 0 1 1h4'],
  lock: ['M6 11a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 11v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19v-8Z', 'M8.5 9.5V7a3.5 3.5 0 0 1 7 0v2.5'],
  sparkle: ['M12 3.5 13.8 10.2 20.5 12l-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8L12 3.5Z', 'M19 3.5v3M17.5 5h3'],
  thermo: ['M10 14.5V5a2 2 0 0 1 4 0v9.5a3.5 3.5 0 1 1-4 0Z', 'M12 17.5V10'],
  scan: ['M4 8V5.5a1.5 1.5 0 0 1 1.5-1.5H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16', 'M4 12h16'],
};

const FILLABLE: ReadonlySet<IconName> = new Set<IconName>(['star', 'plane', 'moon', 'pin', 'home']);

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
