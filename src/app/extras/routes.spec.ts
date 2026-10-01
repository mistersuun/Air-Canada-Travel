import { describe, expect, it } from 'vitest';
import { Type } from '@angular/core';
import { routes } from '../app.routes';
import { knownTrip } from '../shell/route-guards';
import { isDetailPath } from '../shell/nav-model';

const EXTRAS: [string, string, boolean][] = [
  ['trips/:id/files', 'Files · Routes', true],
  ['trips/:id/passes/add', 'Add boarding pass · Routes', true],
  ['trips/:id/pass/:passId', 'Boarding pass · Routes', true],
  ['trips/:id/share', 'Share trip · Routes', true],
  ['profile', 'Travel profile · Routes', false],
];

describe('extras routes', () => {
  it('registers the five extras routes before the catch-all, lazily, with titles and guards', async () => {
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
