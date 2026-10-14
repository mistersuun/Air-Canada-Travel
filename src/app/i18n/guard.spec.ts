/**
 * Hard-coded English guard (docs/i18n.md, "The guard").
 *
 * For every path ticked "[x]" in the converted list of docs/i18n.md, flags:
 * - template text and static aria-label / title / placeholder / alt /
 *   ariaLabel / aria-valuetext values with words in them;
 * - TypeScript string literals that read like English prose (two words or
 *   more), outside t()/tIn()/tOr() keys, imports, styles and Error messages.
 *
 * A line ending in `// i18n-ignore` is skipped (data, identifiers, logs).
 * Run alone: node_modules/.bin/vitest run src/app/i18n/guard.spec.ts
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const DOC = join(ROOT, 'docs/i18n.md');

/** Words a template may show as they are (the brand). */
const ALLOWED_WORDS = new Set(['Routes']);
const CHECKED_ATTRS = /\s(aria-label|title|placeholder|alt|ariaLabel|aria-valuetext|aria-description)="([^"]*)"/g;
/** English-looking prose: a word, whitespace, a lowercase word ('Good morning', 'Updated ${x} ago'). */
const PROSE = /[A-Za-z]{2,}\s+[a-z]{2,}/;
const TRANSLATORS = new Set(['t', 'tIn', 'tOr']);

export interface Finding {
  file: string;
  line: number;
  text: string;
}

/** The ticked paths of the converted list in docs/i18n.md. */
export function convertedPaths(doc: string): string[] {
  const block = /<!-- i18n-converted:start -->([\s\S]*?)<!-- i18n-converted:end -->/.exec(doc)?.[1] ?? '';
  return [...block.matchAll(/^- \[x\] `([^`]+)`/gm)].map(m => m[1]);
}

function sourceFiles(path: string): string[] {
  const abs = join(ROOT, path);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [path];
  return readdirSync(abs).flatMap(name => {
    const rel = join(path, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return name === 'testing' ? [] : sourceFiles(rel);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [rel] : [];
  });
}

/** Template findings: visible text and checked attributes with words. */
export function scanTemplate(template: string): { offset: number; text: string }[] {
  const out: { offset: number; text: string }[] = [];
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  let src = template.replace(/<!--[\s\S]*?-->/g, blank).replace(/\{\{[\s\S]*?\}\}/g, blank);
  for (const m of src.matchAll(CHECKED_ATTRS)) {
    if (/[A-Za-z]{2,}/.test(m[2])) out.push({ offset: m.index!, text: `${m[1]}="${m[2]}"` });
  }
  src = src
    .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, blank)
    .replace(/@(?:if|else if|for|switch|case|defer|let)\s*\((?:[^()]|\([^()]*\))*\)/g, blank)
    .replace(/@(?:else|default|empty|placeholder|loading|error)\b/g, blank)
    .replace(/&[a-z]+;|&#\d+;/g, blank);
  for (const m of src.matchAll(/[^\s{}]+(?:[ \t]+[^\s{}]+)*/g)) {
    const words = m[0].match(/[A-Za-z]{2,}/g)?.filter(w => !ALLOWED_WORDS.has(w)) ?? [];
    if (words.length) out.push({ offset: m.index!, text: m[0] });
  }
  return out;
}

/** All findings in one TypeScript source. */
export function scanSource(file: string, code: string): Finding[] {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const lines = code.split('\n');
  const out: Finding[] = [];
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line;
  const add = (pos: number, text: string) => {
    const line = lineOf(pos);
    if (!/\/\/ i18n-ignore\s*$/.test(lines[line])) out.push({ file, line: line + 1, text: text.trim().slice(0, 90) });
  };
  const propName = (n: ts.Node) =>
    ts.isPropertyAssignment(n.parent) && n.parent.initializer === n && (ts.isIdentifier(n.parent.name) || ts.isStringLiteral(n.parent.name))
      ? n.parent.name.text : null;
  const skipped = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
      if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && TRANSLATORS.has(p.expression.text)) return true;
      if (ts.isNewExpression(p) && ts.isIdentifier(p.expression) && /Error$/.test(p.expression.text)) return true;
      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && ['styles', 'selector', 'host'].includes(p.name.text)) return true;
    }
    return false;
  };
  const visit = (n: ts.Node): void => {
    if ((ts.isNoSubstitutionTemplateLiteral(n) || ts.isStringLiteral(n)) && propName(n) === 'template') {
      const start = n.getStart(sf) + 1;
      for (const f of scanTemplate(n.text)) add(start + f.offset, f.text);
      return;
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (PROSE.test(n.text) && !skipped(n)) add(n.getStart(sf), n.text);
      return;
    }
    if (ts.isTemplateExpression(n)) {
      const text = [n.head.text, ...n.templateSpans.map(s => s.literal.text)].join('${}');
      if (PROSE.test(text.replace(/\$\{\}/g, '')) && !skipped(n)) add(n.getStart(sf), text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('i18n guard: scanner', () => {
  it('flags template text and static labels, not bindings or translated text', () => {
    const found = scanTemplate(`
      <h1>Where to?</h1>
      <button aria-label="Close" [attr.aria-label]="t('x')">{{ t('common.done') }}</button>
      @if (a > 1) { <span>{{ n }} · {{ m }}</span> } @else { <b>›</b> }
      <a class="logo">Routes</a> <!-- a comment with words -->
      <span>Nonstop &amp; more</span>`).map(f => f.text.replace(/\s+/g, ' '));
    expect(found).toEqual(['aria-label="Close"', 'Where to?', 'Nonstop more']);
  });

  it('flags English prose in code, not keys, imports, styles, errors or ignored lines', () => {
    const code = [
      "import { x } from '../some path';",
      "const a = 'Good morning';",
      "const b = t('home.where');",
      'const c = `Updated ${when} ago`;',
      "const d = 'ac.prefs.v1';",
      "throw new Error('Bad thing happened');",
      "const e = 'Seen in the wild'; // i18n-ignore",
      "@Component({ selector: 'app-x', template: `<p>Hello there</p>`, styles: ['.a { content: \"x y\" }'] }) class X {}",
    ].join('\n');
    expect(scanSource('x.ts', code).map(f => [f.line, f.text])).toEqual([
      [2, 'Good morning'],
      [4, 'Updated ${} ago'],
      [8, 'Hello there'],
    ]);
  });

  it('reads the ticked paths from the doc', () => {
    const doc = '<!-- i18n-converted:start -->\n- [x] `src/a/`\n- [ ] `src/b/`\n- [x] `src/c.ts` (note)\n<!-- i18n-converted:end -->';
    expect(convertedPaths(doc)).toEqual(['src/a/', 'src/c.ts']);
  });
});

describe('i18n guard: converted areas', () => {
  const paths = convertedPaths(readFileSync(DOC, 'utf8'));

  it('lists converted paths that exist', () => {
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter(p => !existsSync(join(ROOT, p)))).toEqual([]);
  });

  it('has no hard-coded English in converted areas', () => {
    const findings = paths.flatMap(sourceFiles).flatMap(f => scanSource(f, readFileSync(join(ROOT, f), 'utf8')));
    expect(findings.map(f => `${f.file}:${f.line}  ${f.text}`)).toEqual([]);
  });
});
