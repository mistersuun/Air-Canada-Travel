import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Privacy boundary (extras spec §6.4): the share text and image are built
 * from the trip alone. Nothing under share/ or pages/share/ may import the
 * boarding pass or files code, so a booking code or a file can never reach them.
 */
const APP = resolve(__dirname, '..');
const ROOTS = [join(APP, 'share'), join(APP, 'pages', 'share')];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return p.endsWith('.ts') && !p.endsWith('share-boundary.spec.ts') ? [p] : [];
  });
}

function imports(src: string): string[] {
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  return [...src.matchAll(re)].map(m => m[1] ?? m[2] ?? m[3]);
}

describe('share boundary', () => {
  const files = ROOTS.flatMap(sources);

  it('finds the share sources', () => {
    const names = files.map(f => relative(APP, f));
    expect(names).toContain(join('share', 'trip-share-text.ts'));
    expect(names).toContain(join('share', 'trip-card.ts'));
    expect(names).toContain(join('pages', 'share', 'trip-share.page.ts'));
  });

  it('never imports from passes/ or files/', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const spec of imports(readFileSync(f, 'utf8'))) {
        if (!spec.startsWith('.')) continue;
        const target = relative(APP, resolve(f, '..', spec));
        if (/^(passes|files)(\/|$)/.test(target)) bad.push(`${relative(APP, f)} → ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
