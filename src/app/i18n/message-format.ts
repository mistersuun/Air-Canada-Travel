/**
 * A small ICU MessageFormat subset (docs/i18n.md), enough for UI text:
 *
 *   'Hello {name}'                                   argument
 *   '{n, plural, =0 {none} one {# try} other {# tries}}'   plural ('#' = the count)
 *   '{kind, select, starts {Starts} other {Ends}}'   select
 *   '{n, number}'                                     locale number ('1 234' in French)
 *
 * Apostrophes are plain text (no ICU quoting), so "aujourd'hui" needs no escape.
 * A literal brace is not supported. Parsed messages are cached per string.
 */

export type MsgParams = Readonly<Record<string, string | number>>;

type Node =
  | string
  | { kind: 'arg'; name: string; number: boolean }
  | { kind: 'plural'; name: string; cases: Record<string, Node[]> }
  | { kind: 'select'; name: string; cases: Record<string, Node[]> }
  | { kind: 'hash' };

const parsed = new Map<string, Node[]>();

function parse(msg: string): Node[] {
  let out = parsed.get(msg);
  if (!out) {
    const p = { s: msg, i: 0 };
    out = parseNodes(p, false);
    if (parsed.size > 2000) parsed.clear();
    parsed.set(msg, out);
  }
  return out;
}

function parseNodes(p: { s: string; i: number }, inPlural: boolean): Node[] {
  const nodes: Node[] = [];
  let text = '';
  const flush = (): void => {
    if (text) nodes.push(text);
    text = '';
  };
  while (p.i < p.s.length) {
    const c = p.s[p.i];
    if (c === '}') break;
    if (c === '{') {
      flush();
      nodes.push(parseArg(p));
      continue;
    }
    if (c === '#' && inPlural) {
      flush();
      nodes.push({ kind: 'hash' });
      p.i++;
      continue;
    }
    text += c;
    p.i++;
  }
  flush();
  return nodes;
}

function parseArg(p: { s: string; i: number }): Node {
  p.i++; // '{'
  const close = (): void => {
    if (p.s[p.i] !== '}') throw new Error(`Unclosed argument in message: ${p.s}`);
    p.i++;
  };
  const head = /^\s*([\w.]+)\s*(?:,\s*(plural|select|number)\s*)?(,)?/.exec(p.s.slice(p.i));
  if (!head) throw new Error(`Bad argument in message: ${p.s}`);
  p.i += head[0].length;
  const [, name, type] = head;
  if (!type || type === 'number') {
    close();
    return { kind: 'arg', name, number: type === 'number' };
  }
  const cases: Record<string, Node[]> = {};
  for (;;) {
    const sel = /^\s*(=\d+|[\w-]+)\s*\{/.exec(p.s.slice(p.i));
    if (!sel) break;
    p.i += sel[0].length;
    cases[sel[1]] = parseNodes(p, type === 'plural');
    close();
  }
  while (/\s/.test(p.s[p.i] ?? '')) p.i++;
  close();
  if (!cases['other']) throw new Error(`Missing 'other' case in message: ${p.s}`);
  return { kind: type as 'plural' | 'select', name, cases };
}

const pluralRules = new Map<string, Intl.PluralRules>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function rules(tag: string): Intl.PluralRules {
  let r = pluralRules.get(tag);
  if (!r) pluralRules.set(tag, (r = new Intl.PluralRules(tag)));
  return r;
}

/** '1 234' (fr-CA) / '1,234' (en-US). */
export function formatNumberIn(tag: string, n: number): string {
  let f = numberFormats.get(tag);
  if (!f) numberFormats.set(tag, (f = new Intl.NumberFormat(tag)));
  return f.format(n);
}

function render(nodes: Node[], params: MsgParams, tag: string, count: number | null): string {
  let out = '';
  for (const n of nodes) {
    if (typeof n === 'string') out += n;
    else if (n.kind === 'hash') out += count === null ? '#' : String(count);
    else if (n.kind === 'arg') {
      const v = params[n.name];
      out += v === undefined ? `{${n.name}}` : n.number && typeof v === 'number' ? formatNumberIn(tag, v) : String(v);
    } else if (n.kind === 'plural') {
      const v = Number(params[n.name]);
      const exact = n.cases[`=${v}`];
      const branch = exact ?? n.cases[Number.isFinite(v) ? rules(tag).select(v) : 'other'] ?? n.cases['other'];
      out += render(branch, params, tag, v);
    } else {
      const v = String(params[n.name]);
      out += render(n.cases[v] ?? n.cases['other'], params, tag, count);
    }
  }
  return out;
}

/** Formats `msg` with `params` for the Intl tag `tag` (plural rules, numbers). */
export function formatMessage(msg: string, params: MsgParams | undefined, tag: string): string {
  if (!params && !msg.includes('{')) return msg;
  return render(parse(msg), params ?? {}, tag, null);
}

/** The argument names a message uses ('{n, plural, …}' counts as 'n'). For the catalogue specs. */
export function messageArgs(msg: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: Node[]): void => {
    for (const n of nodes) {
      if (typeof n === 'string' || n.kind === 'hash') continue;
      names.add(n.name);
      if (n.kind === 'plural' || n.kind === 'select') Object.values(n.cases).forEach(walk);
    }
  };
  walk(parse(msg));
  return [...names].sort();
}
