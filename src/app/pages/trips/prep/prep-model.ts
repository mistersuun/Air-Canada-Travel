/**
 * View-model for the trip Prep tab (mockup g7). Pure.
 */
import type { PrepItem } from '../../../places/prep';
import type { LegStatus, Trip } from '../../../trips/model';

export interface PrepRow {
  item: PrepItem;
  /** Detail text before the link, the link, and the text after it (any part may be empty). */
  pre: string;
  link: { label: string; url: string } | null;
  post: string;
  /** What a tap does: store the tick, set the leg status, or open the leg to save the real times. */
  action: { kind: 'prep' } | { kind: 'status'; legId: string } | { kind: 'leg'; legId: string };
  /** A custom item can be removed. */
  customId: string | null;
}

/** 'list:<legId>:<i>' / 'ground:<legId>' / 'checkin:<legId>' → legId. */
export function legIdOf(itemId: string): string {
  return itemId.split(':')[1] ?? '';
}

/**
 * Splits the detail around the link. A detail that starts with the link's
 * name ('Official EU page · not required until it starts') turns that part
 * into the link; otherwise the link follows the detail, labelled 'Official
 * page' for short.
 */
export function detailParts(item: PrepItem): { pre: string; link: { label: string; url: string } | null; post: string } {
  const detail = item.detail ?? '';
  if (!item.link) return { pre: detail, link: null, post: '' };
  const lead = /^Official [^·]+?(?=\s·|$)/.exec(detail);
  if (lead) return { pre: '', link: { label: lead[0], url: item.link.url }, post: detail.slice(lead[0].length) };
  return { pre: detail ? `${detail} · ` : '', link: { label: item.link.label, url: item.link.url }, post: '' };
}

export function prepRow(item: PrepItem): PrepRow {
  const { pre, link, post } = detailParts(item);
  const action: PrepRow['action'] = item.source === 'manual'
    ? { kind: 'prep' }
    : item.id.startsWith('ground:') ? { kind: 'leg', legId: legIdOf(item.id) } : { kind: 'status', legId: legIdOf(item.id) };
  return { item, pre, link, post, action, customId: item.id.startsWith('custom:') ? item.id.slice(7) : null };
}

/** '2 of 5 done'. */
export function doneLabel(items: readonly PrepItem[]): string {
  return `${items.filter(i => i.done).length} of ${items.length} done`;
}

/**
 * The leg status a listing tick sets: ticking a planned leg makes it Listed;
 * unticking a Listed leg puts it back to Planned. Later statuses (checked in,
 * boarded) are not undone from the checklist: null = no change.
 */
export function listingStatus(trip: Trip, legId: string, done: boolean): LegStatus | null {
  const leg = trip.legs.find(l => l.id === legId);
  if (!leg) return null;
  if (done) return leg.status === 'planned' ? 'listed' : null;
  return leg.status === 'listed' ? 'planned' : null;
}
