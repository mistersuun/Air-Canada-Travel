import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { FORECAST_FETCH, FORECAST_STORAGE } from '../../recs/forecast.service';
import { ForecastLineComponent } from '../../recs/ui/forecast-line.component';
import { NOW } from '../../state/app-state.service';
import { MemoryStorage } from '../../state/testing';
import { DestForecastComponent } from './dest-forecast.component';

const NOW_MS = Date.parse('2026-10-06T15:00:00Z');
const DAYS = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
const RAW = {
  daily: {
    time: DAYS, temperature_2m_max: [24, 23, 22, 21, 20, 19], temperature_2m_min: [17, 16, 15, 14, 13, 12],
    precipitation_probability_max: [80, 10, 10, 10, 10, 10], weathercode: [63, 1, 1, 2, 3, 0],
  },
};

function setup(fetcher: (url: string) => Promise<unknown>) {
  TestBed.configureTestingModule({
    providers: [
      { provide: NOW, useValue: () => NOW_MS },
      { provide: FORECAST_FETCH, useValue: fetcher },
      { provide: FORECAST_STORAGE, useValue: new MemoryStorage() },
    ],
  });
}

describe('DestForecastComponent', () => {
  it('shows a labelled 5-day strip with attribution when the day is within 16 days', async () => {
    const f = vi.fn(async (_url: string) => RAW);
    setup(f);
    const fx = TestBed.createComponent(DestForecastComponent);
    fx.componentRef.setInput('code', 'LIS');
    fx.componentRef.setInput('dateKey', '2026-10-06');
    await fx.whenStable();
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    await fx.whenStable();
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.d')).toHaveLength(5);
    expect(el.textContent).toContain('Forecast');
    expect(el.textContent).toContain('rain likely');
    expect(el.querySelector('a[href="https://open-meteo.com/"]')).toBeTruthy();
    expect(el.textContent).toContain('CC BY 4.0');
  });

  it('shows nothing and makes no request beyond 16 days, or when the request fails', async () => {
    const f = vi.fn(async (_url: string) => { throw new Error('offline'); });
    setup(f);
    const far = TestBed.createComponent(DestForecastComponent);
    far.componentRef.setInput('code', 'LIS');
    far.componentRef.setInput('dateKey', '2026-12-25');
    await far.whenStable();
    expect(f).not.toHaveBeenCalled();
    expect((far.nativeElement as HTMLElement).textContent?.trim()).toBe('');
    const near = TestBed.createComponent(DestForecastComponent);
    near.componentRef.setInput('code', 'LIS');
    near.componentRef.setInput('dateKey', '2026-10-08');
    await near.whenStable();
    await vi.waitFor(() => expect(f).toHaveBeenCalled());
    await near.whenStable();
    expect((near.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });
});

describe('ForecastLineComponent', () => {
  it('reads "Forecast · 24° / 17° · rain likely" for the day', async () => {
    const f = vi.fn(async (_url: string) => RAW);
    setup(f);
    const fx = TestBed.createComponent(ForecastLineComponent);
    fx.componentRef.setInput('code', 'LIS');
    fx.componentRef.setInput('dateKey', '2026-10-06');
    await fx.whenStable();
    await vi.waitFor(() => expect(f).toHaveBeenCalled());
    await fx.whenStable();
    expect((fx.nativeElement as HTMLElement).textContent).toMatch(/Forecast · 24° \/ 17° · rain likely\s+Open-Meteo/);
  });
});
