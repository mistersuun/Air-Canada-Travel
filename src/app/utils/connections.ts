import { HUBS, Destination, DESTINATIONS } from '../data/destinations';
import { getFlightForDay, getFlightsForWeek, DayFlight } from './week';
import { getSchedulesForRoute } from '../data/schedules';

export interface ConnectionLeg {
  from: string;
  to: string;
  departure: string;
  arrival: string;
  flightNumber: string;
  aircraft: string;
}

export interface ConnectionOption {
  destination: Destination;
  viaHub: string;
  viaHubName: string;
  leg1Duration: number;
  layoverMinutes: number;
  leg1: ConnectionLeg;
  leg2: ConnectionLeg;
  date: Date;
}

export interface ConnectingRoute {
  destination: Destination;
  isDirect: boolean;
  directFlight?: DayFlight;
  connections: ConnectionOption[];
}

const HUB_FLIGHTS: Record<string, Record<string, { duration: number; flights: string[] }>> = {
  YUL: {
    YYZ: { duration: 80, flights: ['06:00','07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00'] },
    YOW: { duration: 35, flights: ['07:00','09:00','11:00','13:00','15:00','17:00','19:00'] },
    YVR: { duration: 300, flights: ['08:00','10:30','14:00','17:00','20:00'] },
    YYC: { duration: 265, flights: ['08:00','10:00','14:00','18:00'] },
    YHZ: { duration: 105, flights: ['07:00','10:00','14:00','17:00','20:00'] },
    YEG: { duration: 275, flights: ['08:00','14:00','18:00'] },
    YWG: { duration: 185, flights: ['08:00','14:00','18:00'] },
    YQB: { duration: 50, flights: ['07:00','10:00','14:00','17:00','20:00'] },
  },
  YYZ: {
    YUL: { duration: 80, flights: ['06:00','07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00'] },
    YOW: { duration: 60, flights: ['07:00','09:00','11:00','13:00','15:00','17:00','19:00'] },
    YVR: { duration: 285, flights: ['07:00','08:00','09:30','11:00','13:00','15:00','17:00','19:00','21:00'] },
    YYC: { duration: 245, flights: ['07:00','08:30','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YHZ: { duration: 120, flights: ['07:00','10:00','13:00','16:00','19:00'] },
    YEG: { duration: 260, flights: ['08:00','11:00','15:00','19:00'] },
    YWG: { duration: 170, flights: ['07:00','10:00','14:00','18:00'] },
    YQB: { duration: 90, flights: ['07:00','10:00','14:00','17:00','20:00'] },
  },
  YVR: {
    YYZ: { duration: 275, flights: ['06:00','07:30','09:00','11:00','13:00','15:00','17:00','19:00'] },
    YUL: { duration: 290, flights: ['07:00','10:00','14:00','18:00'] },
    YYC: { duration: 75, flights: ['06:00','07:00','08:00','09:00','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YEG: { duration: 85, flights: ['06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YWG: { duration: 155, flights: ['07:00','11:00','16:00'] },
  },
  YYC: {
    YYZ: { duration: 235, flights: ['06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YUL: { duration: 255, flights: ['07:00','11:00','15:00','19:00'] },
    YVR: { duration: 70, flights: ['06:00','07:00','08:00','09:00','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YEG: { duration: 55, flights: ['06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YOW: { duration: 225, flights: ['07:00','12:00','17:00'] },
  },
  YOW: {
    YYZ: { duration: 60, flights: ['06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YUL: { duration: 35, flights: ['07:00','09:00','11:00','13:00','15:00','17:00','19:00'] },
    YVR: { duration: 290, flights: ['08:00','14:00'] },
    YYC: { duration: 255, flights: ['08:00','14:00'] },
  },
  YHZ: {
    YYZ: { duration: 130, flights: ['06:00','08:00','10:00','13:00','16:00','19:00'] },
    YUL: { duration: 110, flights: ['07:00','10:00','14:00','17:00','20:00'] },
    YOW: { duration: 100, flights: ['08:00','14:00','18:00'] },
  },
  YEG: {
    YYZ: { duration: 250, flights: ['06:00','09:00','13:00','17:00'] },
    YVR: { duration: 80, flights: ['06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YYC: { duration: 50, flights: ['06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00'] },
    YUL: { duration: 265, flights: ['07:00','14:00','18:00'] },
  },
  YQB: {
    YYZ: { duration: 100, flights: ['06:00','08:00','11:00','15:00','18:00'] },
    YUL: { duration: 50, flights: ['07:00','10:00','14:00','17:00','20:00'] },
  },
  YWG: {
    YYZ: { duration: 160, flights: ['06:00','09:00','14:00','18:00'] },
    YVR: { duration: 165, flights: ['07:00','12:00','17:00'] },
    YYC: { duration: 130, flights: ['07:00','11:00','16:00'] },
    YUL: { duration: 175, flights: ['07:00','14:00','18:00'] },
  },
};

const MIN_LAYOVER = 60;
const MAX_LAYOVER = 360;

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function hubName(code: string): string {
  return HUBS.find(h => h.code === code)?.name ?? code;
}

export function findConnections(
  homeHub: string,
  destCode: string,
  date: Date
): ConnectionOption[] {
  const dest = DESTINATIONS.find(d => d.code === destCode);
  if (!dest) return [];

  const hubRoutes = HUB_FLIGHTS[homeHub];
  if (!hubRoutes) return [];

  const results: ConnectionOption[] = [];

  for (const connectingHub of Object.keys(hubRoutes)) {
    const leg2Flight = getFlightForDay(connectingHub, destCode, date);
    if (!leg2Flight.flies || !leg2Flight.departure) continue;

    const hubInfo = hubRoutes[connectingHub];
    const leg2DepMinutes = timeToMinutes(leg2Flight.departure);

    for (const leg1Dep of hubInfo.flights) {
      const leg1DepMinutes = timeToMinutes(leg1Dep);
      const leg1ArrMinutes = leg1DepMinutes + hubInfo.duration;
      const layover = leg2DepMinutes - leg1ArrMinutes;

      if (layover >= MIN_LAYOVER && layover <= MAX_LAYOVER) {
        results.push({
          destination: dest,
          viaHub: connectingHub,
          viaHubName: hubName(connectingHub),
          leg1Duration: hubInfo.duration,
          layoverMinutes: layover,
          leg1: {
            from: homeHub,
            to: connectingHub,
            departure: leg1Dep,
            arrival: minutesToTime(leg1ArrMinutes),
            flightNumber: 'AC',
            aircraft: 'A220/E175',
          },
          leg2: {
            from: connectingHub,
            to: destCode,
            departure: leg2Flight.departure!,
            arrival: leg2Flight.arrival!,
            flightNumber: leg2Flight.flightNumber!,
            aircraft: leg2Flight.aircraft ?? '',
          },
          date,
        });
      }
    }
  }

  results.sort((a, b) => {
    const aTotal = timeToMinutes(a.leg1.departure);
    const bTotal = timeToMinutes(b.leg1.departure);
    return aTotal - bTotal;
  });

  return results;
}

export function findConnectionsForWeek(
  homeHub: string,
  destCode: string,
  weekStart: Date
): boolean {
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    if (findConnections(homeHub, destCode, date).length > 0) return true;
  }
  return false;
}

export function getBestConnection(
  homeHub: string,
  destCode: string,
  date: Date
): ConnectionOption | null {
  const all = findConnections(homeHub, destCode, date);
  if (!all.length) return null;
  return all.reduce((best, c) =>
    c.layoverMinutes < best.layoverMinutes ? c : best
  );
}

export function formatLayover(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
