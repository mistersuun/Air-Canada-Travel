import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { AppStateService } from '../state/app-state.service';
import { LiveStatusComponent } from './live-status.component';
import { STATUS_FETCH } from './flight-status.service';
import { depIso, type FlightStatus } from './flight-status';

function setup(over: Partial<FlightStatus> = {}) {
  sessionStorage.clear();
  const calls: string[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: STATUS_FETCH,
        useValue: async (u: string) => {
          calls.push(u);
          const status: FlightStatus = {
            ident: 'AC834', status: 'Scheduled', cancelled: false, diverted: false,
            dep: { scheduled: null, estimated: null, actual: null, gate: 'D32', terminal: null },
            arr: { scheduled: null, estimated: null, actual: null, gate: null, terminal: null },
            inbound: null, aircraft: null, fetchedAt: new Date().toISOString(), source: 'FlightAware', ...over,
          };
          return { status: 200, body: status };
        },
      },
    ],
  });
  const state = TestBed.inject(AppStateService);
  const fixture = TestBed.createComponent(LiveStatusComponent);
  fixture.componentRef.setInput('flightNumber', 'AC834');
  fixture.componentRef.setInput('origin', 'YUL');
  fixture.componentRef.setInput('depUtc', state.nowMs() + 3 * 3_600_000);
  return { fixture, state, calls };
}

describe('LiveStatusComponent', () => {
  it('asks once, and clock ticks do not re-run the loop or fetch again', async () => {
    const { fixture, state, calls } = setup();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(calls.length).toBe(1);
    for (let i = 0; i < 3; i++) {
      state.nowMs.set(state.nowMs() + 30_000);
      fixture.detectChanges();
      await fixture.whenStable();
    }
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('origin=YUL');
    expect(calls[0]).toContain(`dep=${encodeURIComponent(depIso(fixture.componentInstance.depUtc()))}`);
  });

  it('shows Cancelled with a Return-tab link that is a real URL, not an encoded string', async () => {
    const { fixture } = setup({ cancelled: true });
    fixture.componentRef.setInput('recoverLink', ['/trips', 'abc']);
    fixture.componentRef.setInput('recoverParams', { tab: 'return' });
    fixture.componentRef.setInput('recoverLabel', 'See ways home');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-live-status]')?.textContent).toContain('Cancelled');
    const a = el.querySelector('a')!;
    expect(a.textContent).toContain('See ways home');
    expect(a.getAttribute('href')).toBe('/trips/abc?tab=return');
  });
});
