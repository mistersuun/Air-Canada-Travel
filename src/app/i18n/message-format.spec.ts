import { describe, expect, it } from 'vitest';
import { formatMessage, formatNumberIn, messageArgs } from './message-format';

describe('formatMessage', () => {
  it('returns plain text unchanged and fills arguments', () => {
    expect(formatMessage('Where to?', undefined, 'en-US')).toBe('Where to?');
    expect(formatMessage("aujourd'hui", undefined, 'fr-CA')).toBe("aujourd'hui");
    expect(formatMessage('From {hub} · {date}', { hub: 'YUL', date: 'Oct 14' }, 'en-US')).toBe('From YUL · Oct 14');
    expect(formatMessage('{n}× wk', { n: 6 }, 'en-US')).toBe('6× wk');
  });

  it('leaves a missing argument visible rather than blank', () => {
    expect(formatMessage('Hello {name}', {}, 'en-US')).toBe('Hello {name}');
  });

  it('picks English plural forms: one for 1 only', () => {
    const msg = '{n, plural, one {# try} other {# tries}} home';
    expect(formatMessage(msg, { n: 1 }, 'en-US')).toBe('1 try home');
    expect(formatMessage(msg, { n: 2 }, 'en-US')).toBe('2 tries home');
    expect(formatMessage(msg, { n: 0 }, 'en-US')).toBe('0 tries home');
  });

  it('picks French plural forms: one for 0 and 1', () => {
    const msg = '{n, plural, one {# essai} other {# essais}}';
    expect(formatMessage(msg, { n: 0 }, 'fr-CA')).toBe('0 essai');
    expect(formatMessage(msg, { n: 1 }, 'fr-CA')).toBe('1 essai');
    expect(formatMessage(msg, { n: 2 }, 'fr-CA')).toBe('2 essais');
  });

  it('prefers an exact =N case', () => {
    const msg = '{n, plural, =0 {Filter} one {Filter, # active} other {Filter, # active}}';
    expect(formatMessage(msg, { n: 0 }, 'en-US')).toBe('Filter');
    expect(formatMessage(msg, { n: 3 }, 'en-US')).toBe('Filter, 3 active');
  });

  it('selects by value, nests arguments, and falls back to other', () => {
    const msg = '{kind, select, starts {Starts {date}} other {Ends {date}}}';
    expect(formatMessage(msg, { kind: 'starts', date: 'Oct 2' }, 'en-US')).toBe('Starts Oct 2');
    expect(formatMessage(msg, { kind: 'pauses', date: 'Oct 2' }, 'en-US')).toBe('Ends Oct 2');
  });

  it('formats {n, number} for the locale', () => {
    expect(formatMessage('{n, number} flights', { n: 1234 }, 'en-US')).toBe('1,234 flights');
    expect(formatMessage('{n, number} vols', { n: 1234 }, 'fr-CA')).toBe(`${formatNumberIn('fr-CA', 1234)} vols`);
    expect(formatNumberIn('fr-CA', 1234)).toMatch(/^1\s234$/u);
  });

  it('rejects malformed messages', () => {
    expect(() => formatMessage('{n, plural, one {x}}', { n: 1 }, 'en-US')).toThrow(/other/);
    expect(() => formatMessage('{n', { n: 1 }, 'en-US')).toThrow();
  });
});

describe('messageArgs', () => {
  it('lists every argument, including those inside cases', () => {
    expect(messageArgs('Plain')).toEqual([]);
    expect(messageArgs('{city}: {n, plural, one {# try in {where}} other {# tries}}')).toEqual(['city', 'n', 'where']);
  });
});
