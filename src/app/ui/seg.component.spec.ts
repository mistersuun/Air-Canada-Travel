import { describe, it, expect } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SegComponent, SegOption } from './seg.component';

@Component({
  standalone: true,
  imports: [SegComponent],
  template: `<app-seg [options]="opts" [(value)]="v" ariaLabel="Mode" glass stretch />`,
})
class Host {
  opts: SegOption[] = [
    { value: 'a', label: 'Nonstop' },
    { value: 'b', label: 'Via', disabled: true },
    { value: 'c', label: '+ Connections', icon: 'plane' },
  ];
  v = signal<string | undefined>('a');
}

async function setup() {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const el: HTMLElement = fixture.nativeElement;
  const btns = () => [...el.querySelectorAll<HTMLButtonElement>('button')];
  return { fixture, el, btns, host: fixture.componentInstance };
}

describe('SegComponent', () => {
  it('renders a labelled group of toggle buttons with the active one pressed', async () => {
    const { el, btns } = await setup();
    expect(el.querySelector('[role=group]')?.getAttribute('aria-label')).toBe('Mode');
    expect(el.querySelector('.seg')!.classList).toContain('ui-glass');
    expect(el.querySelector('app-seg')!.classList).toContain('is-stretch');
    expect(btns().map(b => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(btns()[1].disabled).toBe(true);
    expect(btns()[2].querySelector('app-icon')).toBeTruthy();
  });

  it('click selects and updates the two-way value', async () => {
    const { btns, host, fixture } = await setup();
    btns()[2].click();
    await fixture.whenStable();
    expect(host.v()).toBe('c');
    expect(btns()[2].classList).toContain('on');
  });

  it('arrow keys skip disabled options and wrap; Home/End jump', async () => {
    const { btns, host, fixture } = await setup();
    const press = (i: number, key: string) => {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      btns()[i].dispatchEvent(e);
      return e;
    };
    expect(press(0, 'ArrowRight').defaultPrevented).toBe(true);
    expect(host.v()).toBe('c');
    await fixture.whenStable();
    expect(document.activeElement).toBe(btns()[2]);
    press(2, 'ArrowRight');
    expect(host.v()).toBe('a');
    press(0, 'ArrowLeft');
    expect(host.v()).toBe('c');
    press(2, 'Home');
    expect(host.v()).toBe('a');
    press(0, 'End');
    expect(host.v()).toBe('c');
    expect(press(0, 'x').defaultPrevented).toBe(false);
  });

  it('makes the first option tabbable when no value matches', async () => {
    const { btns, host, fixture } = await setup();
    host.v.set(undefined);
    await fixture.whenStable();
    expect(btns().map(b => b.tabIndex)).toEqual([0, -1, -1]);
  });

  it('skips a disabled first option for the tab stop', async () => {
    const { btns, host, fixture } = await setup();
    host.opts = [{ value: 'x', label: 'X', disabled: true }, ...host.opts];
    host.v.set(undefined);
    fixture.changeDetectorRef.markForCheck();
    await fixture.whenStable();
    expect(btns().map(b => b.tabIndex)).toEqual([-1, 0, -1, -1]);
  });
});
