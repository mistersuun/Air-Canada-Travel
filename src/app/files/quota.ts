/**
 * Storage space checks (extras spec §4.3). The pure parts are tested; the
 * navigator calls degrade to "unknown" where a browser lacks them.
 */
import { intlLocale } from '../i18n/locale';
import { t } from '../i18n/t';

const MB = 1024 * 1024;

/** '14.2' / '14,2': one decimal in the UI language. */
function oneDecimal(n: number): string {
  return new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
}

/** True for the browser's "storage full" errors (QuotaExceededError, Firefox's NS_ERROR_DOM_QUOTA_REACHED, legacy code 22). */
export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const x = e as { name?: unknown; code?: unknown };
  return x.name === 'QuotaExceededError' || x.name === 'NS_ERROR_DOM_QUOTA_REACHED' || x.code === 22;
}

/** 'quota' when the free space is under 1.2× the file plus 5 MB; an unknown estimate gives 'ok'. */
export function checkRoom(bytes: number, estimate: { quota?: number; usage?: number } | null): 'ok' | 'quota' {
  if (!estimate || typeof estimate.quota !== 'number' || typeof estimate.usage !== 'number') return 'ok';
  return estimate.quota - estimate.usage < bytes * 1.2 + 5 * MB ? 'quota' : 'ok';
}

/** 'Not enough space on this phone for this file (12.4 MB). …' */
export function quotaText(bytes: number): string {
  return t('files.error.quotaSize', { size: formatBytes(bytes) });
}

/** '820 KB', '14.2 MB', '1.1 GB' (1024-based, like the phone's own storage screens). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return t('files.bytes.b', { n: Math.max(0, Math.round(bytes)) });
  if (bytes < MB) return t('files.bytes.kb', { n: Math.round(bytes / 1024) });
  if (bytes < 1024 * MB) return t('files.bytes.mb', { n: oneDecimal(bytes / MB) });
  return t('files.bytes.gb', { n: oneDecimal(bytes / (1024 * MB)) });
}

export interface StorageInfo { persisted: boolean | null; quotaBytes: number | null; usageBytes: number | null; installed: boolean }

type StorageManagerLike = { estimate?: () => Promise<{ quota?: number; usage?: number }>; persisted?: () => Promise<boolean>; persist?: () => Promise<boolean> };

function manager(): StorageManagerLike | null {
  try {
    return (globalThis.navigator?.storage as StorageManagerLike | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function estimate(): Promise<{ quota?: number; usage?: number } | null> {
  try {
    return (await manager()?.estimate?.()) ?? null;
  } catch {
    return null;
  }
}

/** Launched from the Home Screen (iOS keeps an installed app's storage). */
export function isInstalled(): boolean {
  try {
    const nav = globalThis.navigator as Navigator & { standalone?: boolean };
    return !!globalThis.matchMedia?.('(display-mode: standalone)').matches || nav?.standalone === true;
  } catch {
    return false;
  }
}

export async function storageInfo(): Promise<StorageInfo> {
  const m = manager();
  let persisted: boolean | null = null;
  try {
    persisted = m?.persisted ? await m.persisted() : null;
  } catch {
    persisted = null;
  }
  const est = await estimate();
  return {
    persisted,
    quotaBytes: typeof est?.quota === 'number' ? est.quota : null,
    usageBytes: typeof est?.usage === 'number' ? est.usage : null,
    installed: isInstalled(),
  };
}

/** Asks the browser to keep this site's data. A refusal is fine. */
export async function requestPersist(): Promise<boolean> {
  try {
    if (await manager()?.persisted?.()) return true;
    return (await manager()?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
