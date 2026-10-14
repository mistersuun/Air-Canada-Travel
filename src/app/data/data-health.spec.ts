/**
 * Freshness of the committed public/data files. Unlike data-integrity.spec.ts
 * (structure, date-independent), these checks depend on today's date: they
 * catch a scheduled workflow that has silently stopped. Locally they only
 * print a warning; in CI (process.env.CI) a stale file fails the build, so a
 * dead pipeline is noticed. DATA_HEALTH_STRICT=1 turns the remaining warnings
 * (an empty airport-hotels map) into failures too.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HUBS } from './destinations';

const readJson = <T>(name: string): T => JSON.parse(readFileSync(resolve(process.cwd(), 'public/data', name), 'utf8')) as T;
const DAY = 86_400_000;
const today = Date.now();
const ageDays = (iso: string) => (today - Date.parse(iso)) / DAY;
const daysAhead = (iso: string) => (Date.parse(iso) - today) / DAY;

const CI = !!process.env['CI'];
const STRICT = !!process.env['DATA_HEALTH_STRICT'];

/** Fails in CI (or when `warnOnly` is false and strict), warns otherwise. */
function report(problems: string[], opts: { warnOnly?: boolean } = {}): void {
  if (!problems.length) return;
  const fail = opts.warnOnly ? STRICT : CI || STRICT;
  if (fail) expect(problems, problems.join('\n')).toEqual([]);
  else console.warn(`[data-health] ${problems.join('\n[data-health] ')}`);
}

function collect(o: unknown, key: string, out: string[]): string[] {
  if (Array.isArray(o)) o.forEach(x => collect(x, key, out));
  else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      if (k === key && typeof v === 'string') out.push(v);
      else collect(v, key, out);
    }
  }
  return out;
}

describe('data health', () => {
  it('airport-hotels.json is populated and built within 120 days', () => {
    const f = readJson<{ builtAt: string; airports: Record<string, unknown> }>('airport-hotels.json');
    report(ageDays(f.builtAt) > 120 ? [`airport-hotels.json builtAt ${f.builtAt} is older than 120 days`] : []);
    // An empty map is the shipped placeholder until update-airport-hotels runs.
    report(Object.keys(f.airports).length === 0 ? ['airport-hotels.json has no airports'] : [], { warnOnly: true });
  });

  it('climate.json covers every hub', () => {
    // Warning only: the climate workflow (update-climate.yml) has to run once to add the hubs.
    const f = readJson<{ codes: Record<string, unknown> }>('climate.json');
    const missing = HUBS.map(h => h.code).filter(c => !f.codes[c]);
    report(missing.length ? [`climate.json lacks hubs: ${missing.join(', ')}`] : [], { warnOnly: true });
  });

  it('ground.json corridors keep running for a while', () => {
    const f = readJson<{ corridors: Record<string, unknown> }>('ground.json');
    const expiring: string[] = [];
    const soon: string[] = [];
    for (const [id, corridor] of Object.entries(f.corridors)) {
      // A corridor's latest validTo: earlier ones are individual services ending, which is normal.
      const last = collect(corridor, 'validTo', []).sort().pop();
      if (!last) continue;
      const left = daysAhead(`${last}T23:59:59Z`);
      if (left < 5) expiring.push(`${id} ends ${last}`);
      else if (left < 21) soon.push(`${id} ends ${last}`);
    }
    // Under 5 days (or past): the ground workflow (1st and 15th) has missed a run. 5 to 21: a heads-up.
    report(expiring.map(s => `ground.json corridor ${s}`));
    if (soon.length) console.warn(`[data-health] ground.json corridors ending within 21 days: ${soon.join(', ')}`);
  });

  it('schedules.json still covers at least 28 days ahead', () => {
    const meta = readJson<{ meta: { coverageTo?: string } }>('schedules.json').meta;
    const left = meta.coverageTo ? daysAhead(`${meta.coverageTo}T23:59:59Z`) : -1;
    report(left < 28 ? [`schedules.json coverage ends ${meta.coverageTo ?? '(missing)'}, under 28 days ahead`] : []);
  });

  it('advisories, fx and holidays are under 21 days old', () => {
    const problems: string[] = [];
    const advisories = readJson<{ generatedAt: string }>('advisories.json');
    const holidays = readJson<{ generatedAt: string }>('holidays.json');
    const fx = readJson<{ date: string }>('fx.json');
    if (ageDays(advisories.generatedAt) > 21) problems.push(`advisories.json generatedAt ${advisories.generatedAt}`);
    if (ageDays(holidays.generatedAt) > 21) problems.push(`holidays.json generatedAt ${holidays.generatedAt}`);
    if (ageDays(fx.date) > 21) problems.push(`fx.json date ${fx.date}`);
    report(problems.map(p => `${p} is older than 21 days`));
  });

  it('reports through console.warn locally and fails in CI', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    report([]);
    expect(warn).not.toHaveBeenCalled();
    if (!CI && !STRICT) {
      report(['example']);
      expect(warn).toHaveBeenCalledOnce();
    }
    warn.mockRestore();
  });
});
