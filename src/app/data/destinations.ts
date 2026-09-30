export type DestinationType = 'Sun' | 'City' | 'Adventure' | 'Hub';

export interface Destination {
  city: string;
  country: string;
  code: string;
  /** ISO 3166-1 alpha-2 country code, used for the flag emoji. */
  iso2: string;
  /** IANA time zone of the airport; all schedule times are local to it. */
  tz: string;
  lat: number;
  lng: number;
  region: string;
  type: DestinationType;
  /** Marketing figure only; real durations come from FlightInstance.durationMin. */
  duration: string;
  /** Marketing figure only; real equipment comes from FlightInstance.aircraft. */
  aircraft: string;
  season: string;
  isNew?: boolean;
}

export interface Hub {
  name: string;
  lat: number;
  lng: number;
  code: string;
  /** IANA time zone of the hub airport. */
  tz: string;
}

export const HUBS: Hub[] = [
  { name: 'Toronto', lat: 43.68, lng: -79.62, code: 'YYZ', tz: 'America/Toronto' },
  { name: 'Montreal', lat: 45.47, lng: -73.74, code: 'YUL', tz: 'America/Toronto' },
  { name: 'Vancouver', lat: 49.20, lng: -123.18, code: 'YVR', tz: 'America/Vancouver' },
  { name: 'Calgary', lat: 51.13, lng: -114.01, code: 'YYC', tz: 'America/Edmonton' },
  { name: 'Ottawa', lat: 45.32, lng: -75.67, code: 'YOW', tz: 'America/Toronto' },
  { name: 'Halifax', lat: 44.88, lng: -63.51, code: 'YHZ', tz: 'America/Halifax' },
  { name: 'Edmonton', lat: 53.31, lng: -113.58, code: 'YEG', tz: 'America/Edmonton' },
  { name: 'Quebec City', lat: 46.79, lng: -71.39, code: 'YQB', tz: 'America/Toronto' },
  { name: 'Winnipeg', lat: 49.91, lng: -97.24, code: 'YWG', tz: 'America/Winnipeg' },
  // Toronto's island airport: its own origin section in the PDFs (BOS, LGA, IAD, ORD).
  { name: 'Toronto Billy Bishop', lat: 43.63, lng: -79.40, code: 'YTZ', tz: 'America/Toronto' },
];

export const REGIONS = [
  'All', 'Caribbean', 'Mexico', 'USA', 'Europe',
  'Asia & Pacific', 'Central America', 'South America', 'Africa & Middle East'
];

export const TYPES = ['All', 'Sun', 'City', 'Adventure'] as const;

/**
 * @deprecated Use `regionVar(region)` from utils/region-color (CSS custom
 * properties with dark-theme variants). Kept until route-card and flight-modal
 * are restyled (WS5/WS6).
 */
export const REGION_COLORS: Record<string, string> = {
  'Caribbean': '#0EA5E9',
  'Mexico': '#E89020',
  'USA': '#6366F1',
  'Europe': '#8B5CF6',
  'Asia & Pacific': '#10B981',
  'Central America': '#65A30D',
  'South America': '#F97316',
  'Africa & Middle East': '#E05090',
};

export const DESTINATIONS: Destination[] = [
  // ─── CARIBBEAN ───
  { city: 'Punta Cana', country: 'Dominican Republic', code: 'PUJ', iso2: 'DO', tz: 'America/Santo_Domingo', lat: 18.57, lng: -68.37, region: 'Caribbean', type: 'Sun', duration: '4h 45m', aircraft: '737 MAX 8', season: 'Oct – Apr' },
  { city: 'Montego Bay', country: 'Jamaica', code: 'MBJ', iso2: 'JM', tz: 'America/Jamaica', lat: 18.50, lng: -77.91, region: 'Caribbean', type: 'Sun', duration: '4h 15m', aircraft: 'A321', season: 'Year-round' },
  { city: 'Nassau', country: 'Bahamas', code: 'NAS', iso2: 'BS', tz: 'America/Nassau', lat: 25.04, lng: -77.47, region: 'Caribbean', type: 'Sun', duration: '3h 10m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Bridgetown', country: 'Barbados', code: 'BGI', iso2: 'BB', tz: 'America/Barbados', lat: 13.07, lng: -59.49, region: 'Caribbean', type: 'Sun', duration: '5h 25m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Providenciales', country: 'Turks & Caicos', code: 'PLS', iso2: 'TC', tz: 'America/Grand_Turk', lat: 21.77, lng: -72.27, region: 'Caribbean', type: 'Sun', duration: '4h 25m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Fort-de-France', country: 'Martinique', code: 'FDF', iso2: 'MQ', tz: 'America/Martinique', lat: 14.59, lng: -61.00, region: 'Caribbean', type: 'Sun', duration: '5h 10m', aircraft: '737 MAX 8', season: 'Year-round', isNew: true },
  { city: 'Oranjestad', country: 'Aruba', code: 'AUA', iso2: 'AW', tz: 'America/Aruba', lat: 12.50, lng: -70.01, region: 'Caribbean', type: 'Sun', duration: '5h 05m', aircraft: 'A319', season: 'Year-round' },
  { city: 'Pointe-à-Pitre', country: 'Guadeloupe', code: 'PTP', iso2: 'GP', tz: 'America/Guadeloupe', lat: 16.27, lng: -61.53, region: 'Caribbean', type: 'Sun', duration: '4h 55m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Hamilton', country: 'Bermuda', code: 'BDA', iso2: 'BM', tz: 'Atlantic/Bermuda', lat: 32.36, lng: -64.68, region: 'Caribbean', type: 'Sun', duration: '3h 50m', aircraft: 'A319', season: 'Year-round' },
  { city: 'Port of Spain', country: 'Trinidad & Tobago', code: 'POS', iso2: 'TT', tz: 'America/Port_of_Spain', lat: 10.60, lng: -61.34, region: 'Caribbean', type: 'Sun', duration: '5h 45m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Antigua', country: 'Antigua & Barbuda', code: 'ANU', iso2: 'AG', tz: 'America/Antigua', lat: 17.13, lng: -61.79, region: 'Caribbean', type: 'Sun', duration: '4h 50m', aircraft: 'A321', season: 'Mar – Apr' },
  { city: 'Curaçao', country: 'Curaçao', code: 'CUR', iso2: 'CW', tz: 'America/Curacao', lat: 12.19, lng: -68.96, region: 'Caribbean', type: 'Sun', duration: '5h 10m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'George Town', country: 'Cayman Islands', code: 'GCM', iso2: 'KY', tz: 'America/Cayman', lat: 19.29, lng: -81.36, region: 'Caribbean', type: 'Sun', duration: '4h 10m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Exuma', country: 'Bahamas', code: 'GGT', iso2: 'BS', tz: 'America/Nassau', lat: 23.56, lng: -75.88, region: 'Caribbean', type: 'Sun', duration: '3h 35m', aircraft: 'CRJ-900', season: 'Year-round' },
  { city: 'Grenada', country: 'Grenada', code: 'GND', iso2: 'GD', tz: 'America/Grenada', lat: 12.00, lng: -61.79, region: 'Caribbean', type: 'Sun', duration: '5h 25m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Cozumel', country: 'Mexico', code: 'CZM', iso2: 'MX', tz: 'America/Cancun', lat: 20.52, lng: -86.93, region: 'Caribbean', type: 'Sun', duration: '3h 20m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'San Juan', country: 'Puerto Rico', code: 'SJU', iso2: 'PR', tz: 'America/Puerto_Rico', lat: 18.44, lng: -66.00, region: 'Caribbean', type: 'Sun', duration: '4h 35m', aircraft: 'A321', season: 'Year-round' },
  { city: 'St. Kitts', country: 'St. Kitts & Nevis', code: 'SKB', iso2: 'KN', tz: 'America/St_Kitts', lat: 17.31, lng: -62.72, region: 'Caribbean', type: 'Sun', duration: '4h 55m', aircraft: 'A321', season: 'Mar – Apr' },
  { city: 'St. Maarten', country: 'Sint Maarten', code: 'SXM', iso2: 'SX', tz: 'America/Lower_Princes', lat: 18.04, lng: -63.11, region: 'Caribbean', type: 'Sun', duration: '4h 45m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'St. Lucia', country: 'Saint Lucia', code: 'UVF', iso2: 'LC', tz: 'America/St_Lucia', lat: 13.73, lng: -60.95, region: 'Caribbean', type: 'Sun', duration: '5h 15m', aircraft: 'A319', season: 'Year-round' },
  { city: 'St. Vincent', country: 'Saint Vincent & the Grenadines', code: 'SVD', iso2: 'VC', tz: 'America/St_Vincent', lat: 13.14, lng: -61.21, region: 'Caribbean', type: 'Sun', duration: '5h 20m', aircraft: '737 MAX 8', season: 'Mar – Jul' },
  { city: 'La Romana', country: 'Dominican Republic', code: 'LRM', iso2: 'DO', tz: 'America/Santo_Domingo', lat: 18.45, lng: -68.91, region: 'Caribbean', type: 'Sun', duration: '4h 45m', aircraft: '737 MAX 8', season: 'Dec – Mar' },
  { city: 'Puerto Plata', country: 'Dominican Republic', code: 'POP', iso2: 'DO', tz: 'America/Santo_Domingo', lat: 19.76, lng: -70.57, region: 'Caribbean', type: 'Sun', duration: '4h 30m', aircraft: '737 MAX 8', season: 'Oct – Apr' },
  { city: 'Samaná', country: 'Dominican Republic', code: 'AZS', iso2: 'DO', tz: 'America/Santo_Domingo', lat: 19.27, lng: -69.74, region: 'Caribbean', type: 'Sun', duration: '4h 30m', aircraft: '737 MAX 8', season: 'Nov – Apr' },
  { city: 'Santo Domingo', country: 'Dominican Republic', code: 'SDQ', iso2: 'DO', tz: 'America/Santo_Domingo', lat: 18.43, lng: -69.67, region: 'Caribbean', type: 'City', duration: '4h 40m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Kingston', country: 'Jamaica', code: 'KIN', iso2: 'JM', tz: 'America/Jamaica', lat: 17.94, lng: -76.79, region: 'Caribbean', type: 'City', duration: '4h 20m', aircraft: 'A321', season: 'Year-round' },

  // ─── MEXICO ───
  { city: 'Cancún', country: 'Mexico', code: 'CUN', iso2: 'MX', tz: 'America/Cancun', lat: 21.04, lng: -86.87, region: 'Mexico', type: 'Sun', duration: '7h', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Puerto Vallarta', country: 'Mexico', code: 'PVR', iso2: 'MX', tz: 'America/Mexico_City', lat: 20.68, lng: -105.25, region: 'Mexico', type: 'Sun', duration: '5h 15m', aircraft: '737', season: 'Oct – Apr' },
  { city: 'Los Cabos', country: 'Mexico', code: 'SJD', iso2: 'MX', tz: 'America/Mazatlan', lat: 23.15, lng: -109.72, region: 'Mexico', type: 'Sun', duration: '5h 45m', aircraft: '737 MAX', season: 'Oct – Apr' },
  { city: 'Tulum', country: 'Mexico', code: 'TQO', iso2: 'MX', tz: 'America/Cancun', lat: 20.23, lng: -87.43, region: 'Mexico', type: 'Sun', duration: '4h', aircraft: '737 MAX 8', season: 'Jan – Dec' },
  { city: 'Huatulco', country: 'Mexico', code: 'HUX', iso2: 'MX', tz: 'America/Mexico_City', lat: 15.78, lng: -96.26, region: 'Mexico', type: 'Sun', duration: '5h 30m', aircraft: '737', season: 'Nov – Apr' },
  { city: 'Mexico City', country: 'Mexico', code: 'MEX', iso2: 'MX', tz: 'America/Mexico_City', lat: 19.44, lng: -99.07, region: 'Mexico', type: 'City', duration: '3h 59m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Ixtapa', country: 'Mexico', code: 'ZIH', iso2: 'MX', tz: 'America/Mexico_City', lat: 17.60, lng: -101.46, region: 'Mexico', type: 'Sun', duration: '5h 30m', aircraft: '737', season: 'Nov – Apr' },
  { city: 'Guadalajara', country: 'Mexico', code: 'GDL', iso2: 'MX', tz: 'America/Mexico_City', lat: 20.52, lng: -103.31, region: 'Mexico', type: 'City', duration: '5h 15m', aircraft: '737', season: 'Nov – Apr' },
  { city: 'Monterrey', country: 'Mexico', code: 'MTY', iso2: 'MX', tz: 'America/Monterrey', lat: 25.77, lng: -100.11, region: 'Mexico', type: 'City', duration: '3h 45m', aircraft: 'CRJ-900', season: 'Mar – Apr' },
  { city: 'Merida', country: 'Mexico', code: 'MID', iso2: 'MX', tz: 'America/Merida', lat: 20.94, lng: -89.66, region: 'Mexico', type: 'City', duration: '4h 30m', aircraft: '737 MAX 8', season: 'Nov – Apr' },
  { city: 'Puerto Escondido', country: 'Mexico', code: 'PXM', iso2: 'MX', tz: 'America/Mexico_City', lat: 15.88, lng: -97.09, region: 'Mexico', type: 'Sun', duration: '5h 45m', aircraft: '737 MAX 8', season: 'Nov – Apr' },
  { city: 'Mazatlán', country: 'Mexico', code: 'MZT', iso2: 'MX', tz: 'America/Mazatlan', lat: 23.16, lng: -106.27, region: 'Mexico', type: 'Sun', duration: '4h 50m', aircraft: '737 MAX 8', season: 'Nov – Apr' },

  // ─── USA ───
  { city: 'Los Angeles', country: 'USA', code: 'LAX', iso2: 'US', tz: 'America/Los_Angeles', lat: 33.94, lng: -118.41, region: 'USA', type: 'City', duration: '3h 15m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Miami', country: 'USA', code: 'MIA', iso2: 'US', tz: 'America/New_York', lat: 25.80, lng: -80.29, region: 'USA', type: 'Sun', duration: '3h 59m', aircraft: 'A220-300', season: 'Year-round' },
  { city: 'Nashville', country: 'USA', code: 'BNA', iso2: 'US', tz: 'America/Chicago', lat: 36.13, lng: -86.67, region: 'USA', type: 'City', duration: '2h 20m', aircraft: 'A220', season: 'Year-round' },
  { city: 'Honolulu', country: 'USA', code: 'HNL', iso2: 'US', tz: 'Pacific/Honolulu', lat: 21.32, lng: -157.92, region: 'USA', type: 'Sun', duration: '9h 55m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'San Francisco', country: 'USA', code: 'SFO', iso2: 'US', tz: 'America/Los_Angeles', lat: 37.62, lng: -122.38, region: 'USA', type: 'City', duration: '2h 08m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Orlando', country: 'USA', code: 'MCO', iso2: 'US', tz: 'America/New_York', lat: 28.43, lng: -81.31, region: 'USA', type: 'Sun', duration: '3h 17m', aircraft: 'A321', season: 'Year-round' },
  { city: 'Las Vegas', country: 'USA', code: 'LAS', iso2: 'US', tz: 'America/Los_Angeles', lat: 36.08, lng: -115.15, region: 'USA', type: 'City', duration: '2h 44m', aircraft: 'A320', season: 'Year-round' },
  { city: 'Tampa', country: 'USA', code: 'TPA', iso2: 'US', tz: 'America/New_York', lat: 27.98, lng: -82.53, region: 'USA', type: 'Sun', duration: '3h 17m', aircraft: 'A319', season: 'Year-round' },
  { city: 'Fort Lauderdale', country: 'USA', code: 'FLL', iso2: 'US', tz: 'America/New_York', lat: 26.07, lng: -80.15, region: 'USA', type: 'Sun', duration: '3h 53m', aircraft: 'A321', season: 'Year-round' },
  { city: 'Jacksonville', country: 'USA', code: 'JAX', iso2: 'US', tz: 'America/New_York', lat: 30.49, lng: -81.69, region: 'USA', type: 'City', duration: '2h 35m', aircraft: 'CRJ-900', season: 'May – Sep' },
  { city: 'Kailua-Kona', country: 'USA', code: 'KOA', iso2: 'US', tz: 'Pacific/Honolulu', lat: 19.74, lng: -156.04, region: 'USA', type: 'Sun', duration: '6h', aircraft: '737 MAX 8', season: 'Mar – Apr' },
  { city: 'Maui', country: 'USA', code: 'OGG', iso2: 'US', tz: 'Pacific/Honolulu', lat: 20.90, lng: -156.43, region: 'USA', type: 'Sun', duration: '7h 30m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'West Palm Beach', country: 'USA', code: 'DJT', iso2: 'US', tz: 'America/New_York', lat: 26.68, lng: -80.09, region: 'USA', type: 'Sun', duration: '3h 15m', aircraft: 'CRJ-900', season: 'Mar – Apr' },
  { city: 'Palm Springs', country: 'USA', code: 'PSP', iso2: 'US', tz: 'America/Los_Angeles', lat: 33.83, lng: -116.51, region: 'USA', type: 'Sun', duration: '4h 30m', aircraft: '737 MAX 8', season: 'Mar – Apr' },
  { city: 'Fort Myers', country: 'USA', code: 'RSW', iso2: 'US', tz: 'America/New_York', lat: 26.54, lng: -81.76, region: 'USA', type: 'Sun', duration: '3h 15m', aircraft: 'A321', season: 'Year-round' },
  { city: 'San Diego', country: 'USA', code: 'SAN', iso2: 'US', tz: 'America/Los_Angeles', lat: 32.73, lng: -117.19, region: 'USA', type: 'City', duration: '5h 30m', aircraft: 'CRJ-900', season: 'Year-round' },
  { city: 'Sacramento', country: 'USA', code: 'SMF', iso2: 'US', tz: 'America/Los_Angeles', lat: 38.70, lng: -121.59, region: 'USA', type: 'City', duration: '4h 35m', aircraft: 'CRJ-900', season: 'May – Sep' },
  { city: 'Orange County', country: 'USA', code: 'SNA', iso2: 'US', tz: 'America/Los_Angeles', lat: 33.68, lng: -117.87, region: 'USA', type: 'City', duration: '4h 30m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Sarasota', country: 'USA', code: 'SRQ', iso2: 'US', tz: 'America/New_York', lat: 27.40, lng: -82.55, region: 'USA', type: 'Sun', duration: '3h 10m', aircraft: '737 MAX 8', season: 'Mar – Apr' },
  { city: 'Boston', country: 'USA', code: 'BOS', iso2: 'US', tz: 'America/New_York', lat: 42.36, lng: -71.01, region: 'USA', type: 'City', duration: '1h 30m', aircraft: 'A220-300', season: 'Year-round' },
  { city: 'Newark', country: 'USA', code: 'EWR', iso2: 'US', tz: 'America/New_York', lat: 40.69, lng: -74.17, region: 'USA', type: 'City', duration: '1h 40m', aircraft: 'A220-300', season: 'Year-round' },
  { city: 'Philadelphia', country: 'USA', code: 'PHL', iso2: 'US', tz: 'America/New_York', lat: 39.87, lng: -75.24, region: 'USA', type: 'City', duration: '1h 40m', aircraft: 'A220-300', season: 'Year-round' },
  { city: 'Washington', country: 'USA', code: 'IAD', iso2: 'US', tz: 'America/New_York', lat: 38.95, lng: -77.46, region: 'USA', type: 'City', duration: '1h 50m', aircraft: 'A220-300', season: 'Year-round' },
  { city: 'Chicago', country: 'USA', code: 'ORD', iso2: 'US', tz: 'America/Chicago', lat: 41.97, lng: -87.91, region: 'USA', type: 'City', duration: '1h 50m', aircraft: 'A220-300', season: 'Year-round' },
  { city: 'Atlanta', country: 'USA', code: 'ATL', iso2: 'US', tz: 'America/New_York', lat: 33.64, lng: -84.43, region: 'USA', type: 'City', duration: '2h 20m', aircraft: 'A220-300', season: 'Year-round' },
  { city: 'Denver', country: 'USA', code: 'DEN', iso2: 'US', tz: 'America/Denver', lat: 39.86, lng: -104.67, region: 'USA', type: 'City', duration: '4h 10m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Houston', country: 'USA', code: 'IAH', iso2: 'US', tz: 'America/Chicago', lat: 29.98, lng: -95.34, region: 'USA', type: 'City', duration: '3h 30m', aircraft: 'A220-300', season: 'Year-round' },
  { city: 'Austin', country: 'USA', code: 'AUS', iso2: 'US', tz: 'America/Chicago', lat: 30.20, lng: -97.67, region: 'USA', type: 'City', duration: '3h 40m', aircraft: 'A220-300', season: 'Year-round' },
  { city: 'Dallas-Fort Worth', country: 'USA', code: 'DFW', iso2: 'US', tz: 'America/Chicago', lat: 32.90, lng: -97.04, region: 'USA', type: 'City', duration: '3h 20m', aircraft: 'A220-300', season: 'Year-round' },
  { city: 'Phoenix', country: 'USA', code: 'PHX', iso2: 'US', tz: 'America/Phoenix', lat: 33.43, lng: -112.01, region: 'USA', type: 'Sun', duration: '4h 30m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Seattle', country: 'USA', code: 'SEA', iso2: 'US', tz: 'America/Los_Angeles', lat: 47.45, lng: -122.31, region: 'USA', type: 'City', duration: '5h 05m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'New Orleans', country: 'USA', code: 'MSY', iso2: 'US', tz: 'America/Chicago', lat: 29.99, lng: -90.26, region: 'USA', type: 'City', duration: '3h 10m', aircraft: 'A220-300', season: 'Year-round' },
  { city: 'Portland', country: 'USA', code: 'PDX', iso2: 'US', tz: 'America/Los_Angeles', lat: 45.59, lng: -122.60, region: 'USA', type: 'City', duration: '2h 30m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Raleigh-Durham', country: 'USA', code: 'RDU', iso2: 'US', tz: 'America/New_York', lat: 35.88, lng: -78.79, region: 'USA', type: 'City', duration: '2h 10m', aircraft: 'A220-300', season: 'Year-round' },
  { city: 'Charleston', country: 'USA', code: 'CHS', iso2: 'US', tz: 'America/New_York', lat: 32.90, lng: -80.04, region: 'USA', type: 'City', duration: '2h 30m', aircraft: 'CRJ-900', season: 'Year-round' },
  { city: 'Charlotte', country: 'USA', code: 'CLT', iso2: 'US', tz: 'America/New_York', lat: 35.21, lng: -80.94, region: 'USA', type: 'City', duration: '2h 05m', aircraft: 'CRJ-900', season: 'Year-round' },
  { city: 'San Antonio', country: 'USA', code: 'SAT', iso2: 'US', tz: 'America/Chicago', lat: 29.53, lng: -98.47, region: 'USA', type: 'City', duration: '3h 45m', aircraft: 'A220-300', season: 'Year-round' },
  { city: 'Anchorage', country: 'USA', code: 'ANC', iso2: 'US', tz: 'America/Anchorage', lat: 61.17, lng: -150.00, region: 'USA', type: 'Adventure', duration: '5h', aircraft: '737 MAX 8', season: 'Jun – Sep' },
  { city: 'Minneapolis', country: 'USA', code: 'MSP', iso2: 'US', tz: 'America/Chicago', lat: 44.88, lng: -93.22, region: 'USA', type: 'City', duration: '2h 30m', aircraft: 'A220-300', season: 'Year-round' },
  { city: 'Detroit', country: 'USA', code: 'DTW', iso2: 'US', tz: 'America/Detroit', lat: 42.21, lng: -83.35, region: 'USA', type: 'City', duration: '1h 10m', aircraft: 'CRJ-900', season: 'Year-round' },
  { city: 'Pittsburgh', country: 'USA', code: 'PIT', iso2: 'US', tz: 'America/New_York', lat: 40.49, lng: -80.23, region: 'USA', type: 'City', duration: '1h 20m', aircraft: 'CRJ-900', season: 'Year-round' },
  { city: 'Cleveland', country: 'USA', code: 'CLE', iso2: 'US', tz: 'America/New_York', lat: 41.41, lng: -81.85, region: 'USA', type: 'City', duration: '1h 15m', aircraft: 'CRJ-900', season: 'Year-round' },
  { city: 'Columbus', country: 'USA', code: 'CMH', iso2: 'US', tz: 'America/New_York', lat: 39.99, lng: -82.89, region: 'USA', type: 'City', duration: '1h 30m', aircraft: 'CRJ-900', season: 'Year-round' },
  { city: 'Cincinnati', country: 'USA', code: 'CVG', iso2: 'US', tz: 'America/New_York', lat: 39.05, lng: -84.66, region: 'USA', type: 'City', duration: '1h 45m', aircraft: 'CRJ-900', season: 'Year-round' },
  { city: 'St. Louis', country: 'USA', code: 'STL', iso2: 'US', tz: 'America/Chicago', lat: 38.75, lng: -90.37, region: 'USA', type: 'City', duration: '2h 20m', aircraft: 'CRJ-900', season: 'Year-round' },
  { city: 'Indianapolis', country: 'USA', code: 'IND', iso2: 'US', tz: 'America/Indiana/Indianapolis', lat: 39.72, lng: -86.29, region: 'USA', type: 'City', duration: '1h 40m', aircraft: 'CRJ-900', season: 'Year-round' },
  { city: 'Salt Lake City', country: 'USA', code: 'SLC', iso2: 'US', tz: 'America/Denver', lat: 40.79, lng: -111.98, region: 'USA', type: 'City', duration: '4h 10m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Washington Reagan', country: 'USA', code: 'DCA', iso2: 'US', tz: 'America/New_York', lat: 38.85, lng: -77.04, region: 'USA', type: 'City', duration: '1h 50m', aircraft: 'CRJ-900', season: 'Year-round' },
  { city: 'New York LaGuardia', country: 'USA', code: 'LGA', iso2: 'US', tz: 'America/New_York', lat: 40.78, lng: -73.87, region: 'USA', type: 'City', duration: '1h 30m', aircraft: 'A220', season: 'Year-round' },

  // ─── EUROPE ───
  { city: 'Brussels', country: 'Belgium', code: 'BRU', iso2: 'BE', tz: 'Europe/Brussels', lat: 50.90, lng: 4.48, region: 'Europe', type: 'City', duration: '7h 20m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'London', country: 'United Kingdom', code: 'LHR', iso2: 'GB', tz: 'Europe/London', lat: 51.47, lng: -0.46, region: 'Europe', type: 'City', duration: '9h', aircraft: 'A330-300', season: 'Year-round' },
  { city: 'Paris', country: 'France', code: 'CDG', iso2: 'FR', tz: 'Europe/Paris', lat: 49.01, lng: 2.55, region: 'Europe', type: 'City', duration: '7h 30m', aircraft: '787 Dreamliner', season: 'Year-round' },
  { city: 'Rome', country: 'Italy', code: 'FCO', iso2: 'IT', tz: 'Europe/Rome', lat: 41.80, lng: 12.25, region: 'Europe', type: 'City', duration: '13h 10m', aircraft: '777-300ER', season: 'Year-round' },
  { city: 'Barcelona', country: 'Spain', code: 'BCN', iso2: 'ES', tz: 'Europe/Madrid', lat: 41.30, lng: 2.08, region: 'Europe', type: 'City', duration: '12h 35m', aircraft: 'A330-300', season: 'Year-round' },
  { city: 'Lisbon', country: 'Portugal', code: 'LIS', iso2: 'PT', tz: 'Europe/Lisbon', lat: 38.77, lng: -9.13, region: 'Europe', type: 'City', duration: '10h 45m', aircraft: 'A330-300', season: 'Year-round' },
  { city: 'Dublin', country: 'Ireland', code: 'DUB', iso2: 'IE', tz: 'Europe/Dublin', lat: 53.43, lng: -6.27, region: 'Europe', type: 'City', duration: '11h 10m', aircraft: '787-9', season: 'Year-round' },
  { city: 'Amsterdam', country: 'Netherlands', code: 'AMS', iso2: 'NL', tz: 'Europe/Amsterdam', lat: 52.31, lng: 4.77, region: 'Europe', type: 'City', duration: '12h 45m', aircraft: '787-8', season: 'Year-round' },
  { city: 'Athens', country: 'Greece', code: 'ATH', iso2: 'GR', tz: 'Europe/Athens', lat: 37.94, lng: 23.94, region: 'Europe', type: 'City', duration: '15h 10m', aircraft: '787-9', season: 'Mar – Nov' },
  { city: 'Frankfurt', country: 'Germany', code: 'FRA', iso2: 'DE', tz: 'Europe/Berlin', lat: 50.03, lng: 8.57, region: 'Europe', type: 'City', duration: '12h 30m', aircraft: '787-8', season: 'Year-round' },
  { city: 'Zurich', country: 'Switzerland', code: 'ZRH', iso2: 'CH', tz: 'Europe/Zurich', lat: 47.46, lng: 8.56, region: 'Europe', type: 'City', duration: '13h', aircraft: '777-200LR', season: 'Year-round' },
  { city: 'Madrid', country: 'Spain', code: 'MAD', iso2: 'ES', tz: 'Europe/Madrid', lat: 40.47, lng: -3.57, region: 'Europe', type: 'City', duration: '12h 15m', aircraft: 'A330-300', season: 'Year-round' },
  { city: 'Milan', country: 'Italy', code: 'MXP', iso2: 'IT', tz: 'Europe/Rome', lat: 45.63, lng: 8.72, region: 'Europe', type: 'City', duration: '12h 55m', aircraft: 'A330-300', season: 'Year-round' },
  { city: 'Copenhagen', country: 'Denmark', code: 'CPH', iso2: 'DK', tz: 'Europe/Copenhagen', lat: 55.62, lng: 12.66, region: 'Europe', type: 'City', duration: '13h', aircraft: '787-8', season: 'Year-round' },
  { city: 'Nice', country: 'France', code: 'NCE', iso2: 'FR', tz: 'Europe/Paris', lat: 43.66, lng: 7.22, region: 'Europe', type: 'Sun', duration: '8h 10m', aircraft: '737 MAX', season: 'Jun – Sep' },
  { city: 'Porto', country: 'Portugal', code: 'OPO', iso2: 'PT', tz: 'Europe/Lisbon', lat: 41.24, lng: -8.68, region: 'Europe', type: 'City', duration: '11h 15m', aircraft: 'A321neo', season: 'Jun – Oct' },
  { city: 'Lyon', country: 'France', code: 'LYS', iso2: 'FR', tz: 'Europe/Paris', lat: 45.73, lng: 5.08, region: 'Europe', type: 'City', duration: '8h 15m', aircraft: '737 MAX', season: 'Jun – Oct' },
  { city: 'Toulouse', country: 'France', code: 'TLS', iso2: 'FR', tz: 'Europe/Paris', lat: 43.63, lng: 1.37, region: 'Europe', type: 'City', duration: '8h 10m', aircraft: '737 MAX', season: 'Jun – Oct' },
  // New 2026
  { city: 'Budapest', country: 'Hungary', code: 'BUD', iso2: 'HU', tz: 'Europe/Budapest', lat: 47.44, lng: 19.26, region: 'Europe', type: 'City', duration: '14h 40m', aircraft: '787-9', season: 'Jun – Oct', isNew: true },
  { city: 'Catania', country: 'Italy', code: 'CTA', iso2: 'IT', tz: 'Europe/Rome', lat: 37.47, lng: 15.07, region: 'Europe', type: 'City', duration: '14h 40m', aircraft: '787-8', season: 'Jun – Oct', isNew: true },
  { city: 'Azores', country: 'Portugal', code: 'PDL', iso2: 'PT', tz: 'Atlantic/Azores', lat: 37.74, lng: -25.70, region: 'Europe', type: 'Adventure', duration: '9h 45m', aircraft: '737 MAX 8', season: 'Jun – Sep', isNew: true },
  { city: 'Palma de Mallorca', country: 'Spain', code: 'PMI', iso2: 'ES', tz: 'Europe/Madrid', lat: 39.55, lng: 2.74, region: 'Europe', type: 'Sun', duration: '13h 25m', aircraft: '787-8', season: 'Jun – Oct', isNew: true },
  { city: 'Berlin', country: 'Germany', code: 'BER', iso2: 'DE', tz: 'Europe/Berlin', lat: 52.37, lng: 13.52, region: 'Europe', type: 'City', duration: '13h 45m', aircraft: 'A321neo', season: 'Jul – Oct', isNew: true },
  { city: 'Nantes', country: 'France', code: 'NTE', iso2: 'FR', tz: 'Europe/Paris', lat: 47.16, lng: -1.61, region: 'Europe', type: 'City', duration: '7h 30m', aircraft: '737 MAX', season: 'Jun – Oct', isNew: true },
  { city: 'Stockholm', country: 'Sweden', code: 'ARN', iso2: 'SE', tz: 'Europe/Stockholm', lat: 59.65, lng: 17.93, region: 'Europe', type: 'City', duration: '8h 30m', aircraft: 'A330-300', season: 'Jun – Sep' },
  { city: 'Edinburgh', country: 'Scotland', code: 'EDI', iso2: 'GB', tz: 'Europe/London', lat: 55.95, lng: -3.37, region: 'Europe', type: 'City', duration: '7h 30m', aircraft: '787-9', season: 'Mar – Oct' },
  { city: 'Geneva', country: 'Switzerland', code: 'GVA', iso2: 'CH', tz: 'Europe/Zurich', lat: 46.23, lng: 6.11, region: 'Europe', type: 'City', duration: '8h 20m', aircraft: 'A330-300', season: 'Year-round' },
  { city: 'Reykjavík', country: 'Iceland', code: 'KEF', iso2: 'IS', tz: 'Atlantic/Reykjavik', lat: 63.98, lng: -22.61, region: 'Europe', type: 'Adventure', duration: '6h 15m', aircraft: '737 MAX 8', season: 'Jun – Sep' },
  { city: 'Manchester', country: 'United Kingdom', code: 'MAN', iso2: 'GB', tz: 'Europe/London', lat: 53.35, lng: -2.27, region: 'Europe', type: 'City', duration: '7h 30m', aircraft: '787-9', season: 'Jun – Oct' },
  { city: 'Munich', country: 'Germany', code: 'MUC', iso2: 'DE', tz: 'Europe/Berlin', lat: 48.35, lng: 11.79, region: 'Europe', type: 'City', duration: '8h 30m', aircraft: '777-300ER', season: 'Year-round' },
  { city: 'Naples', country: 'Italy', code: 'NAP', iso2: 'IT', tz: 'Europe/Rome', lat: 40.88, lng: 14.29, region: 'Europe', type: 'City', duration: '9h 30m', aircraft: '787-8', season: 'May – Oct' },
  { city: 'Prague', country: 'Czech Republic', code: 'PRG', iso2: 'CZ', tz: 'Europe/Prague', lat: 50.10, lng: 14.26, region: 'Europe', type: 'City', duration: '9h', aircraft: 'A330-300', season: 'Jun – Oct' },
  { city: 'Venice', country: 'Italy', code: 'VCE', iso2: 'IT', tz: 'Europe/Rome', lat: 45.50, lng: 12.35, region: 'Europe', type: 'City', duration: '9h 20m', aircraft: 'A330-300', season: 'May – Oct' },
  { city: 'Vienna', country: 'Austria', code: 'VIE', iso2: 'AT', tz: 'Europe/Vienna', lat: 48.11, lng: 16.57, region: 'Europe', type: 'City', duration: '8h 45m', aircraft: '787-9', season: 'Year-round' },
  { city: 'Tenerife', country: 'Spain', code: 'TFS', iso2: 'ES', tz: 'Atlantic/Canary', lat: 28.04, lng: -16.57, region: 'Europe', type: 'Sun', duration: '8h 30m', aircraft: '737 MAX 8', season: 'Nov – Apr', isNew: true },
  { city: 'Basel', country: 'Switzerland', code: 'BSL', iso2: 'CH', tz: 'Europe/Zurich', lat: 47.59, lng: 7.53, region: 'Europe', type: 'City', duration: '7h 40m', aircraft: 'A321neo', season: 'Jun – Sep', isNew: true },
  { city: 'Dubrovnik', country: 'Croatia', code: 'DBV', iso2: 'HR', tz: 'Europe/Zagreb', lat: 42.56, lng: 18.27, region: 'Europe', type: 'Sun', duration: '8h 15m', aircraft: '787-8', season: 'May – Sep', isNew: true },
  { city: 'Oslo', country: 'Norway', code: 'OSL', iso2: 'NO', tz: 'Europe/Oslo', lat: 60.19, lng: 11.10, region: 'Europe', type: 'City', duration: '7h 45m', aircraft: 'A321neo', season: 'Jun – Sep', isNew: true },
  { city: 'Shannon', country: 'Ireland', code: 'SNN', iso2: 'IE', tz: 'Europe/Dublin', lat: 52.70, lng: -8.92, region: 'Europe', type: 'Adventure', duration: '6h 35m', aircraft: 'A321neo', season: 'Jun – Sep', isNew: true },

  // ─── ASIA & PACIFIC ───
  { city: 'Tokyo', country: 'Japan', code: 'HND', iso2: 'JP', tz: 'Asia/Tokyo', lat: 35.55, lng: 139.78, region: 'Asia & Pacific', type: 'City', duration: '13h 35m', aircraft: '777-300ER', season: 'Year-round' },
  { city: 'Hong Kong', country: 'Hong Kong', code: 'HKG', iso2: 'HK', tz: 'Asia/Hong_Kong', lat: 22.31, lng: 113.91, region: 'Asia & Pacific', type: 'City', duration: '5h 15m', aircraft: '787-9', season: 'Year-round' },
  { city: 'Seoul', country: 'South Korea', code: 'ICN', iso2: 'KR', tz: 'Asia/Seoul', lat: 37.46, lng: 126.44, region: 'Asia & Pacific', type: 'City', duration: '14h 10m', aircraft: '787-9', season: 'Year-round' },
  { city: 'Singapore', country: 'Singapore', code: 'SIN', iso2: 'SG', tz: 'Asia/Singapore', lat: 1.36, lng: 103.99, region: 'Asia & Pacific', type: 'City', duration: '7h 30m', aircraft: '787-9', season: 'Year-round' },
  { city: 'Sydney', country: 'Australia', code: 'SYD', iso2: 'AU', tz: 'Australia/Sydney', lat: -33.95, lng: 151.18, region: 'Asia & Pacific', type: 'City', duration: '20h', aircraft: '787 Dreamliner', season: 'Year-round' },
  { city: 'Bangkok', country: 'Thailand', code: 'BKK', iso2: 'TH', tz: 'Asia/Bangkok', lat: 13.69, lng: 100.75, region: 'Asia & Pacific', type: 'City', duration: '6h 05m', aircraft: '787-9', season: 'Year-round' },
  { city: 'Delhi', country: 'India', code: 'DEL', iso2: 'IN', tz: 'Asia/Kolkata', lat: 28.57, lng: 77.10, region: 'Asia & Pacific', type: 'City', duration: '23h 30m', aircraft: '777-200LR', season: 'Year-round' },
  { city: 'Osaka', country: 'Japan', code: 'KIX', iso2: 'JP', tz: 'Asia/Tokyo', lat: 34.43, lng: 135.24, region: 'Asia & Pacific', type: 'City', duration: '13h 35m', aircraft: '787-9', season: 'Mar – Nov' },
  { city: 'Shanghai', country: 'China', code: 'PVG', iso2: 'CN', tz: 'Asia/Shanghai', lat: 31.14, lng: 121.81, region: 'Asia & Pacific', type: 'City', duration: '14h 45m', aircraft: '787-9', season: 'Year-round' },
  { city: 'Auckland', country: 'New Zealand', code: 'AKL', iso2: 'NZ', tz: 'Pacific/Auckland', lat: -37.01, lng: 174.79, region: 'Asia & Pacific', type: 'City', duration: '18h', aircraft: '787 Dreamliner', season: 'Year-round' },
  { city: 'Sapporo', country: 'Japan', code: 'CTS', iso2: 'JP', tz: 'Asia/Tokyo', lat: 42.77, lng: 141.69, region: 'Asia & Pacific', type: 'City', duration: '10h', aircraft: '787-8', season: 'Dec – Mar' },
  { city: 'Manila', country: 'Philippines', code: 'MNL', iso2: 'PH', tz: 'Asia/Manila', lat: 14.51, lng: 121.02, region: 'Asia & Pacific', type: 'City', duration: '13h 30m', aircraft: '787-9', season: 'Year-round' },
  { city: 'Tokyo Narita', country: 'Japan', code: 'NRT', iso2: 'JP', tz: 'Asia/Tokyo', lat: 35.77, lng: 140.39, region: 'Asia & Pacific', type: 'City', duration: '13h 35m', aircraft: '777-300ER', season: 'Year-round' },
  { city: 'Beijing', country: 'China', code: 'PEK', iso2: 'CN', tz: 'Asia/Shanghai', lat: 40.08, lng: 116.60, region: 'Asia & Pacific', type: 'City', duration: '11h', aircraft: '787-9', season: 'Year-round' },
  { city: 'Brisbane', country: 'Australia', code: 'BNE', iso2: 'AU', tz: 'Australia/Brisbane', lat: -27.38, lng: 153.12, region: 'Asia & Pacific', type: 'City', duration: '16h', aircraft: '787-9', season: 'Year-round' },
  { city: 'Guangzhou', country: 'China', code: 'CAN', iso2: 'CN', tz: 'Asia/Shanghai', lat: 23.39, lng: 113.30, region: 'Asia & Pacific', type: 'City', duration: '13h 25m', aircraft: '787-9', season: 'May – Sep', isNew: true },

  // ─── SOUTH AMERICA ───
  { city: 'Bogotá', country: 'Colombia', code: 'BOG', iso2: 'CO', tz: 'America/Bogota', lat: 4.70, lng: -74.15, region: 'South America', type: 'City', duration: '5h 30m', aircraft: '787-8', season: 'Year-round' },
  { city: 'Cartagena', country: 'Colombia', code: 'CTG', iso2: 'CO', tz: 'America/Bogota', lat: 10.44, lng: -75.51, region: 'South America', type: 'Sun', duration: '4h 55m', aircraft: '737 MAX 8', season: 'Jan – Dec', isNew: true },
  { city: 'São Paulo', country: 'Brazil', code: 'GRU', iso2: 'BR', tz: 'America/Sao_Paulo', lat: -23.43, lng: -46.47, region: 'South America', type: 'City', duration: '11h 05m', aircraft: '787-9', season: 'Year-round' },
  { city: 'Lima', country: 'Peru', code: 'LIM', iso2: 'PE', tz: 'America/Lima', lat: -12.02, lng: -77.11, region: 'South America', type: 'City', duration: '7h 15m', aircraft: '787-8', season: 'Jan – Dec' },
  { city: 'Santiago', country: 'Chile', code: 'SCL', iso2: 'CL', tz: 'America/Santiago', lat: -33.39, lng: -70.79, region: 'South America', type: 'City', duration: '12h', aircraft: '787-9', season: 'Jan – Dec' },
  { city: 'Rio de Janeiro', country: 'Brazil', code: 'GIG', iso2: 'BR', tz: 'America/Sao_Paulo', lat: -22.80, lng: -43.24, region: 'South America', type: 'City', duration: '10h 30m', aircraft: '787-9', season: 'Nov – Mar' },
  { city: 'Quito', country: 'Ecuador', code: 'UIO', iso2: 'EC', tz: 'America/Guayaquil', lat: -0.13, lng: -78.49, region: 'South America', type: 'City', duration: '7h 15m', aircraft: '787-8', season: 'Dec – Mar' },
  // ─── CENTRAL AMERICA ───
  { city: 'Belize City', country: 'Belize', code: 'BZE', iso2: 'BZ', tz: 'America/Belize', lat: 17.54, lng: -88.31, region: 'Central America', type: 'Adventure', duration: '4h 30m', aircraft: 'A319', season: 'Mar – Apr' },
  { city: 'Guatemala City', country: 'Guatemala', code: 'GUA', iso2: 'GT', tz: 'America/Guatemala', lat: 14.58, lng: -90.52, region: 'Central America', type: 'City', duration: '5h 30m', aircraft: 'A330-300', season: 'Mar – Apr' },
  { city: 'San José', country: 'Costa Rica', code: 'SJO', iso2: 'CR', tz: 'America/Costa_Rica', lat: 9.99, lng: -84.21, region: 'Central America', type: 'City', duration: '5h 30m', aircraft: 'A330-300', season: 'Year-round' },
  { city: 'Liberia', country: 'Costa Rica', code: 'LIR', iso2: 'CR', tz: 'America/Costa_Rica', lat: 10.59, lng: -85.54, region: 'Central America', type: 'Sun', duration: '5h 40m', aircraft: '737 MAX 8', season: 'Year-round' },
  { city: 'Roatán', country: 'Honduras', code: 'RTB', iso2: 'HN', tz: 'America/Tegucigalpa', lat: 16.32, lng: -86.52, region: 'Central America', type: 'Sun', duration: '5h', aircraft: '737 MAX 8', season: 'Nov – Apr', isNew: true },

  // ─── AFRICA & MIDDLE EAST ───
  { city: 'Casablanca', country: 'Morocco', code: 'CMN', iso2: 'MA', tz: 'Africa/Casablanca', lat: 33.37, lng: -7.59, region: 'Africa & Middle East', type: 'City', duration: '12h', aircraft: 'A330-300', season: 'Year-round' },
  { city: 'Dubai', country: 'UAE', code: 'DXB', iso2: 'AE', tz: 'Asia/Dubai', lat: 25.25, lng: 55.36, region: 'Africa & Middle East', type: 'City', duration: '21h', aircraft: '787-9', season: 'Year-round' },
  { city: 'Tel Aviv', country: 'Israel', code: 'TLV', iso2: 'IL', tz: 'Asia/Jerusalem', lat: 32.01, lng: 34.89, region: 'Africa & Middle East', type: 'City', duration: '17h 10m', aircraft: '787-9', season: 'Year-round' },
];
