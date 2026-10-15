import { describe, expect, it } from 'vitest';
import { TYPE_WORDS, aliasWords, matchesAlias, splitWords } from './search-aliases';

const d = (code: string, iso2: string, type: 'Sun' | 'City' | 'Adventure' = 'City') => ({ code, iso2, type });

describe('splitWords', () => {
  it('lowercases, strips accents and reads hyphens, apostrophes and dots as spaces', () => {
    expect(splitWords("O'Hare")).toEqual(['o', 'hare']);
    expect(splitWords('Sea-Tac')).toEqual(['sea', 'tac']);
    expect(splitWords('  Saint-Exupéry  ')).toEqual(['saint', 'exupery']);
    expect(splitWords('St. Martin’s')).toEqual(['st', 'martin', 's']);
    expect(splitWords('')).toEqual([]);
  });
});

describe('aliasWords', () => {
  it('joins the airport aliases with the country synonyms, normalised', () => {
    const w = aliasWords(d('LHR', 'GB'));
    expect(w).toEqual(expect.arrayContaining(['heathrow', 'england', 'uk', 'britain']));
  });
  it('is empty for a destination with no aliases and a country with no synonyms', () => {
    expect(aliasWords(d('ZZZ', 'ZZ'))).toEqual([]);
  });
  it('is computed once per code and country', () => {
    expect(aliasWords(d('HNL', 'US'))).toBe(aliasWords(d('HNL', 'US')));
  });
});

describe('matchesAlias', () => {
  it('matches the start of an alias word, whole for words up to two letters', () => {
    expect(matchesAlias(d('HNL', 'US'), 'hawa')).toBe(true);
    expect(matchesAlias(d('HNL', 'US'), 'hi')).toBe(true);
    expect(matchesAlias(d('SEA', 'XX'), 'w')).toBe(false);
    expect(matchesAlias(d('SEA', 'XX'), 'wa')).toBe(true);
    expect(matchesAlias(d('SEA', 'XX'), 'tac')).toBe(true);
    expect(matchesAlias(d('LHR', 'GB'), 'uk')).toBe(true);
    expect(matchesAlias(d('ORD', 'US'), 'hare')).toBe(true);
  });
  it('uses the country synonyms', () => {
    expect(matchesAlias(d('CDG', 'FR'), 'united')).toBe(false);
    expect(matchesAlias(d('JFK', 'US'), 'america')).toBe(true);
    expect(matchesAlias(d('DXB', 'AE'), 'emirates')).toBe(true);
  });
  it('maps trip-type words to the destination type', () => {
    expect(TYPE_WORDS['beach']).toBe('Sun');
    expect(matchesAlias(d('PUJ', 'DO', 'Sun'), 'beach')).toBe(true);
    expect(matchesAlias(d('PUJ', 'DO', 'Sun'), 'culture')).toBe(false);
    expect(matchesAlias(d('PAR', 'FR', 'City'), 'culture')).toBe(true);
    expect(matchesAlias(d('ZZZ', 'ZZ', 'Adventure'), 'hiking')).toBe(true);
  });
  it('maps activity words to the snow destinations only', () => {
    expect(matchesAlias(d('GVA', 'CH'), 'ski')).toBe(true);
    expect(matchesAlias(d('DEN', 'US'), 'snowboard')).toBe(true);
    expect(matchesAlias(d('MIA', 'US'), 'ski')).toBe(false);
  });
  it('matches nothing for an unknown token', () => {
    expect(matchesAlias(d('LHR', 'GB'), 'zzzz')).toBe(false);
  });
});
