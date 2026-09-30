import { describe, expect, it } from 'vitest';
import { flagFromIso2, getFlag } from './flags';

describe('flags', () => {
  it('builds flags from ISO codes', () => {
    expect(flagFromIso2('PT')).toBe('🇵🇹');
    expect(flagFromIso2('ae')).toBe('🇦🇪');
    expect(flagFromIso2('P')).toBe('');
    expect(flagFromIso2(null)).toBe('');
  });

  it('accepts a destination, an ISO code or a legacy country name', () => {
    expect(getFlag({ iso2: 'HN' })).toBe('🇭🇳');
    expect(getFlag('JP')).toBe('🇯🇵');
    expect(getFlag('UAE')).toBe('🇦🇪'); // was missing from the old name map
    expect(getFlag('Turks & Caicos')).toBe('🇹🇨');
    expect(getFlag('Canada')).toBe('🇨🇦');
    expect(getFlag('Atlantis')).toBe('');
    expect(getFlag(undefined)).toBe('');
  });
});
