/**
 * The trip recap image (F3): a 1080-wide PNG drawn on this phone once a trip's
 * way home is boarded. A destination photo (when there is one), the place,
 * the dates, one line of facts ("4 flights · 11,240 km · 2 countries"), an
 * optional route arc and an optional standby record ("Boarded 3 of 4 tries",
 * off by default). Built from counts only: no booking codes, passes, files
 * or notes can reach it.
 *
 * recapLayout() is pure (positions only, tested); renderRecapCard() draws it
 * with the trip card's canvas helpers.
 */
import { PHOTO_BASE } from '../state/photo.service';
import { type TripRecap, recapLine, standbyRecordLine, tripRecap } from '../logbook/logbook';
import type { Outcome, Trip } from '../trips/model';
import { formatKey } from '../utils/time';
import {
  type AnyCanvas, CARD, CARD_MIN_H, CARD_WIDTH, type CardBlock, type Ctx, FONT, INNER, type Measure, PAD,
  approxMeasure, drawArc, drawBackground, drawFooter, ellipsize, loadCardFonts, makeCanvas, setSpacing, toPng,
} from './trip-card';

export const RECAP_PHOTO_H = 640;
const FOOT_H = 60;
const NO_PHOTO_MIN_H = 640;
const LINE_MAX = 60;
const LINE_MIN = 34;

export interface RecapOptions {
  /** The flight log's outcomes, so the counts agree with the logbook. */
  outcomes?: readonly Outcome[];
  /** Draw the dashed route arc (off by default). */
  arc: boolean;
  /** Add "Boarded X of Y tries" (off by default). */
  standbyRecord: boolean;
}
export const DEFAULT_RECAP_OPTIONS: RecapOptions = { arc: false, standbyRecord: false };

export type RecapBlock =
  | { kind: 'photo'; y: number; h: number }
  | { kind: 'eyebrow'; y: number; text: string }
  | { kind: 'title'; y: number; text: string; size: number }
  | { kind: 'dates'; y: number; text: string }
  | { kind: 'line'; y: number; text: string; size: number }
  | { kind: 'arc'; y: number; h: number; from: string; to: string }
  | { kind: 'record'; y: number; text: string }
  | Extract<CardBlock, { kind: 'footer' }>;

export interface RecapLayout { width: 1080; height: number; blocks: RecapBlock[] }

export interface RecapHead {
  title: string;
  dates: string;
  line: string;
  record: string | null;
  from: string;
  to: string;
  arc: boolean;
  /** True when a destination photo will be drawn at the top. */
  photo: boolean;
  measure?: Measure;
}

function fit(text: string, font: (px: number) => string, max: number, min: number, measure: Measure, step = 4): number {
  let size = max;
  while (size > min && measure(text, font(size)) > INNER) size -= step;
  return size;
}

export const recapLineFont = (px: number) => `700 ${px}px Inter, system-ui, -apple-system, 'Segoe UI', sans-serif`;

/** Cuts text to `max` px with a trailing '…' (a title still too long at the smallest size). */
export function ellipsizeText(text: string, font: string, max: number, measure: Measure): string {
  if (measure(text, font) <= max) return text;
  let t = text;
  while (t.length > 1 && measure(`${t}…`, font) > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Where everything goes, in px of the 1080-wide image. */
export function recapLayout(head: RecapHead): RecapLayout {
  const measure = head.measure ?? approxMeasure;
  const blocks: RecapBlock[] = [];
  let y = PAD;
  if (head.photo) {
    blocks.push({ kind: 'photo', y: 0, h: RECAP_PHOTO_H });
    y = RECAP_PHOTO_H + 52;
  }
  blocks.push({ kind: 'eyebrow', y, text: 'TRIP RECAP' });
  y += 52;
  const size = fit(head.title, FONT.title, 112, 64, measure);
  blocks.push({ kind: 'title', y, text: ellipsizeText(head.title, FONT.title(size), INNER, measure), size });
  y += size + 14;
  blocks.push({ kind: 'dates', y, text: head.dates });
  y += 64;
  const lineSize = fit(head.line, recapLineFont, LINE_MAX, LINE_MIN, measure, 2);
  blocks.push({ kind: 'line', y, text: head.line, size: lineSize });
  y += lineSize + 30;
  if (head.arc) {
    blocks.push({ kind: 'arc', y, h: 170, from: head.from, to: head.to });
    y += 196;
  }
  if (head.record) {
    blocks.push({ kind: 'record', y, text: head.record });
    y += 56;
  }
  const height = Math.max(head.photo ? CARD_MIN_H : NO_PHOTO_MIN_H, y + 48 + FOOT_H + PAD);
  blocks.push({ kind: 'footer', y: height - PAD - FOOT_H, mark: 'Routes', fine: 'Made on this phone' });
  return { width: CARD_WIDTH, height, blocks };
}

/** 'Oct 8 – Oct 13'; one date when they match. */
export function recapDates(trip: Trip): string {
  const flights = trip.legs.flatMap(l => (l.kind === 'flight' && l.status === 'boarded' ? l.refs : []));
  const first = flights.map(r => r.dateKey).sort()[0] ?? trip.outboundDate;
  const last = flights.map(r => r.arrDateKey || r.dateKey).sort().at(-1) ?? trip.outboundDate;
  const f = (k: string) => formatKey(k, { month: 'short', day: 'numeric' });
  return first === last ? f(first) : `${f(first)} – ${f(last)}`;
}

export function recapHead(trip: Trip, opts: RecapOptions, hasPhoto: boolean, measure?: Measure, recap: TripRecap = tripRecap(trip, opts.outcomes)): RecapHead {
  return {
    title: trip.goal.name,
    dates: recapDates(trip),
    line: recapLine(recap),
    record: opts.standbyRecord && recap.tries > 0 ? standbyRecordLine(recap) : null,
    from: trip.fromHub,
    to: trip.goal.acCode ?? trip.goal.name,
    arc: opts.arc,
    photo: hasPhoto,
    measure,
  };
}

// ---- drawing -------------------------------------------------------------

/** A decoded destination photo and its CSS-style focal point, or null. */
export interface RecapPhoto { image: CanvasImageSource; width: number; height: number; position: string }

export interface RecapDeps {
  canvas?: (w: number, h: number) => AnyCanvas;
  fonts?: () => Promise<void>;
  /** The destination photo for an AC code; null when there is none. Defaults to /img/dest/CODE.webp. */
  photo?: (code: string) => Promise<RecapPhoto | null>;
}

/** Loads public/img/dest/CODE.webp (same origin, so the canvas stays exportable). */
export async function loadDestPhoto(code: string, position = '50% 50%'): Promise<RecapPhoto | null> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return null;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ image: img, width: img.naturalWidth, height: img.naturalHeight, position });
    img.onerror = () => resolve(null);
    img.src = new URL(`${PHOTO_BASE}${code}.webp`, document.baseURI).href;
  });
}

/** Cover-fit source rectangle of a photo into a w×h box, honouring a '50% 30%' focal point. */
export function coverRect(
  iw: number, ih: number, w: number, h: number, position: string,
): { sx: number; sy: number; sw: number; sh: number } {
  const [px, py] = position.split(/\s+/).map(p => Math.min(1, Math.max(0, parseFloat(p) / 100)));
  const fx = Number.isFinite(px) ? px : 0.5;
  const fy = Number.isFinite(py) ? py : 0.5;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale, sh = h / scale;
  return { sx: (iw - sw) * fx, sy: (ih - sh) * fy, sw, sh };
}

function drawPhoto(ctx: Ctx, b: Extract<RecapBlock, { kind: 'photo' }>, photo: RecapPhoto): void {
  const r = coverRect(photo.width, photo.height, CARD_WIDTH, b.h, photo.position);
  ctx.drawImage(photo.image, r.sx, r.sy, r.sw, r.sh, 0, b.y, CARD_WIDTH, b.h);
  // A soft fade into the card below.
  const g = ctx.createLinearGradient(0, b.y + b.h - 160, 0, b.y + b.h);
  g.addColorStop(0, 'rgba(255, 255, 255, 0)');
  g.addColorStop(1, 'rgba(255, 255, 255, 0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(0, b.y + b.h - 160, CARD_WIDTH, 160);
}

export function drawRecap(ctx: Ctx, layout: RecapLayout, photo: RecapPhoto | null): void {
  drawBackground(ctx, layout.width, layout.height);
  for (const b of layout.blocks) {
    ctx.textAlign = 'left';
    switch (b.kind) {
      case 'photo':
        if (photo) drawPhoto(ctx, b, photo);
        break;
      case 'eyebrow':
        ctx.textBaseline = 'top';
        setSpacing(ctx, '2.6px');
        ctx.font = FONT.eyebrow;
        ctx.fillStyle = CARD.sub;
        ctx.fillText(b.text, PAD, b.y);
        setSpacing(ctx, '0px');
        break;
      case 'title':
        ctx.textBaseline = 'alphabetic';
        setSpacing(ctx, `${-(b.size * 0.03).toFixed(1)}px`);
        ctx.font = FONT.title(b.size);
        ctx.fillStyle = CARD.ink;
        ctx.fillText(b.text, PAD - 4, b.y + b.size * 0.86);
        setSpacing(ctx, '0px');
        break;
      case 'dates':
        ctx.textBaseline = 'top';
        ctx.font = FONT.dates;
        ctx.fillStyle = CARD.sub;
        ctx.fillText(b.text, PAD, b.y);
        break;
      case 'line':
        ctx.textBaseline = 'top';
        ctx.font = recapLineFont(b.size);
        ctx.fillStyle = CARD.ink;
        ctx.fillText(ellipsize(ctx, b.text, INNER), PAD, b.y);
        break;
      case 'arc':
        drawArc(ctx, b.y, b.h, b.from, b.to);
        break;
      case 'record':
        ctx.textBaseline = 'top';
        ctx.font = FONT.dates;
        ctx.fillStyle = CARD.sub;
        ctx.fillText(b.text, PAD, b.y);
        break;
      case 'footer':
        drawFooter(ctx, b);
        break;
    }
  }
}

/** The recap card as a PNG Blob (1080 wide). */
export async function renderRecapCard(
  trip: Trip, opts: RecapOptions = DEFAULT_RECAP_OPTIONS, deps: RecapDeps = {},
): Promise<Blob> {
  await (deps.fonts ?? (() => loadCardFonts()))();
  const code = trip.goal.acCode ?? null;
  const photo = code ? await (deps.photo ?? (c => loadDestPhoto(c)))(code).catch(() => null) : null;
  const probe = (deps.canvas ?? makeCanvas)(8, 8).getContext('2d') as Ctx | null;
  const measure: Measure | undefined = probe
    ? (text, font) => { probe.font = font; return probe.measureText(text).width; }
    : undefined;
  const layout = recapLayout(recapHead(trip, opts, !!photo, measure));
  const canvas = (deps.canvas ?? makeCanvas)(layout.width, layout.height);
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d') as Ctx | null;
  if (!ctx) throw new Error('The card could not be drawn.');
  drawRecap(ctx, layout, photo);
  return toPng(canvas);
}

/** 'seville-trip-recap.png'. */
export function recapFilename(trip: Trip): string {
  const slug = trip.goal.name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'trip'}-recap.png`;
}
