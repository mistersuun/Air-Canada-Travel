import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { RecapOptions } from '../../share/recap-card';
import { pngHeader } from '../../share/testing/stub-canvas';
import { PREFS_STORAGE } from '../../state/prefs.service';
import { MemoryStorage } from '../../state/testing';
import { TRIPS_KEY, type Trip } from '../../trips/model';
import { TRIPS_STORAGE } from '../../trips/storage';
import { SEVILLE_IDS, sevilleTrip } from '../../trips/testing/seville-fixture';
import { RECAP_RENDERER, RecapPage } from './recap.page';
import { SHARE_ENV } from './trip-share.page';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const png = () => new NodeBlob([pngHeader(1080, 1100)], { type: 'image/png' }) as unknown as Blob;

function trip(returnStatus: 'boarded' | 'planned', outStatus: 'boarded' | 'notBoarded' = 'boarded'): Trip {
  const t = sevilleTrip();
  for (const l of t.legs) {
    if (l.kind !== 'flight') continue;
    l.status = l.role === 'return' ? returnStatus : outStatus;
  }
  return t;
}

async function render(t: Trip) {
  const trips = new MemoryStorage();
  trips.setItem(TRIPS_KEY, JSON.stringify({ schema: 1, trips: [t] }));
  const renderer = vi.fn(async (_t: Trip, _o: RecapOptions) => png());
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: TRIPS_STORAGE, useValue: trips },
      { provide: PREFS_STORAGE, useValue: new MemoryStorage() },
      { provide: RECAP_RENDERER, useValue: renderer },
      { provide: SHARE_ENV, useValue: () => ({ navigator: {}, document }) },
    ],
  });
  const fixture = TestBed.createComponent(RecapPage);
  fixture.componentRef.setInput('id', SEVILLE_IDS.trip);
  const el = fixture.nativeElement as HTMLElement;
  const stable = async () => { fixture.detectChanges(); await fixture.whenStable(); };
  await stable();
  return { el, renderer, stable };
}

describe('RecapPage', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:recap');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it('waits until the way home is boarded', async () => {
    const { el, renderer } = await render(trip('planned'));
    expect(el.querySelector('[data-not-ready]')).toBeTruthy();
    expect(el.querySelector('[data-share]')).toBeNull();
    expect(renderer).not.toHaveBeenCalled();
  });

  it('draws the card with the arc and standby record off, and says what is never added', async () => {
    const { el, renderer, stable } = await render(trip('boarded'));
    await vi.waitFor(async () => { await stable(); expect(el.querySelector('[data-preview] img')).toBeTruthy(); });
    expect(renderer.mock.calls[0][1]).toMatchObject({ arc: false, standbyRecord: false });
    expect((el.querySelector('[data-record]') as HTMLInputElement).checked).toBe(false);
    expect((el.querySelector('[data-arc]') as HTMLInputElement).checked).toBe(false);
    expect((el.querySelector('[data-preview] img') as HTMLImageElement).alt).toMatch(/^Trip recap\. 2 flights · /);
    expect(clean(el.querySelector('[data-never]')?.textContent)).toContain('Booking codes');
  });

  it('shows the standby record as a toggle with the tries, and redraws when it is switched on', async () => {
    const { el, renderer, stable } = await render(trip('boarded', 'notBoarded'));
    await vi.waitFor(async () => { await stable(); expect(el.querySelector('[data-preview] img')).toBeTruthy(); });
    expect(clean(el.querySelector('[data-record]')?.closest('label')?.textContent)).toContain('Boarded 1 of 2 tries');
    const sw = el.querySelector('[data-record]') as HTMLInputElement;
    sw.checked = true;
    sw.dispatchEvent(new Event('change'));
    await stable();
    await vi.waitFor(() => expect(renderer.mock.calls.at(-1)![1]).toMatchObject({ arc: false, standbyRecord: true }));
  });
});
