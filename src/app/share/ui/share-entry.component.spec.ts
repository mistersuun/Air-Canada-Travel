import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SEVILLE_TRIP } from '../../trips/testing/seville-fixture';
import { ShareEntryComponent } from './share-entry.component';

describe('ShareEntryComponent', () => {
  it('links "Share as image or text" to /trips/:id/share', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ShareEntryComponent);
    fixture.componentRef.setInput('trip', SEVILLE_TRIP);
    fixture.detectChanges();
    await fixture.whenStable();
    const a = (fixture.nativeElement as HTMLElement).querySelector('a[data-share-entry]') as HTMLAnchorElement;
    expect(a.textContent!.replace(/\s+/g, ' ').trim()).toBe('Share as image or text');
    expect(a.getAttribute('href')).toBe('/trips/sevtrip001/share');
  });
});
