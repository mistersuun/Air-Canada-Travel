/**
 * Test helpers for the app shell (not part of the app bundle unless imported).
 */

/** In-memory Storage for PREFS_STORAGE. */
export class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

/** A Storage whose every access throws, like Safari private mode or blocked site data. */
export class BlockedStorage implements Storage {
  readonly length = 0;
  clear(): void {
    throw new DOMException('blocked', 'SecurityError');
  }
  getItem(): string | null {
    throw new DOMException('blocked', 'SecurityError');
  }
  key(): string | null {
    throw new DOMException('blocked', 'SecurityError');
  }
  removeItem(): void {
    throw new DOMException('blocked', 'SecurityError');
  }
  setItem(): void {
    throw new DOMException('blocked', 'SecurityError');
  }
}
