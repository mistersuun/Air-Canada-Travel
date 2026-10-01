/**
 * The shared Seville fixture (spec §2.10), used by every Trips workstream.
 *
 * SEVILLE_ROUTES are the real rows from the schedules generated 2026-09-30
 * (verified), so specs reproduce the mockups exactly. Inject them with
 * setScheduleSource(SEVILLE_ROUTES, SEVILLE_META) and call
 * resetScheduleSource() in afterEach. Times are local at each airport.
 *
 * Calendar: Thu 2026-10-08 (outbound), Fri Oct 9, Mon Oct 12 (Thanksgiving),
 * Tue Oct 13 (home by 22:00), Wed Oct 14.
 */
import type { ScheduleRoute, SchedulesMeta } from '../../data/schedule-index';
import { ALL_DAYS, rec, route } from '../../data/testing/schedule-fixtures';
import type { Place, Trip, TripsFile } from '../model';

const FROM = '2026-09-29';
const TO = '2027-09-26';

export const SEVILLE_META: SchedulesMeta = {
  generatedAt: '2026-09-30T18:10:52Z',
  coverageFrom: FROM,
  coverageTo: TO,
  hubToHub: true,
};

export const SEVILLE_ROUTES: ScheduleRoute[] = [
  route('YUL', 'MAD', rec('AC834', '17:55', '06:50', '2026-10-01', '2026-10-31', ALL_DAYS, '333')),
  route('YUL', 'LIS', rec('AC812', '21:45', '09:20', FROM, TO, 'Mon,Tue,Wed,Thu,Fri,Sun', '333')),
  route('YUL', 'BCN', rec('AC822', '18:35', '08:00', FROM, TO, ALL_DAYS, '333')),
  route('YUL', 'OPO', rec('AC928', '19:30', '07:10', FROM, TO, 'Mon,Tue,Wed,Fri,Sat', '32Q')),
  route('LIS', 'YUL', rec('AC813', '11:25', '13:50', FROM, TO, 'Mon,Tue,Wed,Thu,Fri,Sat', '333')),
  route('LIS', 'YYZ', rec('AC811', '13:00', '15:55', FROM, TO, ALL_DAYS, '77W')),
  route('YYZ', 'YUL',
    rec('AC894', '17:30', '18:52', FROM, TO, ALL_DAYS, '77W'),
    rec('AC422', '18:00', '19:21', FROM, TO, ALL_DAYS, '321'),
    rec('AC424', '19:00', '20:21', FROM, TO, ALL_DAYS, '223'),
    rec('AC426', '20:30', '21:50', FROM, TO, ALL_DAYS, '223'),
  ),
  route('YUL', 'YYZ',
    rec('AC421', '17:30', '18:53', FROM, TO, ALL_DAYS, '223'),
    rec('AC489', '18:30', '19:53', FROM, TO, ALL_DAYS, '320'),
    rec('AC427', '20:30', '21:53', FROM, TO, ALL_DAYS, '321'),
  ),
  route('YYZ', 'MAD', rec('AC824', '19:15', '08:50', FROM, TO, ALL_DAYS, '333')),
  route('YYZ', 'LIS', rec('AC810', '23:00', '11:05', FROM, TO, ALL_DAYS, '77W')),
  route('MAD', 'YUL', rec('AC835', '12:45', '14:55', FROM, TO, 'Mon,Wed,Fri,Sat,Sun', '333')),
  route('MAD', 'YYZ', rec('AC825', '13:30', '16:05', FROM, TO, ALL_DAYS, '333')),
  route('YUL', 'LHR',
    rec('AC866', '18:40', '06:30', FROM, TO, 'Tue,Wed,Fri,Sat,Sun', '333'),
    rec('AC864', '22:10', '10:00', FROM, TO, ALL_DAYS, '333'),
  ),
];

export const SEVILLE_PLACE: Place = {
  id: 'gn-2510911',
  name: 'Seville',
  country: 'Spain',
  iso2: 'ES',
  lat: 37.3886,
  lng: -5.9823,
  tz: 'Europe/Madrid',
  admin1: 'Andalusia',
};

/** Ids used by SEVILLE_TRIP, for specs. */
export const SEVILLE_IDS = {
  trip: 'sevtrip001',
  outbound: 'leg-out834',
  train: 'leg-madsvq',
  bus: 'leg-svqlis',
  ret: 'leg-ret813',
  altBcn: 'alt-bcn822',
  altLis: 'alt-lis812',
} as const;

/**
 * From YUL, 2 travellers staying together, Thu Oct 8 → home by Tue Oct 13 22:00:
 * 1. AC834 YUL→MAD Thu Oct 8 (Listed), backups AC822 BCN and AC812 LIS;
 * 2. Madrid → Seville train Fri Oct 9 (Estimated, 250 min);
 * 3. Seville → Lisbon bus Mon Oct 12 09:00 → 14:45 (Saved by you);
 * 4. AC813 LIS→YUL Tue Oct 13 (Planned, return).
 */
export const SEVILLE_TRIP: Trip = {
  v: 1,
  id: SEVILLE_IDS.trip,
  name: 'Seville trip',
  createdAt: '2026-09-28T23:12:00.000Z',
  updatedAt: '2026-10-01T13:38:00.000Z',
  goal: SEVILLE_PLACE,
  party: {
    count: 2,
    stayTogether: true,
    splitNote: 'Meet at Seville Santa Justa station. Whoever arrives first books the room.',
  },
  fromHub: 'YUL',
  homeAirport: 'YUL',
  outboundDate: '2026-10-08',
  homeBy: { dateKey: '2026-10-13', hhmm: '22:00' },
  legs: [
    {
      kind: 'flight',
      id: SEVILLE_IDS.outbound,
      role: 'outbound',
      status: 'listed',
      statusAt: '2026-09-30T14:00:00.000Z',
      note: '',
      provenance: 'scheduled',
      refs: [{
        flightNumber: 'AC834', origin: 'YUL', dest: 'MAD', dateKey: '2026-10-08',
        depLocal: '17:55', arrLocal: '06:50', arrDateKey: '2026-10-09', aircraft: '333',
      }],
      alternates: [
        {
          id: SEVILLE_IDS.altBcn,
          addedAt: '2026-09-28T23:12:00.000Z',
          refs: [{
            flightNumber: 'AC822', origin: 'YUL', dest: 'BCN', dateKey: '2026-10-08',
            depLocal: '18:35', arrLocal: '08:00', arrDateKey: '2026-10-09', aircraft: '333',
          }],
        },
        {
          id: SEVILLE_IDS.altLis,
          addedAt: '2026-09-28T23:12:00.000Z',
          refs: [{
            flightNumber: 'AC812', origin: 'YUL', dest: 'LIS', dateKey: '2026-10-08',
            depLocal: '21:45', arrLocal: '09:20', arrDateKey: '2026-10-09', aircraft: '333',
          }],
        },
      ],
    },
    {
      kind: 'ground',
      id: SEVILLE_IDS.train,
      status: 'planned',
      statusAt: null,
      note: '',
      mode: 'train',
      from: { name: 'Madrid', code: 'MAD', lat: 40.47, lng: -3.57, tz: 'Europe/Madrid' },
      to: { name: 'Seville', lat: 37.3886, lng: -5.9823, tz: 'Europe/Madrid' },
      dateKey: '2026-10-09',
      estMinutes: 250,
      provenance: 'estimated',
      userTimes: null,
    },
    {
      kind: 'ground',
      id: SEVILLE_IDS.bus,
      status: 'planned',
      statusAt: null,
      note: 'your note',
      mode: 'bus',
      from: { name: 'Seville', lat: 37.3886, lng: -5.9823, tz: 'Europe/Madrid' },
      to: { name: 'Lisbon', code: 'LIS', lat: 38.77, lng: -9.13, tz: 'Europe/Lisbon' },
      dateKey: '2026-10-12',
      estMinutes: 480,
      provenance: 'saved',
      userTimes: { depDateKey: '2026-10-12', depLocal: '09:00', arrDateKey: '2026-10-12', arrLocal: '14:45' },
    },
    {
      kind: 'flight',
      id: SEVILLE_IDS.ret,
      role: 'return',
      status: 'planned',
      statusAt: null,
      note: '',
      provenance: 'scheduled',
      refs: [{
        flightNumber: 'AC813', origin: 'LIS', dest: 'YUL', dateKey: '2026-10-13',
        depLocal: '11:25', arrLocal: '13:50', arrDateKey: '2026-10-13', aircraft: '333',
      }],
      alternates: [],
    },
  ],
  prep: {},
  customPrep: [],
  changes: [],
  scheduleGeneratedAt: '2026-09-30T18:10:52Z',
  offlineSavedAt: '2026-10-01T13:38:00.000Z',
  calendarExportedAt: '2026-10-01T13:38:00.000Z',
  sharedFrom: null,
  archived: false,
};

/** The TripsFile form QA seeds into localStorage['ac.trips.v1']. */
export const SEVILLE_TRIPS_FILE: TripsFile = { schema: 1, trips: [SEVILLE_TRIP] };

/** A deep copy, so specs can mutate freely. */
export function sevilleTrip(): Trip {
  return JSON.parse(JSON.stringify(SEVILLE_TRIP)) as Trip;
}
