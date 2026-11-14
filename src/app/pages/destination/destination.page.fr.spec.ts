import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../../data/testing/schedule-fixtures';
import { setLocale } from '../../i18n/locale';
import { AppStateService, NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { toUtcMs } from '../../utils/time';
import { DestinationPage } from './destination.page';

const NOW_MS = toUtcMs('2026-10-01', '12:00', 'America/Toronto');

describe('DestinationPage in French', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
    setScheduleSource(FIXTURE_ROUTES, FIXTURE_META);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: PREFS_STORAGE, useValue: new MemoryStorage() }, { provide: NOW, useValue: () => NOW_MS }],
    });
  });
  afterEach(() => {
    setLocale('en');
    vi.useRealTimers();
    resetScheduleSource();
  });

  async function render(code: string, query: Record<string, string> = {}) {
    const fixture = TestBed.createComponent(DestinationPage);
    TestBed.inject(AppStateService);
    fixture.componentRef.setInput('code', code);
    for (const [k, v] of Object.entries(query)) fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return { el, text: (sel?: string) => ((sel ? el.querySelector(sel) : el)?.textContent ?? '').replace(/[\s  ]+/g, ' ').trim() };
  }

  it('renders the header, notices and sections in Canadian French', async () => {
    setLocale('fr');
    const { el, text } = await render('LHR');
    expect(text('.head .ui-sub')).toBe('United Kingdom · Europe');
    const tags = [...el.querySelectorAll('.tags .ui-tag')].map(t => t.textContent!.trim().replace(/[  ]/g, ' '));
    expect(tags[0]).toMatch(/^Sans escale · \d+ h \d\d$/);
    expect(tags[1]).toBe('Tous les jours');
    expect(tags[3]).toBe("Toute l'année");
    expect(text('.next__when')).toBe("Aujourd'hui · 22:10");
    expect(text()).toContain('Prochain départ');
    expect(text()).toContain('Choisir les dates');
    expect(text()).toContain('Fuseau horaire');
    expect(el.querySelector('[aria-label="Retour"]')).not.toBeNull();
    expect([...el.querySelectorAll('app-seg button')].map(b => b.textContent!.trim())).toContain('Départs');
    expect(text()).not.toMatch(/Next departure|Plan dates|Essentials|Time zone|Departures|Return flights|Great-circle|Open in aircanada/);
  });

  it('says a route is not served in French', async () => {
    setLocale('fr');
    const { text } = await render('NRT');
    expect(text('.notice')).toMatch(/Non desservie|Non publié|Correspondances seulement|Aucun vol sans escale/);
    expect(text('.notice')).not.toMatch(/Not served|Not published|Connections only|No nonstop/);
  });

  it('renders the Dates bar and Ways home in French, wrapping rather than truncating', async () => {
    setLocale('fr');
    const unset = await render('LHR');
    expect(unset.text('[data-dates-bar] .dates__q')).toBe('Quand partez-vous?');
    expect(unset.text('[data-dates-pick]')).toBe('Choisir les dates');
    expect([...unset.el.querySelectorAll('.tabs button')].map(b => b.textContent!.trim())).toEqual(['Départs', 'Retours', 'Carte']);
    expect(unset.text('[data-ret-heading]')).toBe('Prochains vols de retour depuis London');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: PREFS_STORAGE, useValue: new MemoryStorage() }, { provide: NOW, useValue: () => NOW_MS }],
    });
    const { el, text } = await render('LHR', { dep: '2026-10-02' });
    expect(text('[data-dates-text]')).toBe('Départ le ven. 2 oct. · choisissez le retour');
    expect(el.querySelector('[data-dates-clear]')!.getAttribute('aria-label')).toBe('Effacer les dates');
    const chip = el.querySelector('app-stay-chips [data-nights="4"]')!;
    expect(chip.textContent!.replace(/[\s\u00a0\u202f]+/g, ' ').trim()).toBe('4 nuits mar. 6 · 1 retour');
    expect(text('[data-from]')).toBe('À partir du ven. 2 oct.');
    expect(text('[data-ret-heading]')).toMatch(/^Départs de LHR après l'arrivée \(sam\. 3 oct\. /);
    for (const node of [el.querySelector('[data-dates-bar]')!, ...el.querySelectorAll('[data-dates-bar] *')]) {
      expect(getComputedStyle(node).textOverflow).not.toBe('ellipsis');
    }
    const bar = await render('LHR', { dep: '2026-10-02', ret: '2026-10-10' });
    expect(bar.text('[data-dates-text]')).toBe('2–10 oct. · 8 nuits');
    expect(bar.text('[data-dates-see]')).toBe('Voir les vols');
  });
});
