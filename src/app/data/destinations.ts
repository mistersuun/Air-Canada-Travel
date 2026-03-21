export interface Destination {
  city: string;
  country: string;
  code: string;
  lat: number;
  lng: number;
  region: string;
  type: 'Sun' | 'City' | 'Adventure' | 'Hub';
  duration: string;
  aircraft: string;
  fromCities: string[];
  season: string;
  isNew?: boolean;
}

export interface Hub {
  name: string;
  lat: number;
  lng: number;
  code: string;
}

export const HUBS: Hub[] = [
  { name: 'Toronto', lat: 43.68, lng: -79.62, code: 'YYZ' },
  { name: 'Montreal', lat: 45.47, lng: -73.74, code: 'YUL' },
  { name: 'Vancouver', lat: 49.20, lng: -123.18, code: 'YVR' },
  { name: 'Calgary', lat: 51.13, lng: -114.01, code: 'YYC' },
  { name: 'Ottawa', lat: 45.32, lng: -75.67, code: 'YOW' },
  { name: 'Halifax', lat: 44.88, lng: -63.51, code: 'YHZ' },
  { name: 'Edmonton', lat: 53.31, lng: -113.58, code: 'YEG' },
  { name: 'Quebec City', lat: 46.79, lng: -71.39, code: 'YQB' },
];

export const REGIONS = [
  'All', 'Caribbean', 'Mexico', 'USA', 'Europe',
  'Asia & Pacific', 'South America', 'Africa & Middle East'
];

export const TYPES = ['All', 'Sun', 'City', 'Adventure'];

export const REGION_COLORS: Record<string, string> = {
  'Caribbean': '#0EA5E9',
  'Mexico': '#E89020',
  'USA': '#6366F1',
  'Europe': '#8B5CF6',
  'Asia & Pacific': '#10B981',
  'South America': '#F97316',
  'Africa & Middle East': '#E05090',
};

export const DESTINATIONS: Destination[] = [
  // ─── CARIBBEAN ───
  { city: 'Punta Cana', country: 'Dominican Republic', code: 'PUJ', lat: 18.57, lng: -68.37, region: 'Caribbean', type: 'Sun', duration: '4h 45m', aircraft: '737 MAX', fromCities: ['Toronto','Montreal'], season: 'Oct – Apr' },
  { city: 'Montego Bay', country: 'Jamaica', code: 'MBJ', lat: 18.50, lng: -77.91, region: 'Caribbean', type: 'Sun', duration: '4h 15m', aircraft: 'A321', fromCities: ['Toronto','Montreal'], season: 'Year-round' },
  { city: 'Nassau', country: 'Bahamas', code: 'NAS', lat: 25.04, lng: -77.47, region: 'Caribbean', type: 'Sun', duration: '3h 10m', aircraft: '737 MAX 8', fromCities: ['Halifax','Montreal','Ottawa','Toronto'], season: 'Year-round' },
  { city: 'Bridgetown', country: 'Barbados', code: 'BGI', lat: 13.07, lng: -59.49, region: 'Caribbean', type: 'Sun', duration: '5h 25m', aircraft: '737 MAX 8', fromCities: ['Montreal','Toronto'], season: 'Year-round' },
  { city: 'Providenciales', country: 'Turks & Caicos', code: 'PLS', lat: 21.77, lng: -72.27, region: 'Caribbean', type: 'Sun', duration: '4h 25m', aircraft: '737 MAX 8', fromCities: ['Montreal','Toronto'], season: 'Year-round' },
  { city: 'Fort-de-France', country: 'Martinique', code: 'FDF', lat: 14.59, lng: -61.00, region: 'Caribbean', type: 'Sun', duration: '5h 10m', aircraft: '737 MAX 8', fromCities: ['Montreal','Quebec City','Toronto'], season: 'Year-round', isNew: true },
  { city: 'Oranjestad', country: 'Aruba', code: 'AUA', lat: 12.50, lng: -70.01, region: 'Caribbean', type: 'Sun', duration: '5h 05m', aircraft: 'A319', fromCities: ['Toronto'], season: 'Year-round' },
  { city: 'Pointe-à-Pitre', country: 'Guadeloupe', code: 'PTP', lat: 16.27, lng: -61.53, region: 'Caribbean', type: 'Sun', duration: '4h 55m', aircraft: '737 MAX 8', fromCities: ['Montreal','Toronto'], season: 'Year-round' },
  { city: 'Hamilton', country: 'Bermuda', code: 'BDA', lat: 32.36, lng: -64.68, region: 'Caribbean', type: 'Sun', duration: '3h 50m', aircraft: 'A319', fromCities: ['Toronto'], season: 'Year-round' },
  { city: 'Port of Spain', country: 'Trinidad & Tobago', code: 'POS', lat: 10.60, lng: -61.34, region: 'Caribbean', type: 'Sun', duration: '5h 45m', aircraft: '737 MAX 8', fromCities: ['Toronto'], season: 'Year-round' },

  // ─── MEXICO ───
  { city: 'Cancún', country: 'Mexico', code: 'CUN', lat: 21.04, lng: -86.87, region: 'Mexico', type: 'Sun', duration: '7h', aircraft: '737 MAX 8', fromCities: ['Calgary','Edmonton','Halifax','Montreal','Ottawa','Quebec City','Toronto','Vancouver','Winnipeg'], season: 'Year-round' },
  { city: 'Puerto Vallarta', country: 'Mexico', code: 'PVR', lat: 20.68, lng: -105.25, region: 'Mexico', type: 'Sun', duration: '5h 15m', aircraft: '737', fromCities: ['Toronto','Vancouver','Calgary'], season: 'Oct – Apr' },
  { city: 'Los Cabos', country: 'Mexico', code: 'SJD', lat: 23.15, lng: -109.72, region: 'Mexico', type: 'Sun', duration: '5h 45m', aircraft: '737 MAX', fromCities: ['Toronto','Vancouver','Calgary'], season: 'Oct – Apr' },
  { city: 'Tulum', country: 'Mexico', code: 'TQO', lat: 20.23, lng: -87.43, region: 'Mexico', type: 'Sun', duration: '4h', aircraft: '737 MAX 8', fromCities: ['Montreal','Toronto'], season: 'Jan – Dec' },
  { city: 'Huatulco', country: 'Mexico', code: 'HUX', lat: 15.78, lng: -96.26, region: 'Mexico', type: 'Sun', duration: '5h 30m', aircraft: '737', fromCities: ['Toronto','Vancouver'], season: 'Nov – Apr' },
  { city: 'Mexico City', country: 'Mexico', code: 'MEX', lat: 19.44, lng: -99.07, region: 'Mexico', type: 'City', duration: '3h 59m', aircraft: '737 MAX 8', fromCities: ['Montreal','Toronto','Vancouver'], season: 'Year-round' },
  { city: 'Ixtapa', country: 'Mexico', code: 'ZIH', lat: 17.60, lng: -101.46, region: 'Mexico', type: 'Sun', duration: '5h 30m', aircraft: '737', fromCities: ['Toronto','Calgary'], season: 'Nov – Apr' },
  { city: 'Guadalajara', country: 'Mexico', code: 'GDL', lat: 20.52, lng: -103.31, region: 'Mexico', type: 'City', duration: '5h 15m', aircraft: '737', fromCities: ['Toronto'], season: 'Nov – Apr' },

  // ─── USA ───
  { city: 'New York', country: 'USA', code: 'JFK', lat: 40.64, lng: -73.78, region: 'USA', type: 'City', duration: '1h 30m', aircraft: 'A220', fromCities: ['Toronto','Montreal','Vancouver'], season: 'Year-round' },
  { city: 'Los Angeles', country: 'USA', code: 'LAX', lat: 33.94, lng: -118.41, region: 'USA', type: 'City', duration: '3h 15m', aircraft: '737 MAX 8', fromCities: ['Montreal','Toronto','Vancouver'], season: 'Year-round' },
  { city: 'Miami', country: 'USA', code: 'MIA', lat: 25.80, lng: -80.29, region: 'USA', type: 'Sun', duration: '3h 59m', aircraft: 'A220-300', fromCities: ['Montreal','Toronto','Vancouver'], season: 'Year-round' },
  { city: 'Nashville', country: 'USA', code: 'BNA', lat: 36.13, lng: -86.67, region: 'USA', type: 'City', duration: '2h 20m', aircraft: 'A220', fromCities: ['Toronto','Montreal','Vancouver'], season: 'Year-round' },
  { city: 'Honolulu', country: 'USA', code: 'HNL', lat: 21.32, lng: -157.92, region: 'USA', type: 'Sun', duration: '3h 30m', aircraft: '737 MAX 8', fromCities: ['Toronto','Vancouver'], season: 'Year-round' },
  { city: 'San Francisco', country: 'USA', code: 'SFO', lat: 37.62, lng: -122.38, region: 'USA', type: 'City', duration: '2h 08m', aircraft: '737 MAX 8', fromCities: ['Edmonton','Montreal','Toronto','Vancouver'], season: 'Year-round' },
  { city: 'Orlando', country: 'USA', code: 'MCO', lat: 28.43, lng: -81.31, region: 'USA', type: 'Sun', duration: '3h 17m', aircraft: 'A321', fromCities: ['Halifax','Montreal','Ottawa','Quebec City','Toronto'], season: 'Year-round' },
  { city: 'Las Vegas', country: 'USA', code: 'LAS', lat: 36.08, lng: -115.15, region: 'USA', type: 'City', duration: '2h 44m', aircraft: 'A320', fromCities: ['Montreal','Toronto','Vancouver'], season: 'Year-round' },
  { city: 'Tampa', country: 'USA', code: 'TPA', lat: 27.98, lng: -82.53, region: 'USA', type: 'Sun', duration: '3h 17m', aircraft: 'A319', fromCities: ['Halifax','Montreal','Toronto'], season: 'Year-round' },
  { city: 'Fort Lauderdale', country: 'USA', code: 'FLL', lat: 26.07, lng: -80.15, region: 'USA', type: 'Sun', duration: '3h 53m', aircraft: 'A321', fromCities: ['Montreal','Ottawa','Quebec City','Toronto'], season: 'Year-round' },

  // ─── EUROPE ───
  { city: 'London', country: 'United Kingdom', code: 'LHR', lat: 51.47, lng: -0.46, region: 'Europe', type: 'City', duration: '9h', aircraft: 'A330-300', fromCities: ['Calgary','Halifax','Montreal','Ottawa','Toronto','Vancouver'], season: 'Year-round' },
  { city: 'Paris', country: 'France', code: 'CDG', lat: 49.01, lng: 2.55, region: 'Europe', type: 'City', duration: '7h 30m', aircraft: '787 Dreamliner', fromCities: ['Toronto','Montreal','Vancouver'], season: 'Year-round' },
  { city: 'Rome', country: 'Italy', code: 'FCO', lat: 41.80, lng: 12.25, region: 'Europe', type: 'City', duration: '13h 10m', aircraft: '777-300ER', fromCities: ['Montreal','Toronto'], season: 'Year-round' },
  { city: 'Barcelona', country: 'Spain', code: 'BCN', lat: 41.30, lng: 2.08, region: 'Europe', type: 'City', duration: '12h 35m', aircraft: 'A330-300', fromCities: ['Montreal','Toronto'], season: 'Year-round' },
  { city: 'Lisbon', country: 'Portugal', code: 'LIS', lat: 38.77, lng: -9.13, region: 'Europe', type: 'City', duration: '10h 45m', aircraft: 'A330-300', fromCities: ['Montreal','Toronto'], season: 'Year-round' },
  { city: 'Dublin', country: 'Ireland', code: 'DUB', lat: 53.43, lng: -6.27, region: 'Europe', type: 'City', duration: '11h 10m', aircraft: '787-9', fromCities: ['Montreal','Toronto','Vancouver'], season: 'Year-round' },
  { city: 'Amsterdam', country: 'Netherlands', code: 'AMS', lat: 52.31, lng: 4.77, region: 'Europe', type: 'City', duration: '12h 45m', aircraft: '787-8', fromCities: ['Montreal','Toronto'], season: 'Year-round' },
  { city: 'Athens', country: 'Greece', code: 'ATH', lat: 37.94, lng: 23.94, region: 'Europe', type: 'City', duration: '15h 10m', aircraft: '787-9', fromCities: ['Montreal','Toronto'], season: 'Mar – Nov' },
  { city: 'Frankfurt', country: 'Germany', code: 'FRA', lat: 50.03, lng: 8.57, region: 'Europe', type: 'City', duration: '12h 30m', aircraft: '787-8', fromCities: ['Montreal','Toronto','Vancouver'], season: 'Year-round' },
  { city: 'Zurich', country: 'Switzerland', code: 'ZRH', lat: 47.46, lng: 8.56, region: 'Europe', type: 'City', duration: '13h', aircraft: '777-200LR', fromCities: ['Toronto'], season: 'Year-round' },
  { city: 'Madrid', country: 'Spain', code: 'MAD', lat: 40.47, lng: -3.57, region: 'Europe', type: 'City', duration: '12h 15m', aircraft: 'A330-300', fromCities: ['Montreal','Toronto'], season: 'Year-round' },
  { city: 'Milan', country: 'Italy', code: 'MXP', lat: 45.63, lng: 8.72, region: 'Europe', type: 'City', duration: '12h 55m', aircraft: 'A330-300', fromCities: ['Montreal'], season: 'Year-round' },
  { city: 'Copenhagen', country: 'Denmark', code: 'CPH', lat: 55.62, lng: 12.66, region: 'Europe', type: 'City', duration: '13h', aircraft: '787-8', fromCities: ['Montreal','Toronto'], season: 'Year-round' },
  { city: 'Nice', country: 'France', code: 'NCE', lat: 43.66, lng: 7.22, region: 'Europe', type: 'Sun', duration: '8h 10m', aircraft: '737 MAX', fromCities: ['Montreal'], season: 'Jun – Sep' },
  { city: 'Porto', country: 'Portugal', code: 'OPO', lat: 41.24, lng: -8.68, region: 'Europe', type: 'City', duration: '11h 15m', aircraft: 'A321neo', fromCities: ['Montreal'], season: 'Jun – Oct' },
  { city: 'Lyon', country: 'France', code: 'LYS', lat: 45.73, lng: 5.08, region: 'Europe', type: 'City', duration: '8h 15m', aircraft: '737 MAX', fromCities: ['Montreal'], season: 'Jun – Oct' },
  { city: 'Toulouse', country: 'France', code: 'TLS', lat: 43.63, lng: 1.37, region: 'Europe', type: 'City', duration: '8h 10m', aircraft: '737 MAX', fromCities: ['Montreal'], season: 'Jun – Oct' },
  // New 2026
  { city: 'Budapest', country: 'Hungary', code: 'BUD', lat: 47.44, lng: 19.26, region: 'Europe', type: 'City', duration: '14h 40m', aircraft: '787-9', fromCities: ['Toronto'], season: 'Jun – Oct', isNew: true },
  { city: 'Catania', country: 'Italy', code: 'CTA', lat: 37.47, lng: 15.07, region: 'Europe', type: 'City', duration: '14h 40m', aircraft: '787-8', fromCities: ['Montreal'], season: 'Jun – Oct', isNew: true },
  { city: 'Azores', country: 'Portugal', code: 'PDL', lat: 37.74, lng: -25.70, region: 'Europe', type: 'Adventure', duration: '9h 45m', aircraft: '737 MAX 8', fromCities: ['Toronto'], season: 'Jun – Sep', isNew: true },
  { city: 'Palma de Mallorca', country: 'Spain', code: 'PMI', lat: 39.55, lng: 2.74, region: 'Europe', type: 'Sun', duration: '13h 25m', aircraft: '787-8', fromCities: ['Montreal'], season: 'Jun – Oct', isNew: true },
  { city: 'Berlin', country: 'Germany', code: 'BER', lat: 52.37, lng: 13.52, region: 'Europe', type: 'City', duration: '13h 45m', aircraft: 'A321neo', fromCities: ['Montreal'], season: 'Jul – Oct', isNew: true },
  { city: 'Nantes', country: 'France', code: 'NTE', lat: 47.16, lng: -1.61, region: 'Europe', type: 'City', duration: '7h 30m', aircraft: '737 MAX', fromCities: ['Montreal'], season: 'Jun – Oct', isNew: true },

  // ─── ASIA & PACIFIC ───
  { city: 'Tokyo', country: 'Japan', code: 'HND', lat: 35.55, lng: 139.78, region: 'Asia & Pacific', type: 'City', duration: '2h 55m', aircraft: '777-300ER', fromCities: ['Toronto'], season: 'Year-round' },
  { city: 'Hong Kong', country: 'Hong Kong', code: 'HKG', lat: 22.31, lng: 113.91, region: 'Asia & Pacific', type: 'City', duration: '5h 15m', aircraft: '787-9', fromCities: ['Vancouver'], season: 'Year-round' },
  { city: 'Seoul', country: 'South Korea', code: 'ICN', lat: 37.46, lng: 126.44, region: 'Asia & Pacific', type: 'City', duration: '3h 30m', aircraft: '787-9', fromCities: ['Montreal','Toronto','Vancouver'], season: 'Year-round' },
  { city: 'Singapore', country: 'Singapore', code: 'SIN', lat: 1.36, lng: 103.99, region: 'Asia & Pacific', type: 'City', duration: '7h 30m', aircraft: '787-9', fromCities: ['Vancouver'], season: 'Year-round' },
  { city: 'Sydney', country: 'Australia', code: 'SYD', lat: -33.95, lng: 151.18, region: 'Asia & Pacific', type: 'City', duration: '20h', aircraft: '787 Dreamliner', fromCities: ['Vancouver'], season: 'Year-round' },
  { city: 'Bangkok', country: 'Thailand', code: 'BKK', lat: 13.69, lng: 100.75, region: 'Asia & Pacific', type: 'City', duration: '6h 05m', aircraft: '787-9', fromCities: ['Vancouver'], season: 'Year-round' },
  { city: 'Delhi', country: 'India', code: 'DEL', lat: 28.57, lng: 77.10, region: 'Asia & Pacific', type: 'City', duration: '23h 30m', aircraft: '777-200LR', fromCities: ['Montreal','Toronto'], season: 'Year-round' },
  { city: 'Osaka', country: 'Japan', code: 'KIX', lat: 34.43, lng: 135.24, region: 'Asia & Pacific', type: 'City', duration: '3h 10m', aircraft: '787-9', fromCities: ['Toronto','Vancouver'], season: 'Mar – Nov' },
  { city: 'Shanghai', country: 'China', code: 'PVG', lat: 31.14, lng: 121.81, region: 'Asia & Pacific', type: 'City', duration: '3h 30m', aircraft: '787-9', fromCities: ['Toronto','Vancouver'], season: 'Year-round' },
  { city: 'Auckland', country: 'New Zealand', code: 'AKL', lat: -37.01, lng: 174.79, region: 'Asia & Pacific', type: 'City', duration: '18h', aircraft: '787 Dreamliner', fromCities: ['Vancouver'], season: 'Year-round' },

  // ─── SOUTH AMERICA ───
  { city: 'Bogotá', country: 'Colombia', code: 'BOG', lat: 4.70, lng: -74.15, region: 'South America', type: 'City', duration: '5h 30m', aircraft: '787-8', fromCities: ['Montreal','Toronto'], season: 'Year-round' },
  { city: 'Cartagena', country: 'Colombia', code: 'CTG', lat: 10.44, lng: -75.51, region: 'South America', type: 'Sun', duration: '4h 55m', aircraft: '737 MAX 8', fromCities: ['Montreal','Toronto'], season: 'Jan – Dec', isNew: true },
  { city: 'São Paulo', country: 'Brazil', code: 'GRU', lat: -23.43, lng: -46.47, region: 'South America', type: 'City', duration: '11h 05m', aircraft: '787-9', fromCities: ['Montreal','Toronto'], season: 'Year-round' },
  { city: 'Lima', country: 'Peru', code: 'LIM', lat: -12.02, lng: -77.11, region: 'South America', type: 'City', duration: '7h 15m', aircraft: '787-8', fromCities: ['Montreal','Toronto'], season: 'Jan – Dec' },
  { city: 'Buenos Aires', country: 'Argentina', code: 'EZE', lat: -34.82, lng: -58.54, region: 'South America', type: 'City', duration: '11h 30m', aircraft: '787 Dreamliner', fromCities: ['Toronto'], season: 'Year-round' },
  { city: 'Santiago', country: 'Chile', code: 'SCL', lat: -33.39, lng: -70.79, region: 'South America', type: 'City', duration: '12h', aircraft: '787-9', fromCities: ['Montreal','Toronto'], season: 'Jan – Dec' },

  // ─── AFRICA & MIDDLE EAST ───
  { city: 'Casablanca', country: 'Morocco', code: 'CMN', lat: 33.37, lng: -7.59, region: 'Africa & Middle East', type: 'City', duration: '12h', aircraft: 'A330-300', fromCities: ['Montreal'], season: 'Year-round' },
  { city: 'Dubai', country: 'UAE', code: 'DXB', lat: 25.25, lng: 55.36, region: 'Africa & Middle East', type: 'City', duration: '21h', aircraft: '787-9', fromCities: ['Toronto'], season: 'Year-round' },
  { city: 'Tel Aviv', country: 'Israel', code: 'TLV', lat: 32.01, lng: 34.89, region: 'Africa & Middle East', type: 'City', duration: '17h 10m', aircraft: '787-9', fromCities: ['Montreal','Toronto'], season: 'Year-round' },
  { city: 'Algiers', country: 'Algeria', code: 'ALG', lat: 36.69, lng: 3.22, region: 'Africa & Middle East', type: 'City', duration: '12h 45m', aircraft: 'A330-300', fromCities: ['Montreal'], season: 'Jun – Sep' },
];
