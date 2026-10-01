import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const HEAVY = /(['"])(zxing-wasm|pdfjs-dist|bwip-js)(\/[^'"]*)?\1/;
const ALLOWED = new Set(['passes/barcode.service.ts', 'passes/pdf-pages.ts', 'passes/barcode-render.ts', 'passes/vendor-modules.d.ts']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

describe('barcode and PDF libraries load lazily', () => {
  it('no app file imports zxing-wasm, pdfjs-dist or bwip-js statically', () => {
    const bad: string[] = [];
    for (const f of files(ROOT)) {
      const src = readFileSync(f, 'utf8');
      const rel = relative(ROOT, f).split('\\').join('/');
      for (const line of src.split('\n')) {
        if (!HEAVY.test(line)) continue;
        const isStatic = /^\s*(import|export)\b(?!\s*\()/.test(line) && !/^\s*import\s+type\b/.test(line);
        const isDynamic = /\bimport\(\s*['"]/.test(line) || /typeof import\(/.test(line);
        if (isStatic || (!ALLOWED.has(rel) && (isDynamic || /\bfrom\s+['"]/.test(line)))) bad.push(`${rel}: ${line.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the three libraries are pinned exactly', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, '..', '..', 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['zxing-wasm']).toBe('3.1.4');
    expect(pkg.dependencies['pdfjs-dist']).toBe('6.3.289');
    expect(pkg.dependencies['bwip-js']).toBe('4.11.4');
  });
});
