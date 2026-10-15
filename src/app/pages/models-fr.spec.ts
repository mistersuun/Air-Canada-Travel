/**
 * Canadian French renderings of the destination, flight, calendar, map, saved
 * and weekend models, the shared UI labels and the share text (chunk C of
 * docs/i18n.md). English is covered by each model's own spec.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { FIXTURE_META, FIXTURE_ROUTES } from '../data/testing/schedule-fixtures';
import { setLocale } from '../i18n/locale';
import { RECS_META, RECS_ROUTES } from '../recs/testing/recs-fixture';
import { SEVILLE_TRIP } from '../trips/testing/seville-fixture';
import { dotsLabel } from '../ui/dot-row.component';
import { formatWeekLabel } from '../utils/week';
import { airportName } from '../utils/airports';
import { seatsLabel, aircraftCompact } from '../utils/aircraft';
import { formatKm } from '../utils/geo';
import { buildIcs } from '../utils/ics';
import { toUtcMs } from '../utils/time';
import { routeFactDetail, routeFactNoteOn, routeOnlyNote } from '../data/route-network';
import { currencyName } from './destination/currency';
import { dailyFact, distanceRankFact, extremeFact } from './destination/fun-facts';
import { destSummary, placeLabel, timelineDay } from './destination/dest-model';
import { frequencyLabel, agoLabel } from './flight/flight-model';
import { nightsLabel, rangeLabel, selectLabel } from './calendar/cal-model';
import { itemMeta } from './map/map-model';
import { cardMeta, watchingMeta } from './saved/saved-model';
import { presetWindow, weekendMeta, windowProblem } from './weekend/weekend-model';
import { shareFooter, shareSubtitle, tripShareText } from '../share/trip-share-text';
import { advisoryUpdated, fxLine, holidayNote } from '../reference/reference';

const nb = (s: string) => s.replace(/[  ]/g, ' ');

afterEach(() => setLocale('en'));

describe('shared UI in French', () => {
  it('words the weekday dots and the week label', () => {
    setLocale('fr');
    expect(dotsLabel(['on', 'off', 'on', 'connect', 'off', 'off', 'off'])).toBe('Vol lun., mer.; correspondances jeu.');
    expect(dotsLabel(['on', 'on', 'on', 'on', 'on', 'on', 'on'])).toBe('Vol tous les jours');
    expect(dotsLabel(['off', 'off', 'off', 'off', 'off', 'off', 'off'])).toBe('Aucun vol cette semaine');
    expect(nb(formatWeekLabel('2026-10-12'))).toBe('12–18 oct. 2026');
    expect(nb(formatWeekLabel('2026-12-28'))).toMatch(/^28 déc\. 2026 – 3 janv\. 2027$/);
  });

  it('formats distances and seats', () => {
    setLocale('fr');
    expect(nb(formatKm(10354.4))).toBe('10 354 km');
    expect(seatsLabel('789')).toBe('environ 298 places');
    expect(aircraftCompact('789')).toMatch(/298 places$/);
  });

  it('names currencies, the advisory date and holidays in French', () => {
    setLocale('fr');
    expect(currencyName('JP')).toBe('yen japonais');
    expect(advisoryUpdated({ level: 0, text: '', updated: '2026-09-30', url: '', regional: false }, '2026-10-07')).toBe('mis à jour le 30 sept.');
    expect(holidayNote({ date: '2026-10-12', name: 'x', localName: 'x', global: false })).toBe('Jour férié dans certaines régions');
    expect(fxLine('EUR', { date: '2026-10-03', source: 'ECB', rates: new Map([['EUR', 0.66]]) })!.text).toBe('1 CAD = 0,66 EUR');
  });
});

describe('destination model in French', () => {
  beforeEach(() => setScheduleSource(FIXTURE_ROUTES, FIXTURE_META));
  afterEach(() => resetScheduleSource());

  it('labels days, places and the summary', () => {
    setLocale('fr');
    expect(timelineDay('2026-10-01', '2026-10-01')).toBe("Aujourd'hui, 1 oct.");
    expect(timelineDay('2026-10-02', '2026-10-01')).toBe('ven., 2 oct.');
    expect(placeLabel('Japan', 'Asia & Pacific')).toBe('Japan · Asie et Pacifique');
    const s = destSummary('YUL', 'LHR', '2026-09-28', []);
    expect(nb(s.stops)).toMatch(/^Sans escale · \d+ h \d\d$/);
    expect(s.season).toBe("Toute l'année");
    expect(s.meta).toContain('× cette semaine');
  });

  it('words the daily facts', () => {
    setLocale('fr');
    const hub = { code: 'YYZ', lat: 43.68, lng: -79.63, tz: 'America/Toronto' };
    const pts = [
      { code: 'AAA', lat: 10, lng: -70, tz: 'UTC' }, { code: 'BBB', lat: 30, lng: -10, tz: 'UTC' },
      { code: 'CCC', lat: 50, lng: 10, tz: 'UTC' }, { code: 'DDD', lat: 60, lng: 30, tz: 'UTC' },
    ];
    expect(distanceRankFact(pts[3], hub, pts)).toBe('Le vol sans escale le plus long depuis YYZ');
    expect(distanceRankFact(pts[2], hub, pts)).toBe('2e plus long vol sans escale depuis YYZ');
    expect(extremeFact(pts[3], hub, pts)).toBe('La destination la plus au nord depuis YYZ');
    expect(dailyFact(pts[1], hub, pts, Date.UTC(2026, 5, 21, 12))).toMatch(/depuis YYZ|clarté/);
  });

  it('words route-only notes in French', () => {
    setLocale('fr');
    expect(routeOnlyNote()).toBe('dessert cette route · horaires absents de nos données');
    expect(routeFactNoteOn({ begins: '2027-06-16' } as never, '2026-10-02')).toBe('route en service à partir du 16 juin 2027');
    expect(routeFactDetail({ brands: ['express'], seasonal: true, begins: '2026-12-17' } as never)).toBe('Air Canada Express · Saisonnier · Début le 17 déc.');
  });
});

describe('flight and calendar models in French', () => {
  it('words frequency, time ago and the calendar labels', () => {
    setLocale('fr');
    expect(frequencyLabel(7)).toBe('Tous les jours');
    expect(nb(frequencyLabel(3))).toBe('3×/sem.');
    expect(agoLabel(0)).toBe("à l'instant");
    expect(agoLabel(25 * 60_000)).toBe('il y a 25 min');
    expect(agoLabel(3 * 3_600_000)).toBe('il y a 3 h');
    expect(nb(agoLabel(2 * 86_400_000))).toBe('il y a 2 jours');
    expect(nb(rangeLabel('2026-10-08', '2026-10-15'))).toBe('8–15 oct.');
    expect(nb(rangeLabel('2026-10-28', '2026-11-04'))).toBe('28 oct. – 4 nov.');
    expect(nightsLabel('2026-10-08', '2026-10-15')).toBe('7 nuits');
    expect(nb(selectLabel('2026-10-08', null))).toMatch(/^Choisir le .* · aller simple$/);
    expect(selectLabel(null, null)).toBe('Choisissez une date de départ');
  });

  it('words ICS text in French', () => {
    setLocale('fr');
    const ics = buildIcs({
      origin: 'YUL', dest: 'LHR', dateKey: '2026-10-07', arrDateKey: '2026-10-08', hubs: [], estimated: false,
      legs: [{
        flightNumber: 'AC864', origin: 'YUL', dest: 'LHR', dateKey: '2026-10-07', depLocal: '22:10', arrLocal: '10:00', arrDayOffset: 1,
        durationMin: 410, depUtc: Date.UTC(2026, 9, 8, 2, 10), arrUtc: Date.UTC(2026, 9, 8, 9, 0), estimated: false, aircraft: '789',
      }],
      layovers: [], totalMin: 410, departUtc: Date.UTC(2026, 9, 8, 2, 10), arriveUtc: Date.UTC(2026, 9, 8, 9, 0),
    } as never, 'Londres');
    expect(ics).toContain('Horaire seulement');
    expect(ics).toContain('Enregistrement ou inscription');
    expect(ics).toContain('heures locales');
  });
});

describe('map, saved and weekend models in French', () => {
  beforeEach(() => setScheduleSource(RECS_ROUTES, RECS_META));
  afterEach(() => resetScheduleSource());

  it('words map and saved metas', () => {
    setLocale('fr');
    expect(itemMeta({ kind: 'direct', durationMin: 330, count: 3 } as never)).toMatch(/3 cette semaine$/);
    expect(itemMeta({ kind: 'connect', durationMin: null, via: 'YYZ' } as never)).toBe('via YYZ');
    expect(itemMeta({ kind: 'connect', durationMin: null, via: null } as never)).toBe('Avec correspondance seulement');
    expect(watchingMeta({ dayKeys: [], days: '', direct: true })).toBe('Aucun vol cette semaine');
    expect(watchingMeta({ dayKeys: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], days: '', direct: true })).toBe('Tous les jours');
    expect(nb(cardMeta({
      flight: { flightNumber: 'AC912' }, weekDays: 3, thisWeek: true, endsOn: '22 oct.',
    } as never))).toBe('AC912 · 3× cette semaine · se termine le 22 oct.');
  });

  it('words the weekend finder in French', () => {
    setLocale('fr');
    const o = { tries: [1, 2, 3], directTries: 3, hoursThere: 40, out: [1, 2] } as never;
    expect(weekendMeta(o).replace(/ /g, ' ')).toBe('~40 h sur place · 3 essais pour rentrer · 2 à l\'aller');
    const w = presetWindow('this', '2026-10-06');
    expect(windowProblem({ ...w, leaveKey: 'x' }, 'YUL', toUtcMs('2026-10-06', '09:00', 'America/Toronto'))).toBe('Entrez une date et une heure');
    expect(windowProblem({ ...w, homeKey: '2026-10-01' }, 'YUL', toUtcMs('2026-10-06', '09:00', 'America/Toronto'))).toBe("L'heure de retour est passée");
  });
});

describe('share text in French', () => {
  it('writes the Seville plan in French', () => {
    setLocale('fr');
    const text = tripShareText(SEVILLE_TRIP, { includeSplitNote: true, includeBackups: true, fmt: '24h' });
    expect(text).toContain('(selon l\'horaire, en attente)');
    expect(text).toMatch(/Si nous nous séparons : /);
    expect(text).toMatch(/Vols de secours pour jeu\. : /);
    expect(text.endsWith(shareFooter())).toBe(true);
    expect(shareFooter()).toBe("Heures locales. Un plan d'attente, pas une réservation.");
    expect(nb(shareSubtitle(SEVILLE_TRIP))).toMatch(/· 2 voyageurs$/);
    expect(text).not.toMatch(/scheduled|standby|Backups|If we split up/);
    expect(airportName('YUL')).toBeTruthy();
  });
});
