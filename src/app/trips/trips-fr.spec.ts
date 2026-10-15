/**
 * French rendering of the Trips area (docs/i18n.md): the pure models call t(),
 * so a locale switch is all it takes. English output is covered by the
 * existing specs next to each file.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { setLocale } from '../i18n/locale';
import { catalogue } from '../i18n/t';
import { aroundEarthLabel, recapLine } from '../logbook/logbook';
import { milestoneLabel } from '../logbook/milestones';
import { compactSummary, countdown, partyLabel, tripDatesLabel, tripSubtitle } from '../pages/trips/trips-model';
import { triesMeter } from '../pages/trips/return/tries-meter';
import { buildReturnView } from '../pages/trips/return/return-model';
import { missRows } from '../pages/trips/return/miss-chain.component';
import { toUtcMs } from '../utils/time';
import { holidayDisplayName, holidayNote, holidaysIn } from './engine/holidays';
import { historyText, recordTag } from './engine/track-record';
import { buildTripIcs } from './engine/trip-ics';
import { LEG_STATUS_LABEL, OUTCOME_LABEL, PROVENANCE_LABEL } from './model';
import { SEVILLE_IDS, SEVILLE_META, SEVILLE_ROUTES, sevilleTrip } from './testing/seville-fixture';
import { statusLine } from '../live/flight-status';
import { eventLine, weekLabel } from '../events/events';

const nbsp = (s: string) => s.replace(/[  ]/g, ' ');
const yul = (key: string, hhmm: string) => toUtcMs(key, hhmm, 'America/Toronto');

describe('Trips in French', () => {
  beforeEach(() => {
    setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
    setLocale('fr');
  });
  afterEach(() => {
    setLocale('en');
    resetScheduleSource();
  });

  it('labels statuses, provenance and outcomes (maps follow the language)', () => {
    expect(LEG_STATUS_LABEL.checkedIn).toBe('Enregistré');
    expect(PROVENANCE_LABEL.saved).toBe('Enregistré par vous');
    expect(OUTCOME_LABEL.allBoarded).toBe('Tout le monde a embarqué');
    setLocale('en');
    expect(LEG_STATUS_LABEL.checkedIn).toBe('Checked in');
  });

  it('writes trip lines with French dates, plurals and counts', () => {
    const t = sevilleTrip();
    expect(nbsp(tripDatesLabel(t))).toBe('jeu. 8 oct. → de retour au plus tard le mar. 13 oct., 22:00');
    expect(partyLabel(t.party)).toContain('2 voyageurs');
    expect(partyLabel({ ...t.party, count: 1 })).toBe('1 voyageur');
    expect(compactSummary(t)).toBe('4 segments · 2 vols de rechange');
    expect(tripSubtitle(t)).toContain('2 voyageurs');
    expect(countdown(t, yul('2026-09-30', '12:00')).text).toBe('Dans 8 jours');
    expect(countdown(t, yul('2026-10-07', '12:00')).text).toBe('Demain');
    expect(countdown(t, yul('2026-10-13', '22:01')).text).toBe('Terminé');
  });

  it('writes the miss-one chain and the tries meter in French', () => {
    const v = buildReturnView(sevilleTrip(), { minConnect: 60 });
    const rows = missRows(v.steps);
    expect(rows[0].title.startsWith('Premier vol · AC813')).toBe(true);
    expect(rows[0].lines[0]).toContain('avec');
    expect(v.chainTitle).toMatch(/^Si vous tentez /);
    expect(triesMeter(1).label).toBe('1 vol restant pour rentrer');
    expect(triesMeter(3).label).toBe('3 vols restants pour rentrer');
  });

  it('counts your own record without odds', () => {
    expect(nbsp(historyText({ tried: 4, boarded: 3, partial: 1 }))).toBe('tentés : 4, embarqués : 3 (1 en partie)');
    expect(nbsp(recordTag({ tried: 4, boarded: 3, partial: 0 })!)).toBe('vous : 3/4');
  });

  it('names holidays in French, with the province list and the weekend note', () => {
    expect(holidayDisplayName(holidaysIn(2026).find(h => h.name === 'Thanksgiving' && h.region === 'CA')!)).toBe('Action de grâce (Canada)');
    expect(holidayDisplayName(holidaysIn(2026).find(h => h.name === 'Family Day')!)).toBe('Fête de la famille (ON, BC, AB, SK, NB)');
    expect(holidayNote('2026-10-09')).toContain('Action de grâce (Canada), fin de semaine');
    expect(holidayNote('2026-06-23')).toContain('Fête nationale (QC');
  });

  it('writes the calendar file in French but keeps the field names', () => {
    const ics = buildTripIcs(sevilleTrip(), yul('2026-10-01', '09:00'));
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('SUMMARY:En attente (provisoire) · AC834 YUL→MAD');
    expect(ics).toContain('STATUS:TENTATIVE');
  });

  it('writes live status, events and the logbook in French', () => {
    const s = {
      ident: 'AC834', status: 'Scheduled', cancelled: false, diverted: false,
      dep: { scheduled: '2026-10-08T21:55:00Z', estimated: '2026-10-08T22:35:00Z', actual: null, gate: 'D32', terminal: null },
      arr: { scheduled: null, estimated: null, actual: null, gate: null, terminal: null },
      inbound: null, aircraft: null, fetchedAt: new Date(yul('2026-10-08', '17:00')).toISOString(), source: 'FlightAware' as const,
    };
    const line = statusLine(s, 'YUL', yul('2026-10-08', '17:02'), '24h');
    expect(line.text).toBe('Estimé à 18:35 (+40) · Porte D32');
    expect(nbsp(line.source)).toBe('Source : FlightAware, il y a 2 min');
    expect(weekLabel([{ from: '2026-10-05', to: '2026-10-11' }])).toMatch(/^Semaine du /);
    expect(eventLine({ name: 'Coldplay', url: 'https://x', date: '2026-10-10', time: null, venue: '', segment: '', rescheduled: true }))
      .toContain('reporté');
    expect(milestoneLabel('transatlantic')).toBe('Premier vol transatlantique');
    expect(nbsp(recapLine({ flights: 1, km: 5215, countries: 2 }))).toBe('1 vol · 5 215 km · 2 pays');
    expect(aroundEarthLabel(0.31)).toBe('0,3 × le tour de la Terre');
  });

  it('has a French and an English message behind every dynamic holiday key', () => {
    setLocale('en');
    expect(Object.keys(catalogue('en')).filter(k => k.startsWith('trips.holiday.')).length).toBeGreaterThan(20);
    for (const h of [...holidaysIn(2026), ...holidaysIn(2027)]) {
      const en = holidayDisplayName(h);
      expect(en.startsWith('trips.'), en).toBe(false);
      setLocale('fr');
      expect(holidayDisplayName(h).startsWith('trips.')).toBe(false);
      setLocale('en');
    }
    expect(catalogue('fr')['trips.defaultName']).toContain('{name}');
  });

  it('keeps the trip ids available for the fixture', () => {
    expect(SEVILLE_IDS.trip).toBeTruthy();
  });
});
