import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { resetScheduleSource, setScheduleSource, type SchedulesMeta } from '../../data/schedule-index';
import { rec, route } from '../../data/testing/schedule-fixtures';
import { setLocale } from '../../i18n/locale';
import { resetItinerariesMemo } from '../../planner/round-trip';
import { NOW } from '../../state/app-state.service';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { TRIPS_STORAGE } from '../../trips/storage';
import { PlanPage } from './plan.page';

const ROUTES = [
  route('YUL', 'LIS',
    rec('AC834', '22:10', '08:15', '2026-09-01', '2027-03-28', 'Mon,Wed,Fri,Sun', '333'),
    rec('AC832', '21:55', '08:00', '2026-09-01', '2027-03-28', 'Tue,Thu', '333'),
  ),
  route('LIS', 'YUL',
    rec('AC835', '07:10', '09:10', '2026-09-01', '2027-03-28', 'Mon,Tue,Wed,Thu,Fri,Sat', '333'),
    rec('AC837', '10:40', '12:40', '2026-09-01', '2027-03-28', 'Mon,Tue,Wed,Thu,Fri,Sat', '333'),
    rec('AC839', '13:00', '15:00', '2026-09-01', '2027-03-28', 'Mon,Tue,Wed,Thu,Fri,Sat', '333'),
  ),
];
const META: SchedulesMeta = { generatedAt: '2026-11-01T06:00:00Z', coverageFrom: '2026-09-01', coverageTo: '2027-03-28' };
/** Sat Nov 14 2026, 10:00 in Montréal. */
const CLOCK = Date.parse('2026-11-14T15:00:00Z');
/** No-break spaces read as plain spaces. */
const plain = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]+/g, ' ').trim();

describe('PlanPage in French', () => {
  beforeEach(() => {
    setScheduleSource(ROUTES, META);
    resetItinerariesMemo();
    const prefs = new MemoryStorage();
    prefs.setItem('ac.prefs.v1', JSON.stringify({ showConnections: false }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PREFS_STORAGE, useValue: prefs },
        { provide: TRIPS_STORAGE, useValue: new MemoryStorage() },
        { provide: NOW, useValue: () => CLOCK },
      ],
    });
    setLocale('fr');
  });
  afterEach(() => {
    setLocale('en');
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  async function render(p: Record<string, string>) {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(PlanPage);
    fixture.componentRef.setInput('code', 'LIS');
    for (const [k, v] of Object.entries(p)) fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return { el, text: (sel?: string) => plain((sel ? el.querySelector(sel) : el)?.textContent) };
  }

  it('renders the dates, sections, rule line and bar in Canadian French', async () => {
    const { el, text } = await render({ dep: '2026-11-20', ret: '2026-11-28', out: 'AC834' });
    expect(text('h1')).toBe('Aller-retour');
    expect(text('[data-dates]')).toContain('ven. 20 nov. → sam. 28 nov.');
    expect(text('[data-dates]')).toContain('8 nuits');
    expect(text('[data-change]')).toBe('Modifier');
    expect(text('#pl-out')).toBe('Vols aller · ven. 20 nov.');
    expect(text('#pl-home')).toBe('Retours · sam. 28 nov.');
    expect(text('[data-rule]')).toBe('Départ au moins 60 min après l’arrivée du AC834 (sam. 21 nov. 08:15)');
    expect(text('[data-side="out"]')).toBe('Aller · AC834 22:10');
    expect(text('[data-side="home"]')).toBe('Retour · à choisir (3)');
    expect(text('[data-start]')).toBe('Commencer un voyage');
    expect(el.querySelector('[role="region"]')!.getAttribute('aria-label')).toBe('Votre aller-retour');
    expect(text('[data-ics]')).toBe('Aller-retour .ics');
    // Times keep the schedule form (21:05, docs/i18n.md); the 12-hour preference would give 'p.m.'.
    expect(text()).not.toMatch(/Round trip|Flights out|Ways home|pick one|Start a trip|nights/);
  });

  it('says the carry notice and the stay question in French', async () => {
    const { text, el } = await render({ dep: '2026-11-19', out: 'AC834' });
    expect(text('[data-notice="carry"] p')).toBe('AC834 ne vole pas le jeu. 19 nov. · premier sans escale : AC832 21:55');
    expect(el.querySelector('[data-notice="carry"] p')!.textContent).toContain('\u00a0:');
    expect(text('#pl-home')).toBe('Quand revenez-vous?');
    expect(text('[data-side="home"]')).toBe('Retour · choisir un jour');
    expect(text('[data-dates]')).toContain('jeu. 19 nov. → choisir le retour');
  });
});
