import { describe, it, expect, vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GlassSheetComponent, SHEET_DRAG_CLOSE_PX } from './glass-sheet.component';
import { HubPickerComponent } from './hub-picker.component';

@Component({
  standalone: true,
  imports: [GlassSheetComponent],
  template: `
    <button id="opener" (click)="open.set(true)">Open</button>
    <app-glass-sheet title="Filters" [(open)]="open" (closed)="closed()"><p class="content">Body</p></app-glass-sheet>
  `,
})
class SheetHost {
  open = signal(false);
  closed = vi.fn();
}

function pointer(type: string, clientY: number): PointerEvent {
  const e = new MouseEvent(type, { bubbles: true, clientY }) as PointerEvent;
  Object.defineProperty(e, 'pointerId', { value: 1 });
  return e;
}

describe('GlassSheetComponent', () => {
  async function setup() {
    const fixture = TestBed.createComponent(SheetHost);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    return { fixture, el, host: fixture.componentInstance, dialog: el.querySelector('dialog')! };
  }

  it('opens as a labelled modal when open turns true and restores focus on close', async () => {
    const { fixture, el, host, dialog } = await setup();
    expect(dialog.hasAttribute('open')).toBe(false);
    const opener = el.querySelector<HTMLButtonElement>('#opener')!;
    opener.focus();
    opener.click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(true);
    const title = el.querySelector(`#${dialog.getAttribute('aria-labelledby')}`)!;
    expect(title.textContent).toBe('Filters');
    expect(el.querySelector('.content')?.textContent).toBe('Body');

    el.querySelector<HTMLButtonElement>('[aria-label="Close filters"]')!.click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(host.open()).toBe(false);
    expect(host.closed).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    fixture.nativeElement.remove();
  });

  it('closes when the model turns false, on Esc (cancel) and on a backdrop click', async () => {
    const { fixture, host, dialog } = await setup();
    host.open.set(true);
    await fixture.whenStable();
    host.open.set(false);
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(false);

    host.open.set(true);
    await fixture.whenStable();
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    await fixture.whenStable();
    expect(host.open()).toBe(false);

    host.open.set(true);
    await fixture.whenStable();
    dialog.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100 }) as DOMRect;
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 }));
    expect(dialog.hasAttribute('open')).toBe(true);
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 300 }));
    expect(dialog.hasAttribute('open')).toBe(false);
    fixture.nativeElement.remove();
  });

  it('dragging the handle down far enough closes the sheet; a short drag snaps back', async () => {
    const { fixture, host, el, dialog } = await setup();
    host.open.set(true);
    await fixture.whenStable();
    const handle = el.querySelector<HTMLElement>('.gs__handle')!;
    handle.dispatchEvent(pointer('pointerdown', 100));
    handle.dispatchEvent(pointer('pointermove', 140));
    await fixture.whenStable();
    expect(dialog.style.getPropertyValue('--drag')).toBe('40px');
    handle.dispatchEvent(pointer('pointerup', 140));
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.style.getPropertyValue('--drag')).toBe('0px');

    handle.dispatchEvent(pointer('pointerdown', 100));
    handle.dispatchEvent(pointer('pointermove', 100 + SHEET_DRAG_CLOSE_PX + 5));
    handle.dispatchEvent(pointer('pointerup', 100 + SHEET_DRAG_CLOSE_PX + 5));
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(false);
    handle.dispatchEvent(pointer('pointermove', 10)); // ignored without a drag
    handle.dispatchEvent(new Event('pointercancel'));
    fixture.nativeElement.remove();
  });
});

describe('HubPickerComponent', () => {
  it('shows the hub, opens the list and emits a new hub', async () => {
    const fixture = TestBed.createComponent(HubPickerComponent);
    fixture.componentRef.setInput('hub', 'YUL');
    fixture.componentRef.setInput('size', 'lg');
    const changes: string[] = [];
    fixture.componentInstance.hubChange.subscribe(c => changes.push(c));
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const pill = el.querySelector<HTMLButtonElement>('.picker')!;
    expect(pill.textContent).toContain('YUL');
    expect(pill.textContent).toContain('Montréal');
    expect(pill.querySelector('.caret')).toBeTruthy();
    expect(el.classList).toContain('is-lg');
    pill.click();
    await fixture.whenStable();
    expect(el.querySelector('dialog')!.hasAttribute('open')).toBe(true);
    const hubs = [...el.querySelectorAll<HTMLButtonElement>('.hub')];
    expect(hubs.find(h => h.classList.contains('on'))?.textContent).toContain('YUL');
    hubs.find(h => h.textContent?.includes('YUL'))!.click(); // same hub: no event
    hubs.find(h => h.textContent?.includes('YYZ'))!.click();
    await fixture.whenStable();
    expect(changes).toEqual(['YYZ']);
    expect(el.querySelector('dialog')!.hasAttribute('open')).toBe(false);
  });
});
