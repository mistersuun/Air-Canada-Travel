/**
 * Calendar export for a whole trip (spec §5.5). Every flight segment is a
 * TENTATIVE event ("Tentative standby · AC834 YUL→MAD") with a listing
 * reminder 48h before; ground legs are timed when the user saved real times,
 * else all-day "Estimated · Madrid → Seville train". Alternates are not
 * exported. A plan, not a booking: every description says so.
 */
import { aircraftName } from '../../utils/aircraft';
import { airportName } from '../../utils/airports';
import { escapeIcsText, foldIcsLine, icsUtc } from '../../utils/ics';
import { addDays, toUtcMs } from '../../utils/time';
import { FlightRef, GroundLeg, Trip, TripLeg } from '../model';
import { endTz, refArrUtc, refDepUtc } from './legs';

const CRLF = '\r\n';
const PRODID = '-//Routes//Trip export//EN';
const UID_DOMAIN = 'routes-trips';
/** SEQUENCE is seconds since this epoch: monotonic per export, and inside a 32-bit int. */
const SEQUENCE_EPOCH_S = 1_700_000_000;
/** Replaced legs are history, not plans. */
const SKIP: readonly TripLeg['status'][] = ['notBoarded', 'abandoned', 'didntTry'];

const MODE_LABEL: Record<GroundLeg['mode'], string> = {
  train: 'train', bus: 'bus', car: 'drive', ferry: 'ferry', flight: 'flight', other: 'trip',
};

function flightEvent(trip: Trip, ref: FlightRef, stamp: string, seq: number): string[] {
  const label = `${ref.flightNumber} ${ref.origin}→${ref.dest}`;
  const plane = ref.aircraft ? ` · ${aircraftName(ref.aircraft)}` : '';
  const desc = [
    `Standby plan for ${trip.name}, not a booking.`,
    `${ref.flightNumber}${plane}: ${ref.origin} ${ref.depLocal} → ${ref.dest} ${ref.arrLocal}, local times (scheduled).`,
    'Listing is your own step: check your pass rules and the Air Canada app.',
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
    `SUMMARY:${escapeIcsText(`Tentative standby · ${label}`)}`,
    `LOCATION:${escapeIcsText(`${airportName(ref.origin)} (${ref.origin})`)}`,
    `DESCRIPTION:${escapeIcsText(desc)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT48H',
    `DESCRIPTION:${escapeIcsText(`List for ${ref.flightNumber} (check your pass rules)`)}`,
    'END:VALARM',
    'END:VEVENT',
  ];
}

function groundEvent(trip: Trip, leg: GroundLeg, stamp: string, seq: number): string[] {
  const route = `${leg.from.name} → ${leg.to.name}`;
  const mode = MODE_LABEL[leg.mode];
  const out = ['BEGIN:VEVENT', `UID:${trip.id}-${leg.id}@${UID_DOMAIN}`, `DTSTAMP:${stamp}`, `LAST-MODIFIED:${stamp}`, `SEQUENCE:${seq}`];
  const fromTz = endTz(leg.from) ?? trip.goal.tz ?? 'UTC';
  const toTz = endTz(leg.to) ?? fromTz;
  if (leg.provenance === 'saved' && leg.userTimes) {
    const t = leg.userTimes;
    out.push(
      `DTSTART:${icsUtc(toUtcMs(t.depDateKey, t.depLocal, fromTz))}`,
      `DTEND:${icsUtc(toUtcMs(t.arrDateKey, t.arrLocal, toTz))}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      `SUMMARY:${escapeIcsText(`${route} ${mode}`)}`,
      `DESCRIPTION:${escapeIcsText([`Saved by you: ${t.depLocal} → ${t.arrLocal}, local times.`, leg.note].filter(Boolean).join('\n'))}`,
    );
  } else {
    out.push(
      `DTSTART;VALUE=DATE:${leg.dateKey.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${addDays(leg.dateKey, 1).replace(/-/g, '')}`,
      'STATUS:TENTATIVE',
      'TRANSP:TRANSPARENT',
      `SUMMARY:${escapeIcsText(`${leg.provenance === 'unknown' ? 'Unknown' : 'Estimated'} · ${route} ${mode}`)}`,
      `DESCRIPTION:${escapeIcsText('Only estimated so far: find the real times and save them in the trip.')}`,
    );
  }
  out.push('END:VEVENT');
  return out;
}

export function buildTripIcs(trip: Trip, now: number): string {
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
    if (leg.kind === 'flight') for (const ref of leg.refs) lines.push(...flightEvent(trip, ref, stamp, seq));
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
