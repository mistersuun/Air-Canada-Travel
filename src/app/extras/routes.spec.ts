import { describe, expect, it } from 'vitest';
import { Type } from '@angular/core';
import { routes } from '../app.routes';
import { knownTrip } from '../shell/route-guards';
import { isDetailPath } from '../shell/nav-model';

const EXTRAS: [string, string, boolean][] = [
  ['trips/:id/files', 'shell.title.files', true],
  ['trips/:id/passes/add', 'shell.title.addPass', true],
  ['trips/:id/pass/:passId', 'shell.title.pass', true],
  ['trips/:id/share', 'shell.title.share', true],
  ['profile', 'shell.title.profile', false],
];

describe('extras routes', () => {
  it('registers the five extras routes before the catch-all, lazily, with title keys and guards', async () => {
    const paths = routes.map(r => r.path);
    for (const [path, title, guarded] of EXTRAS) {
      const i = paths.indexOf(path);
      expect(i, path).toBeGreaterThan(paths.indexOf('trips/:id/recover'));
      expect(i, path).toBeLessThan(paths.indexOf('**'));
      const r = routes[i];
      expect(r.title).toBe(title);
      expect(!!r.canActivate?.includes(knownTrip), path).toBe(guarded);
      const cmp = (await r.loadComponent!()) as Type<unknown>;
      expect(typeof cmp, path).toBe('function');
    }
  });

  it('treats /profile as a detail page (no mobile tab bar)', () => {
    expect(isDetailPath('/profile')).toBe(true);
  });
});
