import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { HUBS } from '../data/destinations';
import type { Place } from '../trips/model';
import { CORRIDOR_EXIT_MIN } from './corridors';
import { airportEnd, groundEstimate, HEURISTIC_EXIT_MIN } from './ground';
import {
  airportInfo, cityOptionLabel, decodeAirportInfo, fastestTransit, loungeLabel, setAirportInfo, terminalLabel,
} from './airport-info';

const file = JSON.parse(readFileSync('public/data/airport-info.json', 'utf8'));
afterEach(() => setAirportInfo(null));

describe('airport-info.json', () => {
  it('covers the 10 hubs and 25 destinations, each reviewed and sourced', () => {
    const index = decodeAirportInfo(file)!;
    expect(index.size).toBe(35);
    for (const h of HUBS) expect(index.has(h.code), h.code).toBe(true);
    for (const [code, a] of index) {
      expect(a.reviewed, code).toBe('2026-10');
      expect(a.source, code).not.toBe('');
      expect(a.toCity.length, code).toBeGreaterThan(0);
      for (const o of a.toCity) expect(o.min).toBeLessThan(120);
    }
  });

  it('decodes defensively', () => {
    expect(decodeAirportInfo(null)).toBeNull();
    expect(decodeAirportInfo({ airports: { XX: {} } })).toBeNull();
    const i = decodeAirportInfo({ airports: { YYZ: { terminals: ['1', 3], toCity: [{ mode: 'boat', min: 5, note: 'x' }, { mode: 'train', min: 25, note: 'UP' }] } } })!;
    expect(i.get('YYZ')).toMatchObject({ terminals: ['1'], mapleLeafLounge: null, toCity: [{ mode: 'train', min: 25, note: 'UP' }] });
  });

  it('labels terminals and options', () => {
    setAirportInfo(decodeAirportInfo(file));
    expect(terminalLabel(airportInfo('YYZ')!)).toBe('Terminal 1');
    expect(terminalLabel(airportInfo('YUL')!)).toBe('Single terminal');
    expect(terminalLabel(airportInfo('YVR')!)).toBe('Domestic and International terminals');
    expect(terminalLabel(airportInfo('BOS')!)).toBe('');
    expect(cityOptionLabel(airportInfo('FRA')!.toCity[0])).toBe('Train about 15 min · S-Bahn to Frankfurt Hauptbahnhof');
    expect(fastestTransit('LHR')).toMatchObject({ min: 15, mode: 'train' });
    expect(fastestTransit('FLL')).toBeNull();   // taxi only
    expect(fastestTransit('XXX')).toBeNull();
    expect(loungeLabel(airportInfo('YYZ')!)).toBe('Maple Leaf Lounge: yes');
    expect(loungeLabel(airportInfo('YQB')!)).toBe('Maple Leaf Lounge: no');
    expect(loungeLabel(airportInfo('YHZ')!)).toBe('Maple Leaf Lounge closed until early 2027');
    expect(loungeLabel(airportInfo('YOW')!)).toBe('Maple Leaf Lounge closed for renovation, reopening planned Nov 2026');
    expect(loungeLabel(airportInfo('YWG')!)).toBe('Maple Leaf Lounge: yes · By gate 9; not for transborder flights');
    expect(loungeLabel(airportInfo('FCO')!)).toBe('Maple Leaf Lounge: no');
  });

  it('keeps passport and exit, then adds the airport own public transport to a station (never a taxi)', () => {
    const far: Place = { id: 'gn-1', name: 'X', country: '', tz: null, lat: 43.2, lng: -75.5, iso2: 'US' };
    const from = airportEnd('BOS')!;
    expect(groundEstimate(from, far).exitMin).toBe(HEURISTIC_EXIT_MIN);
    setAirportInfo(decodeAirportInfo(file));
    const g = groundEstimate(from, far);
    expect(g.exitMin).toBe(CORRIDOR_EXIT_MIN + 25);
    expect(g.exitLabel).toBe('Passport, exit, then SL1 bus (free) to South Station (about 25 min)');
    expect(g.totalMin).toBe(g.exitMin + g.rideMin!);
    // FLL has only a taxi: no change.
    expect(groundEstimate(airportEnd('FLL')!, far).exitMin).toBe(HEURISTIC_EXIT_MIN);
  });

  it('a short hop keeps the flat passport allowance', () => {
    setAirportInfo(decodeAirportInfo(file));
    const near: Place = { id: 'gn-2', name: 'Y', country: '', tz: null, lat: 42.4, lng: -71.1, iso2: 'US' };
    const g = groundEstimate(airportEnd('BOS')!, near);
    expect(g.mode).toBe('car');
    expect(g).toMatchObject({ exitMin: HEURISTIC_EXIT_MIN, exitLabel: 'Passport and exit' });
  });
});
