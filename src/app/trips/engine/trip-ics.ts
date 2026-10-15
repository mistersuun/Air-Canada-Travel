/**
 * Calendar export for a whole trip (spec §5.5). Every flight segment is a
 * TENTATIVE event ("Tentative standby · AC834 YUL→MAD") with a listing
 * reminder (48h before by default; a setting); ground legs are timed when the user saved real times,
 * else all-day "Estimated · Madrid → Seville train". Alternates are not
 * exported. A plan, not a booking: every description says so.
 */
import { t } from '../../i18n/t';
import { aircraftName } from '../../utils/aircraft';
import { airportName } from '../../utils/airports';
import { escapeIcsText, foldIcsLine, icsUtc } from '../../utils/ics';
import { addDays, toUtcMs } from '../../utils/time';
import type { MsgKey } from '../../i18n/t';
import { FlightRef, GroundLeg, Trip, TripLeg } from '../model';
import { endTz, refArrUtc, refDepUtc } from './legs';
import { DEFAULT_LISTING_HOURS } from './listing';

const CRLF = '\r\n';
const PRODID = '-//Routes//Trip export//EN'; // i18n-ignore
const UID_DOMAIN = 'routes-trips';
/** SEQUENCE is seconds since this epoch: monotonic per export, and inside a 32-bit int. */
const SEQUENCE_EPOCH_S = 1_700_000_000;
/** Replaced legs are history, not plans. */
const SKIP: readonly TripLeg['status'][] = ['notBoarded', 'abandoned', 'didntTry'];

const MODE_KEY: Record<GroundLeg['mode'], MsgKey> = {
  train: 'trips.mode.train', bus: 'trips.mode.bus', car: 'trips.mode.drive', ferry: 'trips.mode.ferry',
  flight: 'trips.mode.flight', other: 'trips.mode.trip',
};

function flightEvent(trip: Trip, ref: FlightRef, stamp: string, seq: number, listingHours: number): string[] {
  const label = `${ref.flightNumber} ${ref.origin}→${ref.dest}`;
  const plane = ref.aircraft ? ` · ${aircraftName(ref.aircraft)}` : '';
  const desc = [
    t('trips.ics.plan', { name: trip.name }),
    t('trips.ics.times', { flight: `${ref.flightNumber}${plane}`, origin: ref.origin, dep: ref.depLocal, dest: ref.dest, arr: ref.arrLocal }),
    t('trips.ics.listingNote'),
  ].join('\n');
  return [
    'BEGIN:VEVENT',
    `UID:${trip.id}-${ref.flightNumber}-${ref.origin}${ref.dest}-${ref.dateKey}@${UID_DOMAIN}`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    `SEQUENCE:${seq}`,
    `DTSTART:${icsUtc(refDepUtc(ref))}`,
    `DTEND:${icsUtc(refArrUtc(ref))}`,
    'STATUS:TENTATIVE',
    'TRANSP:OPAQUE',
    `SUMMARY:${escapeIcsText(t('trips.ics.summary', { label }))}`,
    `LOCATION:${escapeIcsText(`${airportName(ref.origin)} (${ref.origin})`)}`,
    `DESCRIPTION:${escapeIcsText(desc)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `TRIGGER:-PT${listingHours}H`,
    `DESCRIPTION:${escapeIcsText(t('trips.ics.alarm', { flight: ref.flightNumber }))}`,
    'END:VALARM',
    'END:VEVENT',
  ];
}

function groundEvent(trip: Trip, leg: GroundLeg, stamp: string, seq: number): string[] {
  const route = `${leg.from.name} → ${leg.to.name}`;
  const mode = t(MODE_KEY[leg.mode]);
  const out = ['BEGIN:VEVENT', `UID:${trip.id}-${leg.id}@${UID_DOMAIN}`, `DTSTAMP:${stamp}`, `LAST-MODIFIED:${stamp}`, `SEQUENCE:${seq}`];
  const fromTz = endTz(leg.from) ?? trip.goal.tz ?? 'UTC';
  const toTz = endTz(leg.to) ?? fromTz;
  if (leg.provenance === 'saved' && leg.userTimes) {
    const ut = leg.userTimes;
    out.push(
      `DTSTART:${icsUtc(toUtcMs(ut.depDateKey, ut.depLocal, fromTz))}`,
      `DTEND:${icsUtc(toUtcMs(ut.arrDateKey, ut.arrLocal, toTz))}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      `SUMMARY:${escapeIcsText(`${route} ${mode}`)}`,
      `DESCRIPTION:${escapeIcsText([t('trips.ics.saved', { dep: ut.depLocal, arr: ut.arrLocal }), leg.note].filter(Boolean).join('\n'))}`,
    );
  } else {
    out.push(
      `DTSTART;VALUE=DATE:${leg.dateKey.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${addDays(leg.dateKey, 1).replace(/-/g, '')}`,
      'STATUS:TENTATIVE',
      'TRANSP:TRANSPARENT',
      `SUMMARY:${escapeIcsText(t(leg.provenance === 'unknown' ? 'trips.ics.unknownGround' : 'trips.ics.estimatedGround', { route, mode }))}`,
      `DESCRIPTION:${escapeIcsText(t('trips.ics.estimatedNote'))}`,
    );
  }
  out.push('END:VEVENT');
  return out;
}

/** `listingHours`: how long before each flight the listing reminder fires (Settings, default 48). */
export function buildTripIcs(trip: Trip, now: number, listingHours = DEFAULT_LISTING_HOURS): string {
  const stamp = icsUtc(now);
  const seq = Math.max(0, Math.floor(now / 1000) - SEQUENCE_EPOCH_S);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(trip.name)}`,
  ];
  for (const leg of trip.legs) {
    if (SKIP.includes(leg.status)) continue;
    if (leg.kind === 'flight') for (const ref of leg.refs) lines.push(...flightEvent(trip, ref, stamp, seq, listingHours));
    else lines.push(...groundEvent(trip, leg, stamp, seq));
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

/** 'routes-seville-2026-10-08.ics'. */
export function tripIcsFilename(trip: Trip): string {
  const slug = trip.goal.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trip';
  return `routes-${slug}-${trip.outboundDate}.ics`;
}
