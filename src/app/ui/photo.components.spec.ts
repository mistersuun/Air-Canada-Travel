import { describe, it, expect, beforeEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DestPhotoComponent } from './dest-photo.component';
import { DestRowComponent } from './dest-row.component';
import { PhotoCardComponent } from './photo-card.component';
import { PhotoService } from '../state/photo.service';
import { PREFS_STORAGE } from '../state/prefs.service';
import { MemoryStorage } from '../state/testing';

const MANIFEST = {
  version: 1,
  photos: {
    LIS: { author: 'Jane', source: 'unsplash', sourceUrl: 'https://u/x', license: 'Unsplash License', position: '50% 30%' },
  },
};

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: PREFS_STORAGE, useValue: new MemoryStorage() }],
  });
  TestBed.inject(PhotoService).setManifest(MANIFEST);
});

describe('DestPhotoComponent', () => {
  async function render(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(DestPhotoComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('renders a lazy responsive image with the focal point', async () => {
    const { el } = await render({ code: 'LIS', size: 'card', alt: 'Lisbon tram' });
    const img = el.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('img/dest/LIS.webp');
    expect(img.getAttribute('srcset')).toBe('img/dest/LIS-400.webp 400w, img/dest/LIS.webp 960w');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('fetchpriority')).toBeNull();
    expect(img.getAttribute('alt')).toBe('Lisbon tram');
    expect(img.style.objectPosition).toBe('50% 30%');
  });

  it('hero images load eagerly with high priority; thumbs use the 400w file', async () => {
    const hero = await render({ code: 'LIS', size: 'hero', eager: true });
    expect(hero.el.querySelector('img')!.getAttribute('fetchpriority')).toBe('high');
    expect(hero.el.querySelector('img')!.getAttribute('loading')).toBe('eager');
    const thumb = await render({ code: 'LIS', size: 'thumb' });
    expect(thumb.el.querySelector('img')!.getAttribute('src')).toBe('img/dest/LIS-400.webp');
    expect(thumb.el.querySelector('img')!.getAttribute('srcset')).toBeNull();
  });

  it('falls back to a monogram without a photo, and on a load error', async () => {
    const { el } = await render({ code: 'LHR', size: 'card' });
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('.mono__code')?.textContent).toBe('LHR');
    expect(el.querySelector('.mono__city')?.textContent).toBe('London');
    expect(el.classList).toContain('is-mono');

    const lis = await render({ code: 'LIS', size: 'thumb' });
    lis.el.querySelector('img')!.dispatchEvent(new Event('error'));
    await lis.fixture.whenStable();
    expect(lis.el.querySelector('img')).toBeNull();
    expect(lis.el.querySelector('.mono__city')).toBeNull(); // thumbs show the code only
  });
});

@Component({
  standalone: true,
  imports: [DestRowComponent, PhotoCardComponent],
  template: `
    <app-dest-row code="LIS" small="LIS" meta="21:45 → 09:20⁺¹ · 6h35 · AC812" [link]="link()"
                  [dots]="['on','off','on','on','on','on','on']" [selectedDay]="0" [highlight]="hl()" [thumb]="thumb()">
      <span trailing class="tag">Ends Oct 22</span>
    </app-dest-row>
    <app-photo-card code="LIS" meta="Portugal · 6h35" badge="Tonight 21:45" [link]="link()" />
    <app-photo-card code="CUN" variant="wide" [height]="250" bigCode title="Cancún">
      <div footer class="foot">Nonstop</div>
    </app-photo-card>
  `,
})
class Host {
  link = signal<string[] | null>(['/to', 'LIS']);
  hl = signal(false);
  thumb = signal<'photo' | 'mono'>('photo');
}

describe('DestRowComponent and PhotoCardComponent', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, host: fixture.componentInstance };
  }

  it('a row is one link with name, small code, meta, dots, trailing content and a chevron', async () => {
    const { el } = await setup();
    const row = el.querySelector<HTMLAnchorElement>('app-dest-row a.row')!;
    expect(row.getAttribute('href')).toBe('/to/LIS?from=YUL');
    expect(row.querySelector('.nm')?.textContent).toBe('LisbonLIS');
    expect(row.querySelector('.tm')?.textContent).toContain('AC812');
    expect(row.querySelector('app-dot-row')?.getAttribute('aria-label')).toContain('Flies');
    expect(row.querySelector('.tag')?.textContent).toBe('Ends Oct 22');
    expect(row.querySelector('.chev')).toBeTruthy();
    expect(row.querySelector('app-dest-photo img')).toBeTruthy();
  });

  it('a row without a link is static; highlight and mono thumbs apply', async () => {
    const { el, host, fixture } = await setup();
    host.link.set(null);
    host.hl.set(true);
    host.thumb.set('mono');
    await fixture.whenStable();
    expect(el.querySelector('app-dest-row a')).toBeNull();
    expect(el.querySelector('app-dest-row div.row')).toBeTruthy();
    expect(el.querySelector('app-dest-row')!.classList).toContain('is-hl');
    expect(el.querySelector('app-dest-row .th.ui-mono')?.textContent).toBe('LIS');
    expect(el.querySelector('app-photo-card a')).toBeNull();
  });

  it('photo cards: pick links with badge and glass bar; wide cards with height, code and footer', async () => {
    const { el } = await setup();
    const [pick, wide] = [...el.querySelectorAll<HTMLElement>('app-photo-card')];
    const a = pick.querySelector<HTMLAnchorElement>('a.pcard')!;
    expect(a.getAttribute('href')).toBe('/to/LIS?from=YUL');
    expect(a.getAttribute('aria-label')).toBe('Lisbon, Portugal · 6h35, Tonight 21:45');
    expect(pick.querySelector('.bdg')?.textContent).toBe('Tonight 21:45');
    expect(pick.querySelector('.t')?.textContent).toBe('Lisbon');
    expect(pick.classList).toContain('is-pick');
    expect(wide.classList).toContain('is-wide');
    expect(wide.style.height).toBe('250px');
    expect(wide.querySelector('.code')?.textContent).toBe('CUN');
    expect(wide.querySelector('.t')?.textContent).toBe('Cancún');
    expect(wide.querySelector('.foot')?.textContent).toBe('Nonstop');
    expect(wide.querySelector('.bdg')).toBeNull();
  });
});
