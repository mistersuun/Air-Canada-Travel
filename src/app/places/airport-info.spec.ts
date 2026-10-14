import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { HUBS } from '../data/destinations';
import type { Place } from '../trips/model';
import { airportEnd, groundEstimate, HEURISTIC_EXIT_MIN } from './ground';
import {
  airportInfo, cityOptionLabel, decodeAirportInfo, fastestToCityMin, setAirportInfo, terminalLabel,
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
    expect(fastestToCityMin('LHR')).toBe(15);
    expect(fastestToCityMin('XXX')).toBeNull();
  });

  it('replaces the flat exit allowance in the distance heuristic when known', () => {
    const to: Place = { id: 'gn-1', name: 'X', country: '', tz: null, lat: 43.2, lng: -75.5, iso2: 'US' };
    const from = airportEnd('BOS')!;
    expect(groundEstimate(from, to).exitMin).toBe(HEURISTIC_EXIT_MIN);
    setAirportInfo(decodeAirportInfo(file));
    const g = groundEstimate(from, to);
    expect(g.exitMin).toBe(15);
    expect(g.exitLabel).toBe('Airport to city centre (typical)');
    expect(g.totalMin).toBe(15 + g.rideMin!);
  });
});
