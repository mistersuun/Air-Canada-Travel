import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { FlightStatusService, STATUS_FETCH } from './flight-status.service';
import { agoLabel, depIso, inStatusWindow, parseStatus, pollDelay, shouldPoll, statusLine, type FlightStatus } from './flight-status';

const H = 3_600_000;
const NOW = Date.parse('2026-10-06T18:00:00Z');
const DEP = Date.parse('2026-10-06T21:55:00Z');

const status: FlightStatus = {
  ident: 'AC834', status: 'Scheduled', cancelled: false, diverted: false,
  dep: { scheduled: '2026-10-06T21:55:00Z', estimated: '2026-10-06T22:35:00Z', actual: null, gate: 'D32', terminal: null },
  arr: { scheduled: null, estimated: null, actual: null, gate: null, terminal: null },
  inbound: { ident: 'AC811', landed: '2026-10-06T17:52:00Z', estimatedIn: null },
  aircraft: 'A333', fetchedAt: new Date(NOW - 2 * 60_000).toISOString(), source: 'FlightAware',
};

describe('inStatusWindow', () => {
  it('is -12h..+36h', () => {
    expect(inStatusWindow(NOW - 12 * H, NOW)).toBe(true);
    expect(inStatusWindow(NOW - 13 * H, NOW)).toBe(false);
    expect(inStatusWindow(NOW + 36 * H, NOW)).toBe(true);
    expect(inStatusWindow(NOW + 37 * H, NOW)).toBe(false);
  });
});

describe('statusLine', () => {
  it('states reported facts with delay, gate, inbound and source', () => {
    const l = statusLine(status, 'YUL', NOW, '24h');
    expect(l.text).toBe('Estimated 18:35 (+40) · Gate D32 · Inbound AC811 landed 13:52');
    expect(l.source).toBe('FlightAware, 2 min ago');
    expect(l.cancelled).toBe(false);
  });
  it('shows Cancelled and departed times', () => {
    expect(statusLine({ ...status, cancelled: true }, 'YUL', NOW, '24h')).toMatchObject({ cancelled: true, text: 'Cancelled' });
    expect(statusLine({ ...status, dep: { ...status.dep, actual: '2026-10-06T22:00:00Z' }, inbound: null }, 'YUL', NOW, '24h').text).toBe('Departed 18:00 · Gate D32');
  });
  it('agoLabel', () => {
    expect(agoLabel(new Date(NOW).toISOString(), NOW)).toBe('just now');
    expect(agoLabel(new Date(NOW - 65 * 60_000).toISOString(), NOW)).toBe('1 h 5 min ago');
  });
});

describe('polling', () => {
  it('depIso is minute precision UTC', () => expect(depIso(DEP)).toBe('2026-10-06T21:55Z'));
  it('every 30 min until 6h out, 5 min within, and never past the 6h mark', () => {
    expect(pollDelay(NOW + 20 * H, NOW)).toBe(30 * 60_000);
    expect(pollDelay(NOW + 6 * H, NOW)).toBe(5 * 60_000);
    expect(pollDelay(NOW + 6 * H + 600_000, NOW)).toBe(601_000);
  });
  it('stops 30 min after departure or after arrival', () => {
    expect(shouldPoll(null, NOW)).toBe(true);
    expect(shouldPoll(status, NOW)).toBe(true);
    const out = { ...status, dep: { ...status.dep, actual: new Date(NOW - 31 * 60_000).toISOString() } };
    expect(shouldPoll(out, NOW)).toBe(false);
    expect(shouldPoll({ ...out, dep: { ...out.dep, actual: new Date(NOW - 10 * 60_000).toISOString() } }, NOW)).toBe(true);
    expect(shouldPoll({ ...status, arr: { ...status.arr, actual: new Date(NOW).toISOString() } }, NOW)).toBe(false);
  });
  it('a visibility refresh is skipped when the last success is under 2 minutes old', async () => {
    sessionStorage.clear();
    const calls: string[] = [];
    TestBed.configureTestingModule({ providers: [{ provide: STATUS_FETCH, useValue: async (u: string) => { calls.push(u); return { status: 200, body: status }; } }] });
    const svc = TestBed.inject(FlightStatusService);
    await svc.refresh('AC834', 'YUL', DEP);
    await svc.refresh('AC834', 'YUL', DEP, 2 * 60_000);
    expect(calls.length).toBe(1);
  });
});

describe('parseStatus', () => {
  it('accepts the function output and rejects junk', () => {
    expect(parseStatus(JSON.parse(JSON.stringify(status)))).toEqual(status);
    expect(parseStatus(null)).toBeNull();
    expect(parseStatus('<html>')).toBeNull();
    expect(parseStatus({ ...status, source: 'x' })).toBeNull();
  });
});

describe('FlightStatusService', () => {
  function setup(res: { status: number; body: unknown } | Error) {
    const calls: string[] = [];
    TestBed.configureTestingModule({
      providers: [{ provide: STATUS_FETCH, useValue: async (u: string) => { calls.push(u); if (res instanceof Error) throw res; return res; } }],
    });
    return { svc: TestBed.inject(FlightStatusService), calls };
  }
  it('stores a good result, sends only ident and date', async () => {
    sessionStorage.clear();
    const { svc, calls } = setup({ status: 200, body: status });
    await svc.refresh('AC834', 'YUL', DEP);
    expect(calls).toEqual(['/.netlify/functions/flight-status?ident=AC834&origin=YUL&dep=2026-10-06T21%3A55Z']);
    expect(svc.entry('AC834', 'YUL', DEP)?.data?.dep.gate).toBe('D32');
    expect(sessionStorage.getItem('ac.flightstatus.v1')).toContain('D32');
  });
  it('backs off on 502 too', async () => {
    sessionStorage.clear();
    const { svc, calls } = setup({ status: 502, body: { error: 'upstream' } });
    await svc.refresh('AC834', 'YUL', DEP);
    await svc.refresh('AC834', 'YUL', DEP);
    expect(calls.length).toBe(1);
  });
  it('fails quietly on 503 and backs off; a thrown error is quiet too', async () => {
    sessionStorage.clear();
    const { svc, calls } = setup({ status: 503, body: { error: 'not-configured' } });
    await svc.refresh('AC834', 'YUL', DEP);
    await svc.refresh('AC834', 'YUL', DEP);
    expect(calls.length).toBe(1);
    expect(svc.entry('AC834', 'YUL', DEP)).toEqual({ data: null, failed: true });
    TestBed.resetTestingModule();
    const t = setup(new Error('offline'));
    await t.svc.refresh('AC1', 'YUL', DEP);
    expect(t.svc.entry('AC1', 'YUL', DEP)?.failed).toBe(true);
  });
});
