/**
 * The share image (extras spec §6.4, mock x14): a 1080-wide PNG drawn on a
 * canvas on this phone. cardLayout() is pure (positions only, tested);
 * renderTripCard() draws it.
 *
 * Content: "TRIP PLAN", the goal, dates and party, a dashed arc from the hub
 * to the goal, one row per leg (day, mode icon, title, label pill, local
 * time), the optional split-up note, and the "Routes" wordmark with "Times
 * local · not a ticket". Built only from tripShareRows(): no booking codes,
 * passes or files can reach it.
 */
import { ICON_PATHS, type IconName } from '../components/shared/icons.component';
import type { GroundMode, Trip } from '../trips/model';
import { type ShareOptions, type ShareRow, shareSubtitle, splitNote, tripShareRows } from './trip-share-text';

/**
 * Fixed light palette. The image is the same in dark mode on purpose: it is
 * sent to other people's chats, where it must read on any background, and a
 * dark card would look like a different app once it leaves this phone.
 */
export const CARD = {
  ink: '#0B1220',
  sub: '#5B6475',
  faint: '#8A93A4',
  blue: '#0A84FF',
  red: '#D8222A',
  hair: 'rgba(11, 18, 32, 0.08)',
  skyTop: '#CFE6FF',
  skyMid: '#EAF3FF',
  white: '#FFFFFF',
  sun: 'rgba(255, 214, 140, 0.85)',
  noteBg: 'rgba(255, 255, 255, 0.72)',
} as const;

/** Label pill colours: the app's light tag tints (12–16% of the colour, text darkened toward ink). */
export const PILL: Record<ShareRow['tone'], { bg: string; ink: string }> = {
  scheduled: { bg: 'rgba(10, 132, 255, 0.12)', ink: '#0A5CB1' },
  estimated: { bg: 'rgba(183, 121, 31, 0.15)', ink: '#7B551F' },
  saved: { bg: 'rgba(31, 138, 122, 0.14)', ink: '#18605A' },
  unknown: { bg: 'rgba(11, 18, 32, 0.07)', ink: '#5B6475' },
};

export const CARD_WIDTH = 1080;
export const CARD_MIN_H = 1080;
export const CARD_MAX_H = 1920;

const SANS = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";
const COND = "'Barlow Condensed', Inter, sans-serif";

/** Fonts (canvas `font` strings). */
export const FONT = {
  eyebrow: `700 32px ${SANS}`,
  title: (px: number) => `700 ${px}px ${SANS}`,
  dates: `500 40px ${SANS}`,
  code: `700 46px ${COND}`,
  day: `650 34px ${SANS}`,
  rowTitle: `650 40px ${SANS}`,
  pill: `600 30px ${SANS}`,
  time: `700 54px ${COND}`,
  backups: `500 30px ${SANS}`,
  more: `600 32px ${SANS}`,
  noteLabel: `700 28px ${SANS}`,
  note: `500 36px ${SANS}`,
  mark: `650 34px ${SANS}`,
  fine: `500 32px ${SANS}`,
} as const;

export const PAD = 60;
export const INNER = CARD_WIDTH - PAD * 2;
const TITLE_MAX = 112;
const TITLE_MIN = 64;
const ROW_H = 138;
const BACKUPS_H = 42;
const MORE_H = 92;
const NOTE_LINE = 50;
const NOTE_MAX_LINES = 4;
const FOOT_H = 60;

export type Measure = (text: string, font: string) => number;

/** A rough width for layout when no canvas is at hand (tests, workers). */
export const approxMeasure: Measure = (text, font) => {
  const px = Number(/(\d+)px/.exec(font)?.[1] ?? 16);
  return text.length * px * (font.includes('Barlow') ? 0.42 : 0.55);
};

export type CardBlock =
  | { kind: 'eyebrow'; y: number; text: string }
  | { kind: 'title'; y: number; text: string; size: number }
  | { kind: 'dates'; y: number; text: string }
  | { kind: 'arc'; y: number; h: number; from: string; to: string }
  | { kind: 'row'; y: number; h: number; row: ShareRow }
  | { kind: 'more'; y: number; h: number; text: string }
  | { kind: 'note'; y: number; h: number; label: string; lines: string[] }
  | { kind: 'footer'; y: number; mark: string; fine: string };

export interface CardLayout { width: 1080; height: number; blocks: CardBlock[] }

export interface CardHead {
  title: string;              // 'Seville'
  dates: string;              // 'Thu Oct 8 → Tue Oct 13 · 2 travellers'
  from: string;               // 'YUL'
  to: string;                 // 'SVQ' or 'Seville'
  note: string | null;        // the split-up note, when included
  measure?: Measure;
}

/** Greedy word wrap to `max` px; the last kept line gets '…' when text is cut. */
export function wrapText(text: string, font: string, max: number, maxLines: number, measure: Measure): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (!cur || measure(next, font) <= max) { cur = next; continue; }
    lines.push(cur);
    cur = w;
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && measure(`${last}…`, font) > max) last = last.slice(0, -1).trimEnd();
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

/** The biggest title size (TITLE_MAX down to TITLE_MIN) that fits one line. */
function titleSize(text: string, measure: Measure): number {
  let size = TITLE_MAX;
  while (size > TITLE_MIN && measure(text, FONT.title(size)) > INNER) size -= 4;
  return size;
}

/**
 * Where everything goes, in px of the 1080-wide image. The height follows
 * the rows (at least 1080, at most 1920); rows that do not fit become one
 * "+N more in the app" line.
 */
export function cardLayout(rows: ShareRow[], head: CardHead): CardLayout {
  const measure = head.measure ?? approxMeasure;
  const blocks: CardBlock[] = [];
  let y = PAD;
  blocks.push({ kind: 'eyebrow', y, text: 'TRIP PLAN' });
  y += 52;
  const size = titleSize(head.title, measure);
  blocks.push({ kind: 'title', y, text: head.title, size });
  y += size + 14;
  blocks.push({ kind: 'dates', y, text: head.dates });
  y += 54;
  blocks.push({ kind: 'arc', y, h: 170, from: head.from, to: head.to });
  y += 196;

  const noteLines = head.note ? wrapText(head.note, FONT.note, INNER - 72, NOTE_MAX_LINES, measure) : [];
  const noteH = noteLines.length ? 30 + 40 + noteLines.length * NOTE_LINE + 26 : 0;
  const tail = (noteH ? 30 + noteH : 0) + 48 + FOOT_H + PAD;
  const rowH = (r: ShareRow) => ROW_H + (r.backups ? BACKUPS_H : 0);

  let shown = rows.length;
  const fits = (n: number) => {
    const body = rows.slice(0, n).reduce((s, r) => s + rowH(r), 0) + (n < rows.length ? MORE_H : 0);
    return y + body + tail <= CARD_MAX_H;
  };
  while (shown > 0 && !fits(shown)) shown--;

  for (const r of rows.slice(0, shown)) {
    const h = rowH(r);
    blocks.push({ kind: 'row', y, h, row: r });
    y += h;
  }
  if (shown < rows.length) {
    const n = rows.length - shown;
    blocks.push({ kind: 'more', y, h: MORE_H, text: `+${n} more ${n === 1 ? 'leg' : 'legs'} in the app` });
    y += MORE_H;
  }
  if (noteH) {
    y += 30;
    blocks.push({ kind: 'note', y, h: noteH, label: 'IF WE SPLIT UP', lines: noteLines });
    y += noteH;
  }
  const height = Math.min(CARD_MAX_H, Math.max(CARD_MIN_H, y + 48 + FOOT_H + PAD));
  blocks.push({ kind: 'footer', y: height - PAD - FOOT_H, mark: 'Routes', fine: 'Times local · not a ticket' });
  return { width: CARD_WIDTH, height, blocks };
}

/** The arc's end label: the goal's own airport when AC flies there, else its name. */
export function cardHead(trip: Trip, opts: ShareOptions, measure?: Measure): CardHead {
  return {
    title: trip.goal.name,
    dates: shareSubtitle(trip),
    from: trip.fromHub,
    to: trip.goal.acCode ?? trip.goal.name,
    note: opts.includeSplitNote ? splitNote(trip) : null,
    measure,
  };
}

// ---- drawing -------------------------------------------------------------

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface CardDeps {
  canvas?: (w: number, h: number) => AnyCanvas;
  /** Waits for the web fonts; defaults to document.fonts with a 1.5 s cap. */
  fonts?: () => Promise<void>;
}

const MODE_ICON: Record<GroundMode, IconName> = {
  flight: 'plane', train: 'train', bus: 'bus', car: 'car', ferry: 'pin', other: 'pin',
};

/** Inter and Barlow Condensed, when the page has them; system fonts otherwise. */
export async function loadCardFonts(doc: Document | null = typeof document === 'undefined' ? null : document): Promise<void> {
  const fonts = doc?.fonts;
  if (!fonts?.load) return;
  const all = Promise.all([
    fonts.load('600 40px Inter'),
    fonts.load('700 40px Inter'),
    fonts.load('700 40px "Barlow Condensed"'),
  ]).then(() => undefined, () => undefined);
  await Promise.race([all, new Promise<void>(r => setTimeout(r, 1500))]);
}

export function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function setSpacing(ctx: Ctx, v: string): void {
  if ('letterSpacing' in ctx) (ctx as { letterSpacing: string }).letterSpacing = v;
}

/** A 24-unit app icon at (x, y), `size` px, stroked like <app-icon>. */
export function drawIcon(ctx: Ctx, name: IconName, x: number, y: number, size: number, color: string, filled = false): void {
  if (typeof Path2D === 'undefined') return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.lineWidth = 1.9;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  for (const d of ICON_PATHS[name] ?? []) {
    const p = new Path2D(d);
    if (filled) ctx.fill(p);
    else ctx.stroke(p);
  }
  ctx.restore();
}

export function drawBackground(ctx: Ctx, w: number, h: number): void {
  // 165deg sky wash, as the mock's .scard.
  const g = ctx.createLinearGradient(w * 0.37, 0, w * 0.63, h);
  g.addColorStop(0, CARD.skyTop);
  g.addColorStop(0.46, CARD.skyMid);
  g.addColorStop(1, CARD.white);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // The mock's sun: a 170px disc set 40px past the top-right corner (×3).
  const sx = w - 135, sy = 135, sr = 270;
  const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
  sun.addColorStop(0, CARD.sun);
  sun.addColorStop(0.68, 'rgba(255, 214, 140, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
}

export function ellipsize(ctx: Ctx, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

export function drawArc(ctx: Ctx, y: number, h: number, from: string, to: string): void {
  const x0 = PAD + 20, x1 = CARD_WIDTH - PAD - 20, base = y + h - 34;
  ctx.save();
  ctx.strokeStyle = CARD.blue;
  ctx.lineWidth = 5;
  ctx.setLineDash([12, 15]);
  ctx.beginPath();
  ctx.moveTo(x0, base);
  ctx.bezierCurveTo(x0 + (x1 - x0) * 0.27, y - 10, x1 - (x1 - x0) * 0.27, y - 10, x1, base);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = CARD.ink;
  ctx.beginPath(); ctx.arc(x0, base, 14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = CARD.red;
  ctx.beginPath(); ctx.arc(x1, base, 14, 0, Math.PI * 2); ctx.fill();
  ctx.font = FONT.code;
  ctx.fillStyle = CARD.ink;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(from, x0 + 30, base + 16);
  ctx.textAlign = 'right';
  ctx.fillText(ellipsize(ctx, to, (x1 - x0) / 2), x1 - 30, base + 16);
  ctx.restore();
}

function drawRow(ctx: Ctx, b: Extract<CardBlock, { kind: 'row' }>): void {
  const r = b.row;
  const mid = b.y + ROW_H / 2;
  ctx.fillStyle = CARD.hair;
  ctx.fillRect(PAD, b.y, INNER, 3);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = FONT.day;
  ctx.fillStyle = CARD.sub;
  ctx.fillText(r.day, PAD, mid);

  // Mode icon in a soft white disc.
  const ix = PAD + 150;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.beginPath(); ctx.arc(ix + 30, mid, 30, 0, Math.PI * 2); ctx.fill();
  const icon = MODE_ICON[r.mode] ?? 'pin';
  drawIcon(ctx, icon, ix + 12, mid - 18, 36, r.mode === 'flight' ? CARD.blue : CARD.ink, icon === 'plane');

  const tx = ix + 84;
  ctx.font = FONT.time;
  const timeW = r.time ? ctx.measureText(r.time).width + 24 : 0;
  const textMax = CARD_WIDTH - PAD - tx - timeW;

  ctx.font = FONT.rowTitle;
  ctx.fillStyle = CARD.ink;
  ctx.fillText(ellipsize(ctx, r.title, textMax), tx, mid - 22);

  ctx.font = FONT.pill;
  const pill = PILL[r.tone];
  const label = ellipsize(ctx, r.label, textMax - 32);
  const pw = ctx.measureText(label).width + 32;
  ctx.fillStyle = pill.bg;
  roundRect(ctx, tx, mid + 8, pw, 44, 22);
  ctx.fill();
  ctx.fillStyle = pill.ink;
  ctx.fillText(label, tx + 16, mid + 31);

  if (r.time) {
    ctx.textAlign = 'right';
    ctx.font = FONT.time;
    ctx.fillStyle = CARD.ink;
    ctx.fillText(r.time, CARD_WIDTH - PAD, mid);
    ctx.textAlign = 'left';
  }
  if (r.backups) {
    ctx.font = FONT.backups;
    ctx.fillStyle = CARD.sub;
    ctx.fillText(ellipsize(ctx, r.backups, CARD_WIDTH - PAD - tx), tx, b.y + ROW_H + 8);
  }
}

function drawNote(ctx: Ctx, b: Extract<CardBlock, { kind: 'note' }>): void {
  ctx.fillStyle = CARD.noteBg;
  roundRect(ctx, PAD, b.y, INNER, b.h, 36);
  ctx.fill();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  setSpacing(ctx, '2.5px');
  ctx.font = FONT.noteLabel;
  ctx.fillStyle = CARD.sub;
  ctx.fillText(b.label, PAD + 36, b.y + 30 + 26);
  setSpacing(ctx, '0px');
  ctx.font = FONT.note;
  ctx.fillStyle = CARD.ink;
  b.lines.forEach((line, i) => ctx.fillText(line, PAD + 36, b.y + 30 + 40 + 36 + i * NOTE_LINE));
}

export function drawFooter(ctx: Ctx, b: Extract<CardBlock, { kind: 'footer' }>): void {
  const mid = b.y + FOOT_H / 2;
  ctx.fillStyle = CARD.red;
  roundRect(ctx, PAD, mid - 27, 54, 54, 16);
  ctx.fill();
  drawIcon(ctx, 'plane', PAD + 11, mid - 16, 32, CARD.white, true);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = FONT.mark;
  ctx.fillStyle = CARD.ink;
  ctx.fillText(b.mark, PAD + 72, mid);
  ctx.textAlign = 'right';
  ctx.font = FONT.fine;
  ctx.fillStyle = CARD.faint;
  ctx.fillText(b.fine, CARD_WIDTH - PAD, mid);
}

/** Draws a layout onto a 2D context sized layout.width × layout.height. */
export function drawCard(ctx: Ctx, layout: CardLayout): void {
  drawBackground(ctx, layout.width, layout.height);
  for (const b of layout.blocks) {
    ctx.textAlign = 'left';
    switch (b.kind) {
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
      case 'arc':
        drawArc(ctx, b.y, b.h, b.from, b.to);
        break;
      case 'row':
        drawRow(ctx, b);
        break;
      case 'more':
        ctx.fillStyle = CARD.hair;
        ctx.fillRect(PAD, b.y, INNER, 3);
        ctx.textBaseline = 'middle';
        ctx.font = FONT.more;
        ctx.fillStyle = CARD.sub;
        ctx.fillText(b.text, PAD, b.y + b.h / 2);
        break;
      case 'note':
        drawNote(ctx, b);
        break;
      case 'footer':
        drawFooter(ctx, b);
        break;
    }
  }
}

export async function toPng(canvas: AnyCanvas): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('The card could not be drawn.'))), 'image/png'));
}

/** The share card as a PNG Blob (1080 wide, 1080–1920 tall). */
export async function renderTripCard(trip: Trip, opts: ShareOptions, deps: CardDeps = {}): Promise<Blob> {
  await (deps.fonts ?? (() => loadCardFonts()))();
  const rows = tripShareRows(trip, opts);
  // Measure with a real context so long titles and notes wrap where they are drawn.
  const probe = (deps.canvas ?? makeCanvas)(8, 8).getContext('2d') as Ctx | null;
  const measure: Measure | undefined = probe
    ? (text, font) => { probe.font = font; return probe.measureText(text).width; }
    : undefined;
  const layout = cardLayout(rows, cardHead(trip, opts, measure));
  const canvas = (deps.canvas ?? makeCanvas)(layout.width, layout.height);
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d') as Ctx | null;
  if (!ctx) throw new Error('The card could not be drawn.');
  drawCard(ctx, layout);
  return toPng(canvas);
}
