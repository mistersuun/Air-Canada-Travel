import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEDULE_CHECK_TAG, SHARE_MAX_BYTES, SHARE_MAX_FILES } from './share-payload';

/** public/sw.js is standalone (no imports), so its copies of the share limits are checked against share-payload.ts here. */
const sw = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

/** The value of `var NAME = <expression>;` in sw.js, evaluated (the expressions are plain arithmetic or a string). */
function swConstant(name: string): unknown {
  const m = new RegExp(`var ${name} = ([^;]+);`).exec(sw);
  if (!m) throw new Error(`${name} not found in public/sw.js`);
  return Function(`"use strict"; return (${m[1]});`)();
}

describe('public/sw.js constants match the app', () => {
  it('share limits', () => {
    expect(swConstant('MAX_FILES')).toBe(SHARE_MAX_FILES);
    expect(swConstant('MAX_BYTES')).toBe(SHARE_MAX_BYTES);
  });
  it('the periodic schedule check tag', () => {
    expect(swConstant('SYNC_TAG')).toBe(SCHEDULE_CHECK_TAG);
  });
});
