import { Injectable, InjectionToken, inject, signal } from '@angular/core';

/** One entry of public/img/dest/credits.json (written by scripts/photos). */
export interface PhotoCredit {
  subject?: string;
  author: string;
  authorUrl?: string;
  source: 'unsplash' | 'wikimedia' | string;
  sourceUrl: string;
  license: string;
  licenseUrl?: string;
  /** CSS object-position focal point, default '50% 50%'. */
  position?: string;
  /** Luminance of the bottom 40% of the photo. */
  tone?: 'light' | 'dark';
}

export interface PhotoManifest {
  version: number;
  generated?: string;
  photos: Readonly<Record<string, PhotoCredit>>;
}

export const PHOTO_BASE = 'img/dest/';
export const CREDITS_URL = `${PHOTO_BASE}credits.json`;

/** How the manifest is fetched; specs replace it. Resolves to the parsed JSON. */
export const PHOTO_FETCH = new InjectionToken<(url: string) => Promise<unknown>>('PHOTO_FETCH', {
  providedIn: 'root',
  factory: () => async (url: string) => {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
});

const EMPTY: PhotoManifest = { version: 1, photos: {} };

/**
 * Destination photos. The manifest loads in the app initializer, in parallel
 * with the schedules; any failure leaves an empty manifest, so every
 * destination falls back to its monogram tile (ui/dest-photo).
 */
@Injectable({ providedIn: 'root' })
export class PhotoService {
  private readonly fetcher = inject(PHOTO_FETCH);
  private readonly manifest = signal<PhotoManifest>(EMPTY);
  /** True once load() has settled (with or without photos). */
  readonly loaded = signal(false);

  /** Fetch credits.json. Never rejects. */
  async load(): Promise<void> {
    try {
      const raw = (await this.fetcher(CREDITS_URL)) as Partial<PhotoManifest> | null;
      if (raw && typeof raw === 'object' && raw.photos && typeof raw.photos === 'object') {
        this.manifest.set({ version: raw.version ?? 1, generated: raw.generated, photos: raw.photos });
      }
    } catch {
      // Offline on first visit, or no photos deployed: monograms everywhere.
    } finally {
      this.loaded.set(true);
    }
  }

  /** Replace the manifest (specs, previews). */
  setManifest(m: PhotoManifest | null): void {
    this.manifest.set(m ?? EMPTY);
  }

  has(code: string): boolean {
    return !!this.manifest().photos[code];
  }

  /** 'img/dest/LIS.webp' (960w) or 'img/dest/LIS-400.webp'. */
  src(code: string, w: 400 | 960 = 960): string {
    return `${PHOTO_BASE}${code}${w === 400 ? '-400' : ''}.webp`;
  }

  /** 'img/dest/LIS-400.webp 400w, img/dest/LIS.webp 960w'. */
  srcset(code: string): string {
    return `${this.src(code, 400)} 400w, ${this.src(code, 960)} 960w`;
  }

  credit(code: string): PhotoCredit | null {
    return this.manifest().photos[code] ?? null;
  }

  position(code: string): string {
    return this.manifest().photos[code]?.position || '50% 50%';
  }
}
