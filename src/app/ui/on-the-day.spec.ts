import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { setLocale } from '../i18n/locale';
import { OnTheDayComponent } from './on-the-day.component';
import { onDayLinks } from './on-the-day';

afterEach(() => setLocale('en'));

describe('onDayLinks', () => {
  it('always has the Air Canada site; weather for Canada; FAA for the US', () => {
    expect(onDayLinks(['YUL', 'LIS'], 'en').map(l => l.id)).toEqual(['ac', 'weather']);
    expect(onDayLinks(['YYZ', 'LAX'], 'en').map(l => l.id)).toEqual(['ac', 'weather', 'faa']);
    expect(onDayLinks(['LIS'], 'en').map(l => l.id)).toEqual(['ac']);
  });
  it('points Air Canada status at the flight-information page in the UI language', () => {
    expect(onDayLinks(['LIS'], 'en')[0].href).toBe('https://www.aircanada.com/ca/en/aco/home/fly/flight-information.html');
    expect(onDayLinks(['LIS'], 'fr')[0].href).toBe('https://www.aircanada.com/ca/fr/aco/home/fly/flight-information.html');
  });
  it('uses the French alerts page in French', () => {
    expect(onDayLinks(['YUL'], 'fr')[1].href).toBe('https://weather.gc.ca/warnings/index_f.html');
  });
});

describe('OnTheDayComponent', () => {
  it('renders plain external links', async () => {
    const f = TestBed.createComponent(OnTheDayComponent);
    f.componentRef.setInput('codes', ['YUL', 'LAX']);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const as = [...el.querySelectorAll('a')];
    expect(as.map(a => a.textContent!.trim())).toEqual(['Air Canada flight status', 'Weather alerts (Environment Canada)', 'US airport status (FAA)']);
    expect(as.every(a => a.target === '_blank' && a.rel === 'noopener')).toBe(true);
    expect(as[2].href).toBe('https://nasstatus.faa.gov/');
  });
});
