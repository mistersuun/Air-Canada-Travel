/**
 * Opens the files store once per app and shares it between FilesService and
 * PassesService (extras spec §4.1/§4.2). Lazy: nothing touches IndexedDB
 * until a files or passes screen calls ensureReady().
 */
import { Injectable, Injector, Signal, inject, signal } from '@angular/core';
import { AppStateService } from '../state/app-state.service';
import { FILES_STORE, FilesStore } from './files-store';
import { FilesStatus, VERSION_CHANGE_NOTICE } from './model';
import { requestPersist } from './quota';

@Injectable({ providedIn: 'root' })
export class FilesDb {
  private readonly opener = inject(FILES_STORE);
  private readonly injector = inject(Injector);
  private readonly statusState = signal<FilesStatus>('idle');
  private opening: Promise<FilesStore | null> | null = null;
  private persistAsked = false;

  /** idle → loading → ready | memory | readOnly | error. */
  readonly status: Signal<FilesStatus> = this.statusState.asReadonly();

  /** The store, or null when it could not be opened (status 'error'). Opens once. */
  store(): Promise<FilesStore | null> {
    this.opening ??= (async () => {
      this.statusState.set('loading');
      try {
        const s = await this.opener({ onVersionChange: () => this.versionChanged() });
        this.statusState.set(s.kind === 'memory' ? 'memory' : s.readOnly ? 'readOnly' : 'ready');
        return s;
      } catch {
        this.statusState.set('error');
        return null;
      }
    })();
    return this.opening;
  }

  /** Asks the browser to keep the files, once per session, after the first successful save. */
  savedOnce(): void {
    if (this.persistAsked) return;
    this.persistAsked = true;
    void requestPersist();
  }

  /** Toast helper shared by the files and passes services (no shell in unit tests: ignored). */
  flash(message: string, action?: { label: string; run: () => void }): void {
    try {
      this.injector.get(AppStateService).flash(message, action);
    } catch {
      // no shell
    }
  }

  private versionChanged(): void {
    this.statusState.set('error');
    this.flash(VERSION_CHANGE_NOTICE);
  }
}
