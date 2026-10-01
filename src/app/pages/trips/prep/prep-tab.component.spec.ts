import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ScheduleRoute, resetScheduleSource, setScheduleSource } from '../../../data/schedule-index';
import { rec, route } from '../../../data/testing/schedule-fixtures';
import { buildPrepChecklist } from '../../../places/prep';
import { NOW } from '../../../state/app-state.service';
import { PREFS_STORAGE } from '../../../state/prefs.service';
import { MemoryStorage } from '../../../state/testing';
import { TRIPS_KEY, Trip } from '../../../trips/model';
import { TRIPS_STORAGE } from '../../../trips/storage';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, SEVILLE_TRIPS_FILE, sevilleTrip } from '../../../trips/testing/seville-fixture';
import { TripsService } from '../../../trips/trips.service';
import { toUtcMs } from '../../../utils/time';
import { PrepTabComponent } from './prep-tab.component';
import { detailParts, doneLabel, listingStatus, prepRow } from './prep-model';

const NOW_MS = toUtcMs('2026-10-01', '09:41', 'America/Toronto');
const FROM = '2026-09-29', TO = '2027-09-26';
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** The fixture with AC813 retimed to 11:10 → 13:35 in the "new" schedules. */
function retimed(): ScheduleRoute[] {
  return SEVILLE_ROUTES.map(r => (r.originCode === 'LIS' && r.destinationCode === 'YUL'
    ? route('LIS', 'YUL', rec('AC813', '11:10', '13:35', FROM, TO, 'Mon,Tue,Wed,Thu,Fri,Sat', '333')) : r));
}

let storage: MemoryStorage;
async function render(routes: ScheduleRoute[] = SEVILLE_ROUTES) {
  setScheduleSource(routes, SEVILLE_META);
  storage = new MemoryStorage();
  storage.setItem(TRIPS_KEY, JSON.stringify(SEVILLE_TRIPS_FILE));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: NOW, useValue: () => NOW_MS },
      { provide: TRIPS_STORAGE, useValue: storage },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
    ],
  });
  const svc = TestBed.inject(TripsService);
  const fixture = TestBed.createComponent(PrepTabComponent);
  fixture.componentRef.setInput('trip', svc.trip(SEVILLE_IDS.trip));
  await fixture.whenStable();
  const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const el = fixture.nativeElement as HTMLElement;
  const stable = async () => {
    fixture.componentRef.setInput('trip', svc.trip(SEVILLE_IDS.trip));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { el, svc, nav, stable };
}
const stored = (): Trip => JSON.parse(storage.getItem(TRIPS_KEY)!).trips[0];

describe('prep model', () => {
  afterEach(() => resetScheduleSource());

  it('puts the link where g7 shows it', () => {
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
    const items = buildPrepChecklist(sevilleTrip());
    const etias = detailParts(items.find(i => i.id === 'entry:etias')!);
    expect(etias).toEqual({ pre: '', link: { label: 'Official EU page', url: 'https://travel-europe.europa.eu/etias_en' }, post: ' · not required until it starts' });
    const pass = detailParts(items.find(i => i.id === 'entry:schengen-validity')!);
    expect(pass.pre).toBe('Schengen rule · Spain and Portugal · ');
    expect(pass.link?.label).toBe('Government of Canada advice');
    expect(prepRow(items.find(i => i.id.startsWith('ground:'))!).action.kind).toBe('leg');
    expect(prepRow(items.find(i => i.id.startsWith('list:'))!).action.kind).toBe('status');
    expect(doneLabel(items)).toBe('2 of 6 done');
  });

  it('ticks listing through the leg status and never undoes a later status', () => {
    const t = sevilleTrip();
    expect(listingStatus(t, SEVILLE_IDS.ret, true)).toBe('listed');
    expect(listingStatus(t, SEVILLE_IDS.outbound, false)).toBe('planned');
    const checked = { ...t, legs: t.legs.map(l => (l.id === SEVILLE_IDS.outbound ? { ...l, status: 'checkedIn' as const } : l)) };
    expect(listingStatus(checked, SEVILLE_IDS.outbound, false)).toBeNull();
  });
});

describe('PrepTabComponent (g7)', () => {
  afterEach(() => {
    resetScheduleSource();
    vi.restoreAllMocks();
  });

  it('shows the retimed AC813 card first; Accept updates the leg and removes the card', async () => {
    const { el, stable, svc } = await render(retimed());
    const card = el.querySelector('app-trip-changes [data-change]')!;
    expect(clean(card.textContent)).toContain('AC813 retimed in the new schedules');
    expect(clean(card.textContent)).toContain('Tue Oct 13: 11:25 → 11:10, lands 13:50 → 13:35. Still home by your deadline.');
    expect(clean(card.textContent)).not.toMatch(/cancel/i);
    // Nothing moved yet.
    expect(stored().legs.find(l => l.id === SEVILLE_IDS.ret)!.kind === 'flight'
      && (stored().legs.find(l => l.id === SEVILLE_IDS.ret) as { refs: { depLocal: string }[] }).refs[0].depLocal).toBe('11:25');
    (card.querySelector('[data-accept]') as HTMLButtonElement).click();
    await stable();
    expect(el.querySelector('app-trip-changes [data-change]')).toBeNull();
    const leg = svc.trip(SEVILLE_IDS.trip)!.legs.find(l => l.id === SEVILLE_IDS.ret)!;
    expect(leg.kind === 'flight' && leg.refs[0].depLocal).toBe('11:10');
  });

  it('"See backups" on a return leg opens the Return tab', async () => {
    const { el, nav } = await render(retimed());
    (el.querySelector('[data-backups]') as HTMLButtonElement).click();
    expect(nav).toHaveBeenCalledWith(['/trips', SEVILLE_IDS.trip], expect.objectContaining({
      queryParams: { tab: 'return', leg: null }, queryParamsHandling: 'merge',
    }));
  });

  it('lists "Before you go" with counts, Money and Time', async () => {
    const { el } = await render();
    expect(el.querySelector('app-trip-changes [data-change]')).toBeNull();
    expect(clean(el.querySelector('[data-count]')?.textContent)).toBe('2 of 6 done');
    const titles = [...el.querySelectorAll('.chk__t')].map(t => clean(t.textContent));
    expect(titles).toEqual([
      'Passports valid 3+ months after you leave', 'Check ETIAS status', 'Listed for AC834', 'List for AC813 home',
      'Find the Madrid → Seville train', 'Find the Seville → Lisbon bus',
    ]);
    expect(el.textContent).not.toMatch(/ESTA|eTA\b|UK ETA/);
    const link = el.querySelector('.chk__m a') as HTMLAnchorElement;
    expect(link.target).toBe('_blank');
    expect(clean(el.querySelector('[data-ess]')?.textContent)).toBe('MoneyEuroTime+6h vs Montréal');
  });

  it('ticks an entry item, lists a flight, opens a ground leg and adds an own item', async () => {
    const { el, stable, nav } = await render();
    const box = (id: string) => el.querySelector(`[data-item="${id}"] input`) as HTMLInputElement;
    box('entry:etias').click();
    await stable();
    expect(stored().prep['entry:etias'].done).toBe(true);
    box(`list:${SEVILLE_IDS.ret}:0`).click();
    await stable();
    expect(stored().legs.find(l => l.id === SEVILLE_IDS.ret)!.status).toBe('listed');
    box(`ground:${SEVILLE_IDS.train}`).click();
    await stable();
    expect(box(`ground:${SEVILLE_IDS.train}`).checked).toBe(false);
    expect(nav).toHaveBeenCalledWith(['/trips', SEVILLE_IDS.trip], expect.objectContaining({ queryParams: { tab: null, leg: SEVILLE_IDS.train } }));

    const input = el.querySelector('[data-add-input]') as HTMLInputElement;
    input.value = 'Pack the pass letter';
    input.dispatchEvent(new Event('input'));
    await stable();
    (el.querySelector('form.add') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await stable();
    expect(stored().customPrep.map(c => c.text)).toEqual(['Pack the pass letter']);
    expect(clean(el.querySelector('[data-count]')?.textContent)).toBe('4 of 7 done');
  });
});
