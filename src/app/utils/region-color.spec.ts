import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { KNOWN_REGION_SLUGS, regionSlug, regionVar } from './region-color';
import { REGIONS } from '../data/destinations';

describe('regionSlug', () => {
  it('slugifies ampersands, spaces and accents', () => {
    expect(regionSlug('Asia & Pacific')).toBe('asia-pacific');
    expect(regionSlug('Africa & Middle East')).toBe('africa-middle-east');
    expect(regionSlug('South America')).toBe('south-america');
    expect(regionSlug('USA')).toBe('usa');
    expect(regionSlug('Amérique Centrale')).toBe('amerique-centrale');
  });

  it('handles empty input', () => {
    expect(regionSlug('')).toBe('');
    expect(regionSlug(undefined)).toBe('');
    expect(regionSlug(null)).toBe('');
  });
});

describe('regionVar', () => {
  it('returns a CSS var with a fallback', () => {
    expect(regionVar('Europe')).toBe('var(--region-europe, var(--region-other))');
  });

  it('falls back to --region-other for empty input', () => {
    expect(regionVar('')).toBe('var(--region-other)');
  });

  it('every region in REGIONS has a --region-* variable in styles.scss (light and dark)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.scss'), 'utf8');
    for (const r of REGIONS.filter(r => r !== 'All')) {
      const slug = regionSlug(r);
      expect(KNOWN_REGION_SLUGS as readonly string[]).toContain(slug);
      const defs = css.match(new RegExp(`--region-${slug}:`, 'g')) ?? [];
      expect(defs.length, `--region-${slug}`).toBe(2);
    }
  });

  it('every known slug is defined for both themes', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.scss'), 'utf8');
    for (const slug of [...KNOWN_REGION_SLUGS, 'other']) {
      expect((css.match(new RegExp(`--region-${slug}:`, 'g')) ?? []).length, slug).toBe(2);
    }
  });
});
