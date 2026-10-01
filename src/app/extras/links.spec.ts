import { describe, expect, it } from 'vitest';
import { addPassPath, addPassQuery, filesPath, passPath, profilePath, tripSharePath } from './links';

describe('extras links', () => {
  it('builds the extras routes', () => {
    expect(filesPath('abc')).toEqual(['/trips', 'abc', 'files']);
    expect(addPassPath('abc')).toEqual(['/trips', 'abc', 'passes', 'add']);
    expect(passPath('abc', 'p1')).toEqual(['/trips', 'abc', 'pass', 'p1']);
    expect(tripSharePath('abc')).toEqual(['/trips', 'abc', 'share']);
    expect(profilePath()).toEqual(['/profile']);
  });

  it('builds the add-pass query, leaving out what is not set', () => {
    expect(addPassQuery()).toEqual({});
    expect(addPassQuery('leg1')).toEqual({ leg: 'leg1' });
    expect(addPassQuery(null, 'camera')).toEqual({ src: 'camera' });
    expect(addPassQuery('leg1', 'file')).toEqual({ leg: 'leg1', src: 'file' });
  });
});
