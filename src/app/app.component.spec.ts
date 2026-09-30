import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { AppComponent } from './app.component';
import { HeaderComponent } from './components/header/header.component';
import { WeekStripComponent } from './components/week-strip/week-strip.component';
import { RouteListComponent } from './components/route-list/route-list.component';
import { FlightModalComponent } from './components/flight-modal/flight-modal.component';
import { resetScheduleSource, setScheduleSource } from './data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from './data/testing/schedule-fixtures';
import { AppStateService, NOW } from './state/app-state.service';
import { PREFS_KEY, PREFS_STORAGE } from './state/prefs.service';
import { MemoryStorage } from './state/testing';

const NOW_MS = new Date('2026-10-01T12:00:00').getTime();

describe('AppComponent (shell wiring)', () => {
  let fixture: ComponentFixture<AppComponent>;
  let el: HTMLElement;
  let state: AppStateService;
  let storage: MemoryStorage;
  let versionUpdates: Subject<VersionEvent>;
  let checkForUpdate: ReturnType<typeof vi.fn>;

  function child<T>(type: new (...args: never[]) => T): T {
    return fixture.debugElement.query(By.directive(type))?.componentInstance as T;
  }

  async function render(url = ''): Promise<void> {
    window.history.replaceState(null, '', `/${url}`);
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: PREFS_STORAGE, useValue: storage },
        { provide: NOW, useValue: () => NOW_MS },
        { provide: SwUpdate, useValue: { isEnabled: true, versionUpdates, checkForUpdate } },
      ],
    });
    fixture = TestBed.createComponent(AppComponent);
    el = fixture.nativeElement;
    state = TestBed.inject(AppStateService);
    await fixture.whenStable();
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    storage = new MemoryStorage();
    versionUpdates = new Subject<VersionEvent>();
    checkForUpdate = vi.fn().mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetScheduleSource();
    window.history.replaceState(null, '', '/');
    document.documentElement.removeAttribute('data-theme');
  });

  it('wraps header and week strip in one sticky shell', async () => {
    await render();
    const shell = el.querySelector('.ui-sticky-shell')!;
    expect(shell.querySelector('app-header')).toBeTruthy();
    expect(shell.querySelector('app-week-strip')).toBeTruthy();
    expect(el.querySelector('main#main app-route-list')).toBeTruthy();
  });

  it('passes the hub as a code and date keys to the children', async () => {
    await render();
    const header = child(HeaderComponent);
    expect(header.hubCode()).toBe('YUL');
    const strip = child(WeekStripComponent);
    expect(strip.todayKey()).toBe('2026-10-01');
    expect(strip.coverage()?.to).toBe('2027-03-31');
    const list = child(RouteListComponent);
    expect(list.routes.map(r => r.destination.code)).toContain('LHR');
    expect(list.stats?.directDestinations).toBeGreaterThan(0);
    expect(list.hubCityName).toBe('Montreal');
  });

  it('header hubCodeChange switches hub, saves it and recomputes routes', async () => {
    await render();
    child(HeaderComponent).hubCodeChange.emit('YYZ');
    await fixture.whenStable();
    expect(state.hub()).toBe('YYZ');
    expect(JSON.parse(storage.getItem(PREFS_KEY)!).hub).toBe('YYZ');
    const codes = child(RouteListComponent).routes.map(r => r.destination.code);
    const direct = child(RouteListComponent).routes.filter(r => r.isDirect).map(r => r.destination.code);
    expect(direct).toEqual(['DEL', 'LHR']); // YYZ→DEL AC42, YYZ→LHR AC848; ATH is only a connection from YYZ
    expect(codes).toContain('ATH');
  });

  it('week strip outputs move the week and select days', async () => {
    await render();
    const strip = child(WeekStripComponent);
    strip.next.emit();
    await fixture.whenStable();
    expect(state.weekStartKey()).toBe('2026-10-05');
    strip.selectDay.emit('2026-10-07');
    await fixture.whenStable();
    expect(state.selectedDateKey()).toBe('2026-10-07');
    expect(child(RouteListComponent).selectedDate?.getDate()).toBe(7);
    strip.jumpTo.emit('2026-12-31');
    await fixture.whenStable();
    expect(state.weekStartKey()).toBe('2026-12-28');
    strip.prev.emit();
    await fixture.whenStable();
    expect(state.weekStartKey()).toBe('2026-12-21');
  });

  it('opens the modal from the list and closes it on (closed)', async () => {
    await render();
    expect(child(FlightModalComponent)).toBeUndefined();
    child(RouteListComponent).open.emit('LHR');
    await fixture.whenStable();
    const modal = child(FlightModalComponent);
    expect(modal.destination().code).toBe('LHR');
    expect(modal.entry()?.destination.code).toBe('LHR');
    expect(window.location.search).toContain('dest=LHR');
    // Closing pops the history entry pushed on open; wait for it so it cannot leak into the next test.
    const popped = new Promise(r => window.addEventListener('popstate', r, { once: true }));
    modal.closed.emit();
    await popped;
    await fixture.whenStable();
    expect(window.location.search).not.toContain('dest=');
    expect(child(FlightModalComponent)).toBeUndefined();
  });

  it('deep link ?from=YYZ&day=…&dest=LHR opens that hub, day and modal', async () => {
    await render('?from=YYZ&day=2026-10-07&dest=LHR');
    expect(child(HeaderComponent).hubCode()).toBe('YYZ');
    expect(state.selectedDateKey()).toBe('2026-10-07');
    expect(child(FlightModalComponent).destination().code).toBe('LHR');
  });

  it('modal selectDate moves the app to that day and keeps the modal open', async () => {
    await render('?dest=LHR');
    child(FlightModalComponent).selectDate.emit('2026-11-11');
    await fixture.whenStable();
    expect(state.weekStartKey()).toBe('2026-11-09');
    expect(state.selectedDateKey()).toBe('2026-11-11');
    expect(child(FlightModalComponent)).toBeTruthy();
  });

  it('toggleFavourite from the list and the modal updates prefs and inputs', async () => {
    await render('?dest=LHR');
    child(RouteListComponent).toggleFavourite.emit('ATH');
    child(FlightModalComponent).toggleFavourite.emit();
    await fixture.whenStable();
    expect(JSON.parse(storage.getItem(PREFS_KEY)!).favourites).toEqual(['ATH', 'LHR']);
    expect(child(FlightModalComponent).isFavourite()).toBe(true);
    expect(child(RouteListComponent).favourites).toEqual(['ATH', 'LHR']);
    expect(child(HeaderComponent).starredThisWeek().map(s => s.code)).toEqual(['ATH', 'LHR']);
  });

  it('clearFilters and jumpToCoverage from the list reach the state', async () => {
    await render('?q=zzz&region=Europe');
    expect(child(RouteListComponent).hasActiveFilters).toBe(true);
    child(RouteListComponent).clearFilters.emit();
    await fixture.whenStable();
    expect(state.query()).toBe('');
    expect(state.region()).toBe('All');
    child(RouteListComponent).jumpToCoverage.emit(null);
    await fixture.whenStable();
    expect(state.weekStartKey()).toBe('2027-03-29');
  });

  it('header theme and settings outputs', async () => {
    await render();
    const header = child(HeaderComponent);
    header.themeChange.emit('dark');
    await fixture.whenStable();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(header.theme()).toBe('dark');

    header.openSettings.emit();
    await fixture.whenStable();
    const dialog = el.querySelector<HTMLDialogElement>('app-settings dialog')!;
    expect(dialog).toBeTruthy();
    expect(dialog.hasAttribute('open')).toBe(true);
    el.querySelector<HTMLButtonElement>('app-settings .ui-btn--primary')!.click();
    await fixture.whenStable();
    expect(el.querySelector('app-settings')).toBeNull();
  });

  it('shows a reload toast when a new version is ready', async () => {
    await render();
    expect(el.querySelector('app-toast')).toBeNull();
    versionUpdates.next({ type: 'VERSION_DETECTED', version: { hash: 'b' } });
    await fixture.whenStable();
    expect(el.querySelector('app-toast')).toBeNull();
    versionUpdates.next({ type: 'VERSION_READY', currentVersion: { hash: 'a' }, latestVersion: { hash: 'b' } });
    await fixture.whenStable();
    const toast = el.querySelector('app-toast')!;
    expect(toast.textContent).toContain('New schedules available');
    expect(toast.textContent).toContain('Reload');
    toast.querySelector<HTMLButtonElement>('[aria-label="Dismiss"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('app-toast')).toBeNull();
  });

  it('checks for updates and refreshes today when the tab becomes visible', async () => {
    await render();
    const refresh = vi.spyOn(state, 'refreshToday');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalled();
    expect(checkForUpdate).toHaveBeenCalled();
  });

  it('share falls back to copying the URL and confirms with a toast', async () => {
    await render('?dest=LHR');
    const writeText = vi.fn().mockResolvedValue(undefined);
    const nav = window.navigator as Navigator & { share?: unknown };
    const hadShare = 'share' in nav;
    Object.defineProperty(nav, 'clipboard', { configurable: true, value: { writeText } });
    if (hadShare) Object.defineProperty(nav, 'share', { configurable: true, value: undefined });
    child(FlightModalComponent).share.emit();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    await fixture.whenStable();
    expect(el.querySelector('app-toast')?.textContent).toContain('Link copied');
  });

  it('share uses the Web Share API when available', async () => {
    await render('?dest=LHR');
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: share });
    await fixture.componentInstance.share();
    expect(share).toHaveBeenCalledWith({ title: 'YUL → LHR · London', url: window.location.href });
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: undefined });
  });
});
