import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../../data/schedule-index';
import { setLocale } from '../../i18n/locale';
import { reachGateways } from '../../places/reach';
import { SEVILLE_META, SEVILLE_PLACE, SEVILLE_ROUTES } from '../../trips/testing/seville-fixture';
import { arrivalLine, foundLabel, gatewayRow, groundDetail, groundTitle, lastTrainWarning, partOfDay } from './reach-model';

const nbsp = (s: string) => s.replace(/[  ]/g, ' ');
const reach = () => reachGateways({
  place: SEVILLE_PLACE, hub: 'YUL', dateKey: '2026-10-08', includeOtherHubs: false, sort: 'onward', connect: { minConnect: 60 },
});

beforeEach(() => {
  setScheduleSource(SEVILLE_ROUTES, SEVILLE_META);
  setLocale('fr');
});
afterEach(() => {
  resetScheduleSource();
  setLocale('en');
});

describe('reach model in French', () => {
  it('gateway rows, ground wording and the arrival line', () => {
    const { gateways } = reach();
    const rows = gateways.map(g => gatewayRow(g, '2026-10-08'));
    const mad = rows.find(r => r.code === 'MAD')!;
    expect(mad.flight).toBe('AC834 17:55 · 1 vol ce jour-là');
    expect(nbsp(mad.ground)).toBe('Train environ 2 h 40');
    const opo = rows.find(r => r.code === 'OPO')!;
    expect(nbsp(opo.idle!)).toMatch(/^Introuvable dans nos horaires le jeu\. 8 oct\. · prochain : ven\. 9 oct\.$/);
    const g = gateways.find(x => x.code === 'MAD')!;
    expect(groundTitle(g.ground, SEVILLE_PLACE)).toBe('Train vers Seville');
    expect(nbsp(groundDetail(g.ground))).toBe('environ 2 h 40 · trains environ toutes les heures');
    expect(nbsp(arrivalLine(SEVILLE_PLACE, g.arriveGoalUtc, 'Europe/Madrid'))).toBe('Seville vers midi, ven. 9 oct.');
    expect(partOfDay('23:00')).toBe('tard en soirée');
    expect(foundLabel('bus')).toBe("J'ai trouvé un autocar");
    expect(lastTrainWarning({ ...g, overnightLikely: true, lastDepMissed: false })).toBe('Vous arriveriez tard. Une nuit à Madrid est probable.');
  });
});
