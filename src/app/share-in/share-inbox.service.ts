import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { SHARE_CACHE, type SharedMeta, stashKey, validShareId } from './share-payload';

/** One thing that arrived through the Share Target or File Handling: files plus any text. */
export interface SharedItem { files: File[]; title: string; text: string; url: string }

/**
 * Holds what the user shared into the app, from either door:
 *  - Android Share Target: the service worker stashed the POST in Cache
 *    Storage; `loadStash(id)` reads it back and deletes it.
 *  - Desktop File Handling: `offerFiles` keeps the opened files in memory.
 * `handoff` passes a file to the add-boarding-pass page without a second copy.
 * Nothing is uploaded; the stash never outlives its use (the worker also drops
 * anything older than an hour).
 */
@Injectable({ providedIn: 'root' })
export class ShareInboxService {
  private readonly win = inject(DOCUMENT).defaultView;
  readonly item = signal<SharedItem | null>(null);
  private pass: File | null = null;

  offerFiles(files: File[]): void {
    this.item.set({ files, title: '', text: '', url: '' });
  }

  /** Reads and deletes a stash. Null when it is gone (already used, expired). */
  async loadStash(id: string): Promise<SharedItem | null> {
    const caches = this.win?.caches;
    if (!caches || !validShareId(id)) return null;
    try {
      const cache = await caches.open(SHARE_CACHE);
      const res = await cache.match(stashKey(id, 'meta.json'));
      if (!res) return null;
      const meta = (await res.json()) as SharedMeta;
      const files: File[] = [];
      for (let i = 0; i < meta.files.length; i++) {
        const part = await cache.match(stashKey(id, i));
        if (!part) continue;
        files.push(new File([await part.blob()], meta.files[i].name, { type: meta.files[i].type }));
      }
      await this.dropStash(id, meta.files.length);
      const item = { files, title: meta.title, text: meta.text, url: meta.url };
      this.item.set(item);
      return item;
    } catch {
      return null;
    }
  }

  async dropStash(id: string, parts: number): Promise<void> {
    try {
      const cache = await this.win?.caches?.open(SHARE_CACHE);
      if (!cache) return;
      await cache.delete(stashKey(id, 'meta.json'));
      for (let i = 0; i < parts; i++) await cache.delete(stashKey(id, i));
    } catch { /* nothing to clean */ }
  }

  handoff(file: File): void {
    this.pass = file;
  }

  takeHandoff(): File | null {
    const f = this.pass;
    this.pass = null;
    return f;
  }

  clear(): void {
    this.item.set(null);
    this.pass = null;
  }
}
