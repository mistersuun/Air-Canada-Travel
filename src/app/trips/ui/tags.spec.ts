import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { LEG_STATUSES, LegStatus, Provenance } from '../model';
import { LegStatusTagComponent } from './leg-status-tag.component';
import { ProvenanceTagComponent } from './provenance-tag.component';

function render<T>(cmp: new () => T, key: string, value: string): HTMLElement {
  const f = TestBed.createComponent(cmp);
  f.componentRef.setInput(key, value);
  f.detectChanges();
  return f.nativeElement as HTMLElement;
}

describe('trip tags', () => {
  it('labels provenance with its tone', () => {
    const cases: [Provenance, string, string][] = [
      ['scheduled', 'Scheduled', 'ui-tag--teal'],
      ['estimated', 'Estimated', 'ui-tag--neutral'],
      ['saved', 'Saved by you', 'ui-tag--blue'],
      ['unknown', 'Unknown', 'ui-tag--amber'],
    ];
    for (const [v, text, cls] of cases) {
      const el = render(ProvenanceTagComponent, 'value', v);
      const tag = el.querySelector('span')!;
      expect(tag.textContent).toBe(text);
      expect(tag.classList).toContain('ui-tag');
      expect(tag.classList).toContain(cls);
      expect(el.getAttribute('data-provenance')).toBe(v);
    }
  });

  it('labels every leg status in words', () => {
    const want: Record<LegStatus, string> = {
      planned: 'Planned', listed: 'Listed', checkedIn: 'Checked in', boarded: 'Boarded',
      notBoarded: 'Not boarded', didntTry: "Didn't try", abandoned: 'Dropped',
    };
    for (const s of LEG_STATUSES) {
      const tag = render(LegStatusTagComponent, 'status', s).querySelector('span')!;
      expect(tag.textContent).toBe(want[s]);
      expect(tag.classList).toContain('ui-tag');
    }
    expect(render(LegStatusTagComponent, 'status', 'listed').querySelector('span')!.classList).toContain('ui-tag--teal');
    expect(render(LegStatusTagComponent, 'status', 'notBoarded').querySelector('span')!.classList).toContain('is-miss');
  });
});
