/**
 * Synthetic route network for behavioural tests. Specs inject it with
 * setRouteNetworkSource(ROUTE_NETWORK_FIXTURE) and restore with
 * resetRouteNetworkSource() in afterEach.
 *
 * - YHZ-BOS, YHZ-EWR: Air Canada Express, year-round, no times anywhere.
 * - YHZ-YOW: Express hub-to-hub leg the Vacations PDFs leave out.
 * - YHZ-YDF: Express to Deer Lake, a regional airport the app has no page for.
 * - YHZ-BGI: Rouge, seasonal, starts 2026-12-17.
 * - YHZ-YYZ: also in FIXTURE_ROUTES (AC603), so never "route only".
 */
import type { RouteNetworkFile } from '../route-network';

export const ROUTE_NETWORK_FIXTURE: RouteNetworkFile = {
  version: 1,
  license: 'CC BY-SA 4.0',
  attribution: 'Wikipedia contributors (CC BY-SA 4.0); OurAirports (public domain)',
  meta: {
    builtAt: '2026-10-01T06:00:00Z',
    routeCount: 6,
    sources: [{ hub: 'YHZ', title: 'Halifax Stanfield International Airport', revid: 1, url: 'https://en.wikipedia.org/w/index.php?oldid=1' }],
  },
  airports: {
    YDF: ['Deer Lake', 'CA', 'America/St_Johns', 49.21, -57.39],
  },
  routes: {
    'YHZ-BOS': ['X', 0, null, null, null],
    'YHZ-EWR': ['X', 0, null, null, null],
    'YHZ-YOW': ['X', 0, null, null, null],
    'YHZ-YDF': ['X', 0, null, null, null],
    'YHZ-BGI': ['R', 1, '2026-12-17', null, null],
    'YHZ-YYZ': ['A', 0, null, null, null],
  },
};
