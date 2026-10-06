import { success } from '../../ui/haptics';
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../components/shared/icons.component';
import { passPath } from '../../extras/links';
import { FilesService } from '../../files/files.service';
import { FILES_ERROR_TEXT, MAX_FILE_BYTES, type FilesError } from '../../files/model';
import { BarcodeService } from '../../passes/barcode.service';
import { displayText, parseBcbp } from '../../passes/bcbp';
import { NOT_BCBP_TEXT, NO_BARCODE_TEXT, type DecodedRead, type PassRecord } from '../../passes/model';
import { PassSwapService } from '../../passes/pass-swap.service';
import { ShareInboxService } from '../../share-in/share-inbox.service';
import { PassesService } from '../../passes/passes.service';
import { AppStateService } from '../../state/app-state.service';
import { LEG_STATUS_LABEL, type FlightLeg, type FlightRef, type Trip } from '../../trips/model';
import { TripsService } from '../../trips/trips.service';
import { ProvenanceTagComponent } from '../../trips/ui/provenance-tag.component';
import { tripPath } from '../../ui/links';
import { dayLabel, legById } from '../trips/trips-model';
import {
  type DraftChoice, type PassDraft, type PassSource, alternateText, barcodeLabel, buildDrafts, flightLegs, initialChoice,
  julianLabel, legOptionLabel, matchLine, offersCheckIn, passName, pickLeg, rematchDrafts, savedText, toNewPass,
} from './add-pass-model';
import { PassScannerComponent, type ScanResult } from './pass-scanner.component';

type Step = 'pick' | 'scan' | 'reading' | 'fail' | 'check';
type Failure = 'none' | 'notBcbp' | 'unreadable' | 'tooLarge';

interface Decoded { drafts: PassDraft[]; images: Map<number, Blob | null>; source: PassSource; file: File | null }

/**
 * Add a boarding pass (/trips/:id/passes/add?leg=&src=camera|file), mock x9.
 * Scan with the camera, or pick a photo, screenshot or PDF; the barcode is
 * read on the phone. The check step shows the decoded fields and the leg it
 * seems to belong to; the user confirms or picks another. Saved to this
 * phone only, never shared.
 */
@Component({
  selector: 'app-add-pass-page',
  standalone: true,
  imports: [IconComponent, ProvenanceTagComponent, PassScannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page ui-page--bare ap" (pointerover)="warm()" (focusin)="warm()">
      <header class="ap__head">
        @if (step() === 'check') {
          <button type="button" class="ui-circ ui-circ--glass" aria-label="Back to the sources" data-back (click)="restart()">
            <app-icon name="arrow-left" [size]="18" />
          </button>
          <h1 #checkTtl class="ap__ttl" tabindex="-1" data-check-title>Check the details</h1>
        } @else {
          <button type="button" class="ui-circ ui-circ--glass" aria-label="Close" data-close (click)="close()">
            <app-icon name="close" [size]="18" />
          </button>
          <h1 class="ap__ttl">Add boarding pass<small>{{ trip()?.name }}</small></h1>
        }
        <span class="ap__sp" aria-hidden="true"></span>
      </header>

      @if (step() !== 'check') {
        <div class="srcs" role="group" aria-label="Where the pass is">
          <button type="button" class="src" [class.on]="step() === 'scan'" [attr.aria-pressed]="step() === 'scan'" data-src="camera"
                  (click)="scan()">
            <b><app-icon name="camera" [size]="18" [strokeWidth]="2" /></b>Scan<small>Camera</small>
          </button>
          <button #photoBtn type="button" class="src" [class.on]="active() === 'image'" data-src="image" (click)="pick(photoIn)">
            <b><app-icon name="image" [size]="18" [strokeWidth]="2" /></b>Photo<small>or screenshot</small>
          </button>
          <button type="button" class="src" [class.on]="active() === 'pdf'" data-src="pdf" (click)="pick(pdfIn)">
            <b><app-icon name="doc" [size]="18" [strokeWidth]="2" /></b>PDF<small>from Files</small>
          </button>
          <input #photoIn class="ui-visually-hidden" type="file" accept="image/*" tabindex="-1" aria-hidden="true" data-input="image"
                 (change)="onFile($event, 'image')">
          <input #pdfIn class="ui-visually-hidden" type="file" accept="application/pdf,.pdf" tabindex="-1" aria-hidden="true" data-input="pdf"
                 (change)="onFile($event, 'pdf')">
        </div>

        @switch (step()) {
          @case ('scan') {
            <app-pass-scanner class="ap__scan" (scanned)="onScan($event)" (unavailable)="cameraOff()" />
          }
          @case ('reading') {
            <div class="ui-card ap__msg" role="status" data-reading>
              <span class="ap__spin" aria-hidden="true"></span>Reading the barcode on this phone…
            </div>
          }
          @case ('fail') {
            <div class="ui-card ap__fail" role="alert" data-fail>
              <span class="ap__fic" aria-hidden="true"><app-icon name="barcode" [size]="20" /></span>
              <div class="ap__ft">
                <b>{{ failText() }}</b>
                @if (failure() === 'notBcbp') {
                  <span>The barcode was read, but it isn't a boarding pass. Use the one printed on the pass.</span>
                } @else if (failure() === 'tooLarge') {
                  <span>A screenshot of the pass, or a photo cropped close to the barcode, works best.</span>
                } @else {
                  <span>Crop close to the barcode, or use a sharper screenshot.</span>
                }
              </div>
              <div class="ap__fa">
                <button type="button" class="ui-btn ui-btn--dark ui-btn--sm" data-retry (click)="retry()">Try another image</button>
                @if (lastFile()) {
                  <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" data-save-file (click)="saveAsFile()" [disabled]="busy()">
                    {{ hintLeg() ? 'Save the image as a file on this leg' : 'Save the image as a file on this trip' }}
                  </button>
                }
              </div>
              @if (fileError(); as e) { <p class="ap__err">{{ e }}</p> }
            </div>
          }
        }
        @if (camera() === 'off') {
          <p class="ui-card ap__msg ap__msg--warn" role="status" data-camera-off>Camera not available. Pick a photo or screenshot instead.</p>
        }

        <div class="ui-card ap__priv">
          <app-icon name="lock" [size]="14" [strokeWidth]="2.2" />
          <span>Read on this phone. The pass is stored here only and is <b>never in share links</b>.</span>
        </div>
        <p class="ui-sub ap__any">Works for passes from any airline that use the standard barcode.</p>
      } @else {
        @for (d of drafts(); track d.key) {
          <section class="ap__draft" [attr.data-draft]="d.key" [attr.aria-label]="d.flightNumber + ' ' + d.leg.from + ' to ' + d.leg.to">
            @if (drafts().length > 1) {
              <label class="ap__inc">
                <input type="checkbox" [checked]="included().has(d.key)" (change)="toggleInclude(d.key, $any($event.target).checked)"
                       data-include>
                <span>Save {{ d.flightNumber }} {{ d.leg.from }} → {{ d.leg.to }}</span>
              </label>
            }
            <div class="ui-card ap__card">
              <div class="ap__route">
                <span class="ui-h2 tn">{{ d.leg.from }} → {{ d.leg.to }}</span>
              </div>
              <p class="ui-sub tn ap__fl">{{ d.flightNumber }}@if (d.dateKey) { · {{ day(d.dateKey) }}}</p>
              <dl class="kv tn">
                <div class="w2"><dt>Passenger</dt><dd>{{ name(d) }}</dd></div>
                <div><dt>Booking</dt><dd data-pnr>{{ d.leg.pnr }}</dd></div>
                <div><dt>Date</dt><dd data-date>{{ julian(d).day }}<small>{{ julian(d).date }}</small></dd></div>
                <div><dt>Cabin</dt><dd>{{ d.leg.cabin }}</dd></div>
                <div><dt>Seat</dt><dd>{{ d.leg.seat ?? '–' }}</dd></div>
                <div><dt>Sequence</dt><dd>{{ d.leg.sequence ?? '–' }}</dd></div>
                <div class="w2"><dt>Barcode</dt><dd>{{ bcLabel(d) }}</dd></div>
              </dl>
              <details class="raw">
                <summary>Barcode text</summary>
                <p class="raw__t">{{ rawText(d) }}</p>
              </details>
            </div>

            @if (!d.dateKey && !choiceOf(d.key)?.legId) {
              <label class="ui-card ap__date">
                <span class="ap__dl">Which day is this flight?</span>
                <input type="date" [value]="userDate()[d.key] || ''" (input)="setDate(d.key, $any($event.target).value)" data-date-input>
              </label>
            }

            @if (suggested(d); as s) {
              <div class="match" data-match>
                <span class="match__ic" aria-hidden="true"><app-icon name="check" [size]="18" [strokeWidth]="2.6" /></span>
                <div class="match__rt">
                  <b>Matches your {{ s.ref.flightNumber }} leg</b>
                  <span class="tn">{{ matchText(s.ref) }} · <app-provenance-tag value="scheduled" /></span>
                </div>
              </div>
              @if (pickerFor() !== d.key) {
                <p class="ap__other">Not this one? <button type="button" class="ui-link" data-pick-other (click)="pickerFor.set(d.key)">Pick another leg</button></p>
              }
            } @else if (d.candidates.length > 1) {
              <p class="ap__note" data-several>This pass fits more than one of your legs. Pick the one it's for.</p>
            } @else if (!choiceOf(d.key)) {
              @if (d.alternate) {
                <p class="ap__note" data-swap-offer>{{ altText(d) }}</p>
                <p class="ap__other">
                  <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm" data-swap (click)="swapToBackup(d)">Swap to {{ d.flightNumber }}</button>
                </p>
              } @else {
                <p class="ap__note" data-no-match>No leg in this trip has {{ d.flightNumber }} {{ d.leg.from }} → {{ d.leg.to }} on that day. Pick a leg, or keep the pass with the trip.</p>
              }
            }

            @if (showPicker(d)) {
              <fieldset class="ui-card ap__pick" data-picker>
                <legend class="ui-visually-hidden">Leg for {{ d.flightNumber }}</legend>
                @for (o of options(d); track o.id) {
                  <label class="ap__opt">
                    <input type="radio" [name]="'leg-' + d.key" [value]="o.id" [checked]="choiceKey(d.key) === o.id"
                           (change)="choose(d, o.id)" [attr.data-option]="o.id">
                    <span>{{ o.label }}@if (o.fits) { <small>Fits this pass</small> }</span>
                  </label>
                }
              </fieldset>
            }
          </section>
        }

        <div class="ui-card ap__opts">
          @if (checkInLegs().length) {
            <label class="ap__row">
              <span class="ap__rt"><b>Set leg to Checked in</b><small>{{ checkInHint() }}</small></span>
              <input type="checkbox" role="switch" class="switch" [checked]="checkIn()" (change)="checkIn.set($any($event.target).checked)"
                     data-check-in>
            </label>
          }
          <label class="ap__row">
            <span class="ap__rt"><b>Delete after the trip</b><small>Removed the day after you're home</small></span>
            <input type="checkbox" role="switch" class="switch" [checked]="deleteAfter()" (change)="deleteAfter.set($any($event.target).checked)"
                   data-delete-after>
          </label>
        </div>

        @if (saveError(); as e) { <p class="ap__err" role="alert" data-save-error>{{ e }}</p> }
        <button type="button" class="ui-btn ui-btn--dark ui-btn--block ap__save" data-save [disabled]="!canSave() || busy()" (click)="save()">
          {{ saveLabel() }}
        </button>
        <p class="ap__foot"><app-icon name="lock" [size]="14" [strokeWidth]="2.2" />On this phone only · never shared</p>
      }
    </div>
  `,
  styles: [`
    .ap { max-width: 600px; margin-inline: auto; display: flex; flex-direction: column; }
    .ap__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
    .ap__ttl { margin: 0; font-size: 16px; font-weight: 650; text-align: center; line-height: 1.25; }
    .ap__ttl:focus { outline: none; }
    .ap__ttl:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; border-radius: 6px; }
    .ap__ttl small { display: block; font-size: 12.5px; font-weight: 500; color: var(--ink-2); }
    .ap__sp { width: 40px; flex: none; }

    .srcs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px; position: relative; }
    .src {
      display: block; min-width: 0; min-height: 44px; padding: 12px 8px; border-radius: 16px; text-align: center;
      background: var(--surface); box-shadow: var(--shadow); border: 1px solid var(--hair);
      color: var(--ink); font-size: 12.5px; font-weight: 650; cursor: pointer;
      transition: box-shadow var(--dur-fast) var(--ease-out);
    }
    .src b { width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; margin: 0 auto 6px; background: var(--fill); }
    .src small { display: block; font-weight: 500; color: var(--ink-2); font-size: 11px; }
    .src.on { box-shadow: inset 0 0 0 2px var(--blue), var(--shadow); border-color: transparent; }
    .src.on b { background: color-mix(in srgb, var(--blue) 14%, transparent); color: var(--blue); }
    .src:hover:not(.on) { box-shadow: inset 0 0 0 1px var(--ink-3), var(--shadow); }
    .ap__scan { margin-top: 12px; }

    .ap__msg { margin: 12px 0 0; padding: 14px 16px; font-size: 14px; display: flex; align-items: center; gap: 10px; }
    .ap__msg--warn { background: color-mix(in srgb, var(--amber) 12%, var(--surface)); color: var(--amber-ink); font-weight: 600; }
    .ap__spin {
      width: 16px; height: 16px; border-radius: 50%; flex: none;
      border: 2px solid var(--hair); border-top-color: var(--blue); animation: ap-spin .8s linear infinite;
    }
    @keyframes ap-spin { to { transform: rotate(360deg); } }
    .ap__fail { margin-top: 12px; padding: 14px 16px; display: grid; grid-template-columns: auto 1fr; gap: 10px 12px; }
    .ap__fic {
      width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center;
      background: color-mix(in srgb, var(--amber) 15%, transparent); color: var(--amber-ink);
    }
    .ap__ft { display: grid; gap: 2px; min-width: 0; }
    .ap__ft b { font-size: 15px; font-weight: 650; }
    .ap__ft span { font-size: 13px; color: var(--ink-2); }
    .ap__fa { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; }
    .ap__fa .ui-btn { min-height: 44px; white-space: normal; text-align: center; }
    .ap__err { margin: 8px 2px 0; font-size: 13px; color: var(--red-ink); grid-column: 1 / -1; }

    .ap__priv { margin-top: 12px; padding: 12px 14px; display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--ink-2); }
    .ap__priv app-icon, .ap__foot app-icon { color: var(--teal); flex: none; }
    .ap__priv b { color: var(--ink); }
    .ap__any { margin: 12px 0 0; text-align: center; font-size: 12.5px; }

    .ap__draft { display: flex; flex-direction: column; margin-top: 12px; }
    .ap__draft + .ap__draft { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--hair); }
    .ap__inc { display: flex; align-items: center; gap: 10px; min-height: 44px; font-weight: 650; font-size: 15px; cursor: pointer; }
    .ap__inc input { width: 20px; height: 20px; accent-color: var(--teal); }
    .ap__card { padding: 16px; }
    .ap__route { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .ap__fl { margin: 2px 0 0; }
    .kv { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 8px; margin: 12px 0 0; }
    .kv .w2 { grid-column: span 2; }
    .kv dt { font-size: 10.5px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); }
    .kv dd { margin: 0; font-size: 15px; font-weight: 650; overflow-wrap: anywhere; }
    .kv dd small { display: block; font-size: 11.5px; font-weight: 500; color: var(--ink-2); }
    .raw { margin-top: 10px; background: var(--fill); border-radius: 10px; }
    .raw summary { cursor: pointer; min-height: 36px; display: flex; align-items: center; padding: 0 10px; font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
    .raw__t {
      margin: 0; padding: 0 10px 8px; font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 10.5px;
      color: var(--ink-2); overflow-wrap: anywhere; white-space: pre-wrap; line-height: 1.45;
    }
    .ap__date { margin-top: 10px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .ap__dl { font-weight: 650; font-size: 14.5px; }
    .ap__date input {
      height: 44px; padding: 0 12px; border: 1px solid var(--hair); border-radius: 12px; background: var(--fill);
      color: var(--ink); font: 500 15px var(--sans);
    }

    .match { display: flex; gap: 12px; align-items: center; padding: 12px; border-radius: 16px; margin-top: 12px; background: color-mix(in srgb, var(--teal) 11%, transparent); }
    .match__ic { width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; background: var(--teal); color: #FFFFFF; flex: none; }
    .match__rt { display: grid; gap: 2px; min-width: 0; }
    .match__rt b { font-size: 15px; font-weight: 650; }
    .match__rt > span { font-size: 13px; color: var(--teal-ink); }
    .match__rt app-provenance-tag { display: inline-flex; vertical-align: 1px; }
    .ap__other, .ap__note { margin: 8px 4px 0; font-size: 13.5px; color: var(--ink-2); }
    .ap__other .ui-link { font-size: 13.5px; min-height: 32px; }
    .ap__note { color: var(--ink); }
    .ap__pick { margin: 10px 0 0; padding: 4px 14px; border: 1px solid var(--hair); min-width: 0; }
    .ap__opt { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 6px 0; border-bottom: 1px solid var(--hair); cursor: pointer; }
    .ap__opt:last-child { border-bottom: 0; }
    .ap__opt input { width: 20px; height: 20px; flex: none; accent-color: var(--blue); }
    .ap__opt span { display: grid; font-size: 14.5px; font-weight: 600; min-width: 0; }
    .ap__opt small { font-size: 12px; font-weight: 500; color: var(--teal-ink); }

    .ap__opts { margin-top: 14px; padding: 4px 14px; }
    .ap__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--hair); cursor: pointer; }
    .ap__row:last-child { border-bottom: 0; }
    .ap__rt { display: grid; gap: 2px; }
    .ap__rt b { font-size: 15px; font-weight: 650; }
    .ap__rt small { font-size: 13px; color: var(--ink-2); }
    .switch {
      appearance: none; flex: none; width: 50px; height: 30px; margin: 0; border-radius: 999px;
      background: color-mix(in srgb, var(--ink-2) 70%, var(--ink-3)); position: relative; cursor: pointer;
      transition: background var(--dur-fast) var(--ease-out);
    }
    .switch::after {
      content: ''; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%;
      background: var(--surface); box-shadow: 0 1px 3px rgba(0, 0, 0, .2); transition: transform var(--dur-fast) var(--ease-out);
    }
    .switch:checked { background: var(--teal); }
    .switch:checked::after { transform: translateX(20px); }
    .ap__save { margin-top: 14px; min-height: 52px; }
    .ap__foot { display: flex; gap: 8px; align-items: center; justify-content: center; margin: 10px 0 0; font-size: 12px; color: var(--ink-2); }
    @media (min-width: 720px) { .ap { padding-top: 24px; } }
  `],
})
export class AddPassPage {
  private readonly tripsSvc = inject(TripsService);
  private readonly swapper = inject(PassSwapService);
  private readonly passes = inject(PassesService);
  private readonly files = inject(FilesService);
  private readonly barcode = inject(BarcodeService);
  private readonly inbox = inject(ShareInboxService);
  protected readonly state = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly photoBtn = viewChild<ElementRef<HTMLButtonElement>>('photoBtn');
  private readonly checkTtl = viewChild<ElementRef<HTMLElement>>('checkTtl');
  /** Bumped by every new read, restart and destroy: a late result of an older read is ignored. */
  private gen = 0;
  private readonly photoIn = viewChild<ElementRef<HTMLInputElement>>('photoIn');
  private readonly pdfIn = viewChild<ElementRef<HTMLInputElement>>('pdfIn');

  readonly id = input.required<string>();
  /** ?leg=<legId>: the leg the page was opened from (a hint; the user still confirms). */
  readonly leg = input<string | undefined>(undefined);
  /** ?src=camera|file: preselects the input. */
  readonly src = input<string | undefined>(undefined);

  protected readonly trip = computed(() => this.tripsSvc.trip(this.id()));
  protected readonly hintLeg = computed(() => {
    const t = this.trip();
    const l = t ? legById(t, this.leg()) : null;
    return l ? l.id : null;
  });

  protected readonly step = signal<Step>('pick');
  protected readonly active = signal<PassSource | null>(null);
  protected readonly camera = signal<'idle' | 'off'>('idle');
  protected readonly failure = signal<Failure>('none');
  protected readonly lastFile = signal<File | null>(null);
  protected readonly fileError = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly busy = signal(false);

  private readonly decoded = signal<Decoded | null>(null);
  protected readonly drafts = computed(() => this.decoded()?.drafts ?? []);
  protected readonly choices = signal<Record<string, DraftChoice | null>>({});
  protected readonly included = signal<ReadonlySet<string>>(new Set());
  protected readonly userDate = signal<Record<string, string>>({});
  protected readonly pickerFor = signal<string | null>(null);
  protected readonly checkIn = signal(false);
  protected readonly deleteAfter = signal(false);

  protected readonly failText = computed(() => {
    const f = this.failure();
    return f === 'notBcbp' ? NOT_BCBP_TEXT : f === 'tooLarge' ? FILES_ERROR_TEXT.tooLarge : NO_BARCODE_TEXT;
  });

  /** The legs "Set leg to Checked in" would change (planned or listed, chosen for an included draft). */
  protected readonly checkInLegs = computed<FlightLeg[]>(() => {
    const t = this.trip();
    if (!t) return [];
    const ids = new Set<string>();
    for (const d of this.drafts()) {
      const c = this.choices()[d.key];
      if (this.included().has(d.key) && c?.legId && offersCheckIn(t, c.legId)) ids.add(c.legId);
    }
    return flightLegs(t).filter(l => ids.has(l.id));
  });
  protected readonly checkInHint = computed(() => {
    const legs = this.checkInLegs();
    if (legs.length !== 1) return 'Only if you want.';
    return `It's ${LEG_STATUS_LABEL[legs[0].status]} now. Only if you want.`;
  });

  protected readonly canSave = computed(() => {
    const t = this.trip();
    if (!t) return false;
    const inc = this.drafts().filter(d => this.included().has(d.key));
    if (!inc.length) return false;
    return inc.every(d => {
      const c = this.choices()[d.key];
      if (!c) return false; // several candidates or no match: the user picks (a leg or "no leg")
      if (c.legId) return true;
      return !!(d.dateKey || this.userDate()[d.key]);
    });
  });
  protected readonly saveLabel = computed(() => {
    const inc = this.drafts().filter(d => this.included().has(d.key));
    if (inc.length > 1) return `Save ${inc.length} passes`;
    const c = inc[0] ? this.choices()[inc[0].key] : null;
    return c && !c.legId ? 'Save to the trip' : 'Save to this leg';
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.gen++);
    void this.passes.ensureReady();
    void this.files.ensureReady().then(() => this.deleteAfter.set(this.files.prefs().deletePassesAfterTrip));
    this.deleteAfter.set(this.files.prefs().deletePassesAfterTrip);
    // A photo or PDF shared into the app (/share-in) arrives here to be read like a picked file.
    const shared = this.inbox.takeHandoff();
    if (shared) afterNextRender(() => void this.readFile(shared, shared.type === 'application/pdf' || /\.pdf$/i.test(shared.name) ? 'pdf' : 'image'), { injector: this.injector });
    // ?src=camera starts the scanner; ?src=file puts focus on "Photo or screenshot".
    effect(() => {
      const src = this.src();
      untracked(() => {
        if (src === 'camera' && this.step() === 'pick') this.scan();
        if (src === 'file') afterNextRender(() => this.photoBtn()?.nativeElement.focus(), { injector: this.injector });
      });
    });
  }

  protected warm(): void {
    this.barcode.warmUp();
  }

  protected scan(): void {
    this.gen++;
    this.camera.set('idle');
    this.failure.set('none');
    this.active.set('camera');
    this.step.set('scan');
  }

  protected cameraOff(): void {
    this.camera.set('off');
    this.step.set('pick');
    this.active.set(null);
    afterNextRender(() => this.photoBtn()?.nativeElement.focus(), { injector: this.injector });
  }

  protected pick(input: HTMLInputElement): void {
    input.value = '';
    input.click();
  }

  protected async onFile(e: Event, kind: 'image' | 'pdf'): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await this.readFile(file, kind === 'pdf' || file.type === 'application/pdf' ? 'pdf' : 'image');
  }

  /** Decodes a picked file (exposed for specs). */
  async readFile(file: File, kind: 'image' | 'pdf'): Promise<void> {
    const t = this.trip();
    if (!t) return;
    const gen = ++this.gen;
    this.active.set(kind);
    this.camera.set('idle');
    this.fileError.set(null);
    if (file.size > MAX_FILE_BYTES) {
      this.lastFile.set(null);
      this.fail('tooLarge');
      return;
    }
    this.lastFile.set(file);
    this.step.set('reading');
    try {
      if (kind === 'pdf') {
        const { reads, pageImages } = await this.barcode.decodePdf(file, 3);
        if (gen !== this.gen) return;
        const pages = [...new Set(reads.map(r => r.page ?? 0))];
        const images = new Map<number, Blob | null>();
        pages.forEach((p, i) => images.set(p, pageImages[i] ?? null));
        this.show(reads, t, images, 'pdf', file);
      } else {
        const read = await this.barcode.decodeImage(file);
        if (gen !== this.gen) return;
        this.show(read ? [read] : [], t, new Map([[0, file]]), 'image', file);
      }
    } catch {
      if (gen === this.gen) this.fail('unreadable');
    }
  }

  protected onScan(r: ScanResult): void {
    const t = this.trip();
    if (!t) return;
    this.gen++;
    this.lastFile.set(null);
    this.show([r.read], t, new Map([[0, r.frame]]), 'camera', null);
  }

  private show(reads: DecodedRead[], trip: Trip, images: Map<number, Blob | null>, source: PassSource, file: File | null): void {
    if (!reads.length) return this.fail('none');
    const drafts = buildDrafts(reads, trip);
    if (!drafts.length) return this.fail(reads.some(r => !parseBcbp(r.text).ok) ? 'notBcbp' : 'none');
    const hint = this.hintLeg();
    const choices: Record<string, DraftChoice | null> = {};
    for (const d of drafts) choices[d.key] = initialChoice(d, hint);
    success();
    this.decoded.set({ drafts, images, source, file });
    this.choices.set(choices);
    // Multi-leg barcodes: legs that matched are ticked; with a single draft it is always included.
    this.included.set(new Set(drafts.filter(d => drafts.length === 1 || d.candidates.length > 0).map(d => d.key)));
    this.userDate.set({});
    this.pickerFor.set(null);
    this.checkIn.set(false);
    this.saveError.set(null);
    this.step.set('check');
    window.scrollTo?.({ top: 0 });
    // The source buttons are gone: move focus to the new step's title so it is announced.
    afterNextRender(() => this.checkTtl()?.nativeElement.focus({ preventScroll: true }), { injector: this.injector });
  }

  private fail(f: Failure): void {
    this.failure.set(f);
    this.step.set('fail');
  }

  protected retry(): void {
    const input = this.active() === 'pdf' ? this.pdfIn() : this.photoIn();
    if (input) this.pick(input.nativeElement);
  }

  /** "Save the image as a file on this leg": FilesService, scoped to the leg the page came from (else the trip). */
  protected async saveAsFile(): Promise<void> {
    const file = this.lastFile();
    const t = this.trip();
    if (!file || !t) return;
    this.busy.set(true);
    const leg = this.hintLeg();
    const res = await this.files.addFile(t.id, leg ? { kind: 'leg', legId: leg } : { kind: 'trip' }, file);
    this.busy.set(false);
    if ('error' in res) {
      this.fileError.set(FILES_ERROR_TEXT[res.error]);
      return;
    }
    this.state.flash(leg ? 'Image saved as a file on this leg' : 'Image saved as a file on this trip');
    this.close();
  }

  protected restart(): void {
    this.gen++;
    this.decoded.set(null);
    this.step.set('pick');
    this.active.set(null);
    afterNextRender(() => this.photoBtn()?.nativeElement.focus(), { injector: this.injector });
  }

  protected close(): void {
    const t = this.trip();
    this.state.goBack(t ? tripPath(t.id) : ['/trips']);
  }

  // ---- check step -------------------------------------------------------------------

  protected choiceOf(key: string): DraftChoice | null {
    return this.choices()[key] ?? null;
  }

  protected choiceKey(key: string): string | null {
    const c = this.choiceOf(key);
    if (!c) return null;
    return c.legId ?? '';
  }

  /** The suggestion card: the chosen candidate, shown while the user hasn't opened the picker for it. */
  protected suggested(d: PassDraft) {
    const c = this.choiceOf(d.key);
    if (!c || c.legId === null || c.matched !== 'confirmed') return null;
    if (d.candidates.length > 1 && this.pickerFor() !== null) return null;
    return d.candidates.find(x => x.legId === c.legId && x.refIndex === c.refIndex) ?? null;
  }

  protected showPicker(d: PassDraft): boolean {
    if (this.pickerFor() === d.key) return true;
    const c = this.choiceOf(d.key);
    if (d.candidates.length > 1) return !this.suggested(d);
    return !c || c.legId === null || c.matched === 'manual';
  }

  protected options(d: PassDraft): { id: string; label: string; fits: boolean }[] {
    const t = this.trip();
    if (!t) return [];
    const fits = new Set(d.candidates.map(c => c.legId));
    const legs = flightLegs(t).map(l => ({ id: l.id, label: legOptionLabel(l), fits: fits.has(l.id) }));
    // Candidates first (in match order), then the other flight legs.
    legs.sort((a, b) => Number(b.fits) - Number(a.fits));
    return [...legs, { id: '', label: 'No leg, keep it with the trip', fits: false }];
  }

  protected choose(d: PassDraft, legId: string): void {
    const t = this.trip();
    if (!t) return;
    this.choices.update(m => ({ ...m, [d.key]: pickLeg(d, t, legId || null) }));
  }

  protected toggleInclude(key: string, on: boolean): void {
    this.included.update(s => {
      const n = new Set(s);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });
  }

  protected setDate(key: string, v: string): void {
    this.userDate.update(m => ({ ...m, [key]: v }));
  }

  protected name(d: PassDraft): string {
    return passName(d.passenger);
  }

  protected day(key: string): string {
    return dayLabel(key);
  }

  protected julian(d: PassDraft) {
    const c = this.choiceOf(d.key);
    const cand = c?.legId ? d.candidates.find(x => x.legId === c.legId) : undefined;
    return julianLabel(d.leg.julian, cand?.dateKey ?? d.dateKey ?? (this.userDate()[d.key] || null));
  }

  protected bcLabel(d: PassDraft): string {
    return barcodeLabel(d.format, d.legCount);
  }

  protected rawText(d: PassDraft): string {
    return displayText(d.raw);
  }

  protected matchText(ref: FlightRef): string {
    const t = this.trip();
    return t ? matchLine(t, ref, this.state.timeFormat()) : '';
  }

  protected altText(d: PassDraft): string {
    return alternateText(d.flightNumber);
  }

  /**
   * "Swap to AC812": the leg becomes the backup (same swap and Undo as
   * Recover), then this pass is matched to the new leg; Save links it.
   * Undo puts the trip back and the pass back to unmatched.
   */
  protected swapToBackup(d: PassDraft): void {
    const t = this.trip();
    if (!t || !d.alternate) return;
    const done = this.swapper.swapToBackup(t.id, d.alternate, () => this.rematch(null));
    if (!done) return;
    this.rematch({ key: d.key, choice: { legId: done.legId, refIndex: done.refIndex, matched: 'confirmed' } });
  }

  private rematch(set: { key: string; choice: DraftChoice } | null): void {
    const t = this.trip();
    const dec = this.decoded();
    if (!t || !dec) return;
    const drafts = rematchDrafts(dec.drafts, t);
    this.decoded.set({ ...dec, drafts });
    this.choices.update(m => {
      const next: Record<string, DraftChoice | null> = {};
      for (const d of drafts) {
        if (set && d.key === set.key) next[d.key] = set.choice;
        else {
          const c = m[d.key] ?? null;
          // A choice of a leg that no longer exists (after Undo) is dropped.
          next[d.key] = c && c.legId && !legById(t, c.legId) ? initialChoice(d, null) : c ?? initialChoice(d, null);
        }
      }
      return next;
    });
  }

  protected async save(): Promise<void> {
    const t = this.trip();
    const dec = this.decoded();
    if (!t || !dec || !this.canSave()) return;
    this.busy.set(true);
    this.saveError.set(null);
    const saved: PassRecord[] = [];
    let error: FilesError | null = null;
    for (const d of dec.drafts) {
      if (!this.included().has(d.key)) continue;
      const choice = this.choiceOf(d.key);
      const input = toNewPass(d, t, choice, {
        source: dec.source, deleteAfterTrip: this.deleteAfter(), userDate: this.userDate()[d.key] || null,
      });
      // Every leg of one barcode (and every pass on one PDF page) shares the same Blob: stored once.
      const image = dec.images.get(dec.source === 'pdf' ? (d.page ?? 0) : 0) ?? null;
      const res = await this.passes.save(input, image);
      if ('error' in res) {
        error = res.error;
        break;
      }
      saved.push(res);
    }
    if (saved.length && this.checkIn()) {
      // Only legs whose pass was actually saved.
      const savedLegs = new Set(saved.map(r => r.legId).filter((x): x is string => !!x));
      for (const l of this.checkInLegs()) if (savedLegs.has(l.id)) this.tripsSvc.setLegStatus(t.id, l.id, 'checkedIn');
    }
    this.busy.set(false);
    if (error && !saved.length) {
      this.saveError.set(FILES_ERROR_TEXT[error]);
      return;
    }
    if (!saved.length) return;
    this.state.flash(error ? `${savedText(saved)}. ${FILES_ERROR_TEXT[error]}` : savedText(saved));
    void this.router.navigate(passPath(t.id, saved[0].id), { replaceUrl: true, queryParams: this.state.globalParams() });
  }
}
