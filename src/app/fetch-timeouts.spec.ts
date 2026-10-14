import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSchedules } from './data/schedule-index';
import { loadRouteNetwork } from './data/route-network';
import { EVENTS_FETCH } from './events/events.service';
import { STATUS_FETCH } from './live/flight-status.service';
import { AIRPORT_HOTELS_FETCH } from './places/airport-hotels';
import { CITIES_FETCH } from './places/city-index.service';
import { GROUND_FETCH } from './places/ground-timetable.service';
import { FORECAST_FETCH, FORECAST_STORAGE, ForecastService } from './recs/forecast.service';
import { REFERENCE_FETCH } from './reference/reference.service';
import { LAND_FETCH } from './state/geo.service';
import { PHOTO_FETCH } from './state/photo.service';
import { NOW } from './state/app-state.service';

/** A fetch that never answers until its signal aborts, like a stalled connection. */
function stalledFetch() {
  return vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
    init?.signal?.addEventListener('abort', () => rej(init.signal!.reason));
  }));
}

describe('fetch timeouts', () => {
  beforeEach(() => { vi.useFakeTimers(); TestBed.resetTestingModule(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('small-file factories reject (retryable) after 10s instead of resolving null', async () => {
    const f = stalledFetch();
    vi.stubGlobal('fetch', f);
    for (const call of [
      () => TestBed.inject(REFERENCE_FETCH)('fx'),
      () => TestBed.inject(GROUND_FETCH)(),
      () => TestBed.inject(AIRPORT_HOTELS_FETCH)(),
      () => TestBed.inject(LAND_FETCH)(),
      () => TestBed.inject(PHOTO_FETCH)('x'),
      () => TestBed.inject(CITIES_FETCH)(),
      () => TestBed.inject(EVENTS_FETCH)('/e'),
      () => TestBed.inject(STATUS_FETCH)('/s'),
      () => TestBed.inject(FORECAST_FETCH)('/f'),
    ]) {
      const settled = call().then(() => 'resolved', () => 'rejected');
      await vi.advanceTimersByTimeAsync(20_001);
      expect(await settled).toBe('rejected');
    }
  });

  it('a body read cut off by the timeout is a rejection, not "missing"', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => { throw timeout; } }));
    await expect(TestBed.inject(REFERENCE_FETCH)('fx')).rejects.toBe(timeout);
    await expect(TestBed.inject(GROUND_FETCH)()).rejects.toBe(timeout);
    await expect(TestBed.inject(FORECAST_FETCH)('/f')).rejects.toBe(timeout);
    await expect(TestBed.inject(STATUS_FETCH)('/s')).rejects.toBe(timeout);
  });

  it('plain bad JSON is still final (null)', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }));
    expect(await TestBed.inject(REFERENCE_FETCH)('fx')).toBeNull();
  });

  it('schedules and route network give up after 20s and resolve false', async () => {
    vi.stubGlobal('fetch', stalledFetch());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const a = loadSchedules('x.json');
    const b = loadRouteNetwork('y.json');
    await vi.advanceTimersByTimeAsync(19_999);
    let done = false;
    void Promise.all([a, b]).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await a).toBe(false);
    expect(await b).toBe(false);
  });

  it('forecast: a stalled fetch settles the pending promise on timeout and can be asked again', async () => {
    vi.stubGlobal('fetch', stalledFetch());
    TestBed.configureTestingModule({
      providers: [
        { provide: FORECAST_STORAGE, useValue: null },
        { provide: NOW, useValue: () => Date.now() },
      ],
    });
    const svc = TestBed.inject(ForecastService);
    const p = svc.ensure('YYZ');
    await vi.advanceTimersByTimeAsync(10_001);
    await expect(p).resolves.toBeUndefined();
    expect(svc.days()['YYZ']).toBeUndefined();
    // Not stuck in `pending`: after the retry delay a new request is made.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const f = stalledFetch();
    vi.stubGlobal('fetch', f);
    void svc.ensure('YYZ');
    await vi.advanceTimersByTimeAsync(0);
    expect(f).toHaveBeenCalledOnce();
  });
});
