import { afterEach, describe, expect, it } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { setLocale } from '../i18n/locale';
import type { DayCount, StayOption } from '../planner/round-trip';
import { addDays } from '../utils/time';
import { StayChipsComponent } from './stay-chips.component';

const DEP = '2026-11-20';

function opt(nights: number, state: DayCount['state'] = 'ok', total = 3): StayOption {
  const key = addDays(DEP, nights);
  return {
    nights, key,
    count: { key, state, total: state === 'ok' ? total : 0, direct: state === 'ok' ? total : 0, connecting: 0, hidden: 0, first: null, last: null, nights },
  };
}

@Component({
  standalone: true,
  imports: [StayChipsComponent],
  template: `
    <app-stay-chips [options]="options()" [selected]="sel()" [dep]="dep" today="2026-11-14" [compute]="compute()"
                    (pick)="picks.push($event)" />
  `,
})
class Host {
  dep = DEP;
  options = signal<StayOption[]>([opt(2), opt(3), opt(4, 'none'), opt(5), opt(7)]);
  sel = signal<number | null>(4);
  compute = signal<((n: number) => StayOption) | null>((n: number) => opt(n, 'ok', 2));
  picks: string[] = [];
}

async function setup() {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const el: HTMLElement = fixture.nativeElement;
  const radios = () => [...el.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const text = (b: Element) => (b.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { fixture, host: fixture.componentInstance, el, radios, text };
}

describe('ui StayChipsComponent', () => {
  afterEach(() => setLocale('en'));

  it('is a radiogroup of five stays plus Other; the checked one has aria-checked and a check', async () => {
    const { el, radios, text } = await setup();
    expect(el.querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Length of stay');
    const r = radios();
    expect(r).toHaveLength(6);
    expect(text(r[0])).toBe('2 nights Sun 22 · 3 home');
    expect(text(r[5])).toBe('Other');
    expect(r.map(b => b.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false', 'false', 'false']);
    expect(r[2].querySelector('app-icon')).not.toBeNull();
    expect(r[0].querySelector('app-icon')).toBeNull();
    expect(r[2].getAttribute('tabindex')).toBe('0');
    expect(r[0].getAttribute('tabindex')).toBe('-1');
  });

  it('a zero stay has a dashed border and the words "0 home"; unpublished says so', async () => {
    const { fixture, host, radios, text } = await setup();
    expect(text(radios()[2])).toBe('4 nights Tue 24 · 0 home');
    expect(radios()[2].classList).toContain('is-zero');
    host.options.set([opt(2, 'unpublished')]);
    await fixture.whenStable();
    expect(text(radios()[0])).toBe('2 nights Sun 22 · not published');
    for (const b of radios()) expect(text(b)).not.toBe('');
    expect(radios()[0].getAttribute('aria-label')).toBe('Sunday, November 22, 2026, not yet published, 2 nights');
    expect(radios()[0].getAttribute('aria-disabled')).toBe('true');
    expect(radios()[2]?.getAttribute('aria-disabled') ?? null).toBeNull();
  });

  it('a tap emits the return day; arrows move between chips', async () => {
    const { fixture, host, radios } = await setup();
    radios()[4].click();
    expect(host.picks).toEqual(['2026-11-27']);
    radios()[0].focus();
    radios()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await fixture.whenStable();
    expect(document.activeElement).toBe(radios()[5]);
  });

  it('Other opens a stepper: 8 nights first, − / + within 1..30, a tap picks', async () => {
    const { fixture, host, el, radios, text } = await setup();
    radios()[5].click();
    await fixture.whenStable();
    // role=radio has no aria-expanded; the stepper's value is announced in a polite live region.
    expect(radios()[5].hasAttribute('aria-expanded')).toBe(false);
    const value = () => el.querySelector<HTMLButtonElement>('.st__v')!;
    expect(text(value())).toBe('8 nights · Sat, Nov 28 · 2 home');
    const [minus, plus] = [...el.querySelectorAll<HTMLButtonElement>('.st__b')];
    plus.click();
    await fixture.whenStable();
    expect(text(value())).toBe('9 nights · Sun, Nov 29 · 2 home');
    expect(el.querySelector('[data-stepper-live]')!.getAttribute('aria-live')).toBe('polite');
    expect(el.querySelector('[data-stepper-live]')!.textContent).toContain('November 29');
    value().click();
    expect(host.picks).toEqual(['2026-11-29']);
    for (let i = 0; i < 12; i++) minus.click();
    await fixture.whenStable();
    expect(text(value())).toContain('1 night ·');
    expect(minus.disabled).toBe(true);
  });

  it('a stay outside the presets checks Other; without compute there is no Other', async () => {
    const { fixture, host, radios } = await setup();
    host.sel.set(9);
    await fixture.whenStable();
    expect(radios()[5].getAttribute('aria-checked')).toBe('true');
    expect(radios()[5].getAttribute('tabindex')).toBe('0');
    host.compute.set(null);
    await fixture.whenStable();
    expect(radios()).toHaveLength(5);
  });

  it('chips are at least 96 × 56', async () => {
    const { radios } = await setup();
    const s = getComputedStyle(radios()[0]);
    expect(parseFloat(s.minWidth)).toBeGreaterThanOrEqual(96);
    expect(parseFloat(s.minHeight)).toBeGreaterThanOrEqual(56);
  });

  it('speaks French', async () => {
    setLocale('fr');
    const { el, radios, text } = await setup();
    expect(el.querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Durée du séjour');
    expect(text(radios()[0]).replace(/ /g, ' ')).toBe('2 nuits dim. 22 · 3 retours');
    expect(text(radios()[2])).toBe('4 nuits mar. 24 · 0 retour');
    expect(text(radios()[5])).toBe('Autre');
  });
});
