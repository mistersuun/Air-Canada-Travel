import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { GroundTimetableService } from '../ground-timetable.service';

/**
 * Settings "Timetable credits": the operators and open-data licences behind
 * ground.json (CC BY 4.0, Licence Ouverte 2.0, ODbL), and the ODbL the file
 * itself is published under. Styled like "Data credits" next to it. Loads the
 * small file itself (the credits need its source list); renders nothing when
 * it is missing.
 */
@Component({
  selector: 'app-ground-credit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (doc(); as d) {
      <details class="grp credits">
        <summary class="row"><span class="nm">Timetable credits</span><span class="chev" aria-hidden="true">›</span></summary>
        <ul class="cr">
          @for (s of sources(); track s.id) {
            <li [attr.data-source]="s.id">
              <b>{{ s.name }}</b>&ngsp;<a [href]="s.url" target="_blank" rel="noopener">{{ s.credit }}</a>,
              @if (s.licenceUrl) { <a [href]="s.licenceUrl" target="_blank" rel="noopener license">{{ s.licence }}</a> }
              @else { {{ s.licence }} }
              @if (s.fetched) { · downloaded {{ s.fetched }} }
            </li>
          }
          <li>
            <b>Timetable file</b>&ngsp;Typical departures for each corridor, built from the feeds above and published under the
            <a [href]="d.licenseUrl || odbl" target="_blank" rel="noopener license">Open Database License (ODbL 1.0)</a>.
            Timetables, not bookings or live times. Check before you go.
          </li>
        </ul>
      </details>
    }
  `,
  styles: [`
    :host { display: block; }
    :host:empty { display: none; }
    .grp { display: grid; gap: 14px; padding: 14px 16px; border-radius: 18px; background: var(--fill); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; width: 100%; min-height: 24px; }
    .nm { font-size: 15px; font-weight: 600; }
    .chev { color: var(--ink-3); font-size: 18px; transition: transform var(--dur-fast) var(--ease-out); }
    .credits summary { list-style: none; }
    .credits summary::-webkit-details-marker { display: none; }
    .credits[open] .chev { transform: rotate(90deg); }
    .cr { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 12.5px; color: var(--ink-2); }
    .cr b { color: var(--ink); font-weight: 650; margin-right: 4px; }
    .cr a { color: var(--blue); overflow-wrap: anywhere; }
  `],
})
export class GroundCreditComponent {
  private readonly service = inject(GroundTimetableService);
  protected readonly odbl = 'https://opendatacommons.org/licenses/odbl/1-0/';
  protected readonly doc = computed(() => this.service.timetables());
  protected readonly sources = computed(() =>
    Object.entries(this.doc()?.sources ?? {})
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  constructor() {
    void this.service.ensureLoaded();
  }
}
