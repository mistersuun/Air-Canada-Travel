import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n/locale';
import { sevilleTrip } from '../trips/testing/seville-fixture';
import { planLabelSuggestions } from './group-doc';

beforeEach(() => setLocale('fr'));
afterEach(() => setLocale('en'));

describe('group in French', () => {
  it('suggested status labels follow the language', () => {
    const labels = planLabelSuggestions(sevilleTrip());
    expect(labels.length).toBeGreaterThan(0);
    expect(labels[0]).toMatch(/^Sur AC\d+$/);
    setLocale('en');
    expect(planLabelSuggestions(sevilleTrip())[0]).toMatch(/^On AC\d+$/);
  });
});
