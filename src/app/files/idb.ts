/**
 * A small promise wrapper over IndexedDB (extras spec §4.1), no dependency.
 *
 * Inside `run`, await only IDB requests: awaiting anything else (fetch,
 * createImageBitmap, blob.arrayBuffer) lets the transaction auto-commit.
 * Prepare blobs before opening the transaction.
 */

export class IdbBlockedError extends Error {
  constructor() {
    super('IndexedDB open is blocked by another tab');
    this.name = 'IdbBlockedError';
  }
}

export class IdbUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('IndexedDB is not available');
    this.name = 'IdbUnavailableError';
    (this as { cause?: unknown }).cause = cause;
  }
}

/** How long a blocked open waits for the other tab before giving up. */
export const BLOCKED_WAIT_MS = 3000;

function defaultFactory(): IDBFactory | null {
  try {
    return globalThis.indexedDB ?? null;
  } catch {
    return null; // SecurityError when site data is blocked
  }
}

function openOnce(
  factory: IDBFactory, name: string, version: number | undefined,
  upgrade: ((db: IDBDatabase, oldVersion: number, tx: IDBTransaction) => void) | null,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let r: IDBOpenDBRequest;
    try {
      r = version === undefined ? factory.open(name) : factory.open(name, version);
    } catch (e) {
      reject(e);
      return;
    }
    let blockedTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (blockedTimer) clearTimeout(blockedTimer);
      fn();
    };
    r.onupgradeneeded = e => {
      if (upgrade && r.transaction) upgrade(r.result, e.oldVersion, r.transaction);
    };
    r.onsuccess = () => {
      if (settled) {
        r.result.close(); // gave up waiting while blocked
        return;
      }
      done(() => resolve(r.result));
    };
    r.onerror = e => {
      e.preventDefault?.();
      done(() => reject(r.error ?? new Error('open failed')));
    };
    r.onblocked = () => {
      blockedTimer ??= setTimeout(() => done(() => reject(new IdbBlockedError())), BLOCKED_WAIT_MS);
    };
  });
}

/**
 * Opens (and upgrades) a database. When a newer app version wrote it
 * (VersionError), reopens it at its own version and returns readOnly: the
 * data shows, but the caller must refuse writes. Rejects with
 * IdbUnavailableError when IndexedDB is missing or blocked (private modes),
 * and IdbBlockedError when another tab holds an old version open for 3 s.
 */
export async function openDb(
  name: string, version: number,
  upgrade: (db: IDBDatabase, oldVersion: number, tx: IDBTransaction) => void,
  factory?: IDBFactory,
): Promise<{ db: IDBDatabase; readOnly: boolean }> {
  const f = factory ?? defaultFactory();
  if (!f) throw new IdbUnavailableError();
  try {
    return { db: await openOnce(f, name, version, upgrade), readOnly: false };
  } catch (e) {
    const n = (e as { name?: string })?.name;
    if (n === 'VersionError') return { db: await openOnce(f, name, undefined, null), readOnly: true };
    if (e instanceof IdbBlockedError) throw e;
    if (n === 'SecurityError' || n === 'InvalidStateError' || n === 'UnknownError' || e instanceof TypeError) {
      throw new IdbUnavailableError(e);
    }
    throw e;
  }
}

/** A request as a promise. */
export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = e => {
      e.preventDefault?.(); // let the transaction's own error surface through txDone
      reject(r.error ?? new Error('request failed'));
    };
  });
}

/** Resolves when the transaction commits; rejects when it errors or aborts. */
export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('transaction failed'));
    tx.onabort = () => reject(tx.error ?? new DOMException('transaction aborted', 'AbortError'));
  });
}

/**
 * Runs `fn` in one transaction and resolves with its result once the
 * transaction has committed. If `fn` throws, the transaction is aborted and
 * nothing it wrote is kept.
 */
export async function run<T>(
  db: IDBDatabase, stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(stores, mode);
  const done = txDone(tx);
  let result: T;
  try {
    result = await fn(tx);
  } catch (e) {
    try {
      tx.abort();
    } catch {
      // already finished
    }
    await done.catch(() => undefined);
    throw e;
  }
  await done;
  return result;
}
