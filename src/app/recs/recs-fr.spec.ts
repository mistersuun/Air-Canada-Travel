import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetScheduleSource, setScheduleSource } from '../data/schedule-index';
import { setLocale } from '../i18n/locale';
import { decodeClimate, packingFacts, typicalForMonths, wetDaysText } from './climate';
import { RecInput, holidayGroupParts, recommend, shortDuration, whyText } from './engine';
import { weatherText } from './forecast';
import { holidayName } from './long-weekends';
import { EMPTY_PROFILE, daysRange, joinAnd, profileSummary, usualSuggestions } from './profile';
import { CLIMATE_FIXTURE } from './testing/climate-fixture';
import { RECS_META, RECS_NOW, RECS_PROFILE, RECS_ROUTES, RECS_TODAY } from './testing/recs-fixture';

const nbsp = (s: string) => s.replace(/[  ]/g, ' ');

function input(over: Partial<RecInput> = {}): RecInput {
  return {
    profile: RECS_PROFILE, hub: 'YUL', todayKey: RECS_TODAY, nowMs: RECS_NOW,
    favourites: ['OPO'], outcomes: [], activeGoalCodes: [],
    climate: decodeClimate(CLIMATE_FIXTURE), showConnections: true, connect: {}, context: 'explore', fmt: '24h',
    ...over,
  };
}

beforeEach(() => {
  setScheduleSource(RECS_ROUTES, RECS_META);
  setLocale('fr');
});
afterEach(() => {
  resetScheduleSource();
  setLocale('en');
});

describe('recommendations in French', () => {
  it('titles, dates, fact lines and reasons are in French', () => {
    const groups = recommend(input());
    const lw = groups[0];
    expect(nbsp(lw.title)).toBe('Action de grâce : longue fin de semaine, dans 8 jours');
    expect(nbsp(lw.name!)).toBe('Action de grâce : longue fin de semaine');
    expect(lw.when).toBe('dans 8 jours');
    expect(lw.aside).toBe('ven. 9 oct. → lun. 12 oct.');
    expect(nbsp(lw.items[0].lines.map(l => l.text).join(' | '))).toBe("6 vols à l'aller ven. · 6 au retour lun. | Environ 1 h 30 dans chaque sens");
    expect(nbsp(whyText(lw.items[0]))).toContain('Lundi férié. Vous voyagez');
    expect(groups.map(g => g.title)).toContain('La saison se termine bientôt');
    const more = groups.find(g => g.id === 'more')!;
    expect(more.title).toBe('Autres idées pour vous');
    expect(nbsp(more.items[0].lines[0].text)).toBe('AC870 21:35 la plupart des soirs · environ 6 h 45');
    expect(nbsp(whyText(more.items[0]))).toBe('Style correspondant : Ville, vol de moins de 7 h.');
  });

  it('keeps today and tomorrow apart from "dans N jours"', () => {
    expect(holidayGroupParts('Thanksgiving', '2026-10-11', '2026-10-12').when).toBe('demain');
    expect(holidayGroupParts('Thanksgiving', '2026-10-12', '2026-10-12').when).toBe("aujourd'hui");
  });

  it('durations, summaries, holidays and typical weather', () => {
    expect(nbsp(shortDuration(395))).toBe('6 h 35');
    expect(nbsp(shortDuration(40))).toBe('40 min');
    expect(nbsp(profileSummary(RECS_PROFILE))).toBe("Ville, Soleil · longues fins de semaine · jusqu'à 7 h · jeu.–lun.");
    expect(profileSummary(EMPTY_PROFILE)).toBe('Non configuré');
    expect(daysRange([1, 4, 5, 6, 7], ' au ')).toBe('jeu. au lun.');
    expect(joinAnd(['Ville', 'Soleil', 'Aventure'])).toBe('Ville, Soleil et Aventure');
    expect(holidayName('Victoria Day')).toBe('Fête de la Reine');
    expect(holidayName('Fête nationale')).toBe('Fête nationale');
    expect(weatherText(61, 70)).toBe('pluie probable');
    expect(weatherText(81, 30)).toBe('averses possibles');
    expect(wetDaysText(0)).toBe('aucun jour de précipitations');
    const cl = decodeClimate(CLIMATE_FIXTURE);
    expect(typicalForMonths(cl, 'FLL', [10, 11])!.text).toContain('Typiquement');
    expect(packingFacts(cl, 'OPO', [11, 12])[0].title).toMatch(/^Imperméable — précipitations environ \d+ jours sur 30 en nov\.$/);
    expect(usualSuggestions()[0]).toBe('Vêtements de rechange dans le bagage à main');
  });
});
