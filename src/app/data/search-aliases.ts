import type { Destination, DestinationType } from './destinations';

/**
 * Extra words the search box understands, beyond city / country / code / region.
 * Hand-kept (public/data/cities.json has no clean join to airport codes), by
 * destination code: the state, province or island ('Hawaii', 'HI'), airport
 * names ('Heathrow') and a few activity words ('ski').
 */
const A: Record<string, readonly string[]> = {
  // Caribbean & Mexico (states and islands)
  PUJ: ['La Altagracia', 'Hispaniola', 'Bavaro'], LRM: ['Hispaniola'], POP: ['Hispaniola'], AZS: ['Hispaniola'], SDQ: ['Hispaniola'],
  NAS: ['New Providence', 'Paradise Island'], GGT: ['Exuma', 'Out Islands'], PLS: ['Turks and Caicos', 'Provo'],
  FDF: ['French Antilles'], PTP: ['French Antilles', 'Grande-Terre'], SXM: ['Saint Martin', 'St Martin'],
  UVF: ['Saint Lucia', 'Hewanorra'], SKB: ['Saint Kitts', 'Nevis'], SVD: ['Saint Vincent', 'Grenadines'], ANU: ['Barbuda'],
  POS: ['Trinidad', 'Tobago'], CUR: ['Dutch Caribbean', 'Willemstad'], AUA: ['Dutch Caribbean'], GCM: ['Grand Cayman'],
  SJU: ['Isla Verde', 'Luis Munoz Marin'], MBJ: ['Sangster'], BDA: ['LF Wade'],
  CUN: ['Quintana Roo', 'Riviera Maya', 'Yucatan'], TQO: ['Quintana Roo', 'Riviera Maya', 'Yucatan'], CZM: ['Quintana Roo', 'Riviera Maya'],
  MID: ['Yucatan'], PVR: ['Jalisco', 'Riviera Nayarit', 'Nayarit'], GDL: ['Jalisco'], SJD: ['Baja California Sur', 'Baja', 'Cabo'],
  MTY: ['Nuevo Leon'], MEX: ['CDMX', 'Ciudad de Mexico', 'Benito Juarez'], ZIH: ['Guerrero', 'Zihuatanejo'],
  HUX: ['Oaxaca'], PXM: ['Oaxaca'], MZT: ['Sinaloa'],
  // USA (state name, abbreviation, airport)
  LAX: ['California', 'CA'], SFO: ['California', 'CA', 'Bay Area'], SAN: ['California', 'CA'], SMF: ['California', 'CA'],
  SNA: ['California', 'CA', 'John Wayne', 'Irvine'], PSP: ['California', 'CA', 'Coachella'],
  MIA: ['Florida', 'FL'], MCO: ['Florida', 'FL', 'Disney', 'Disney World'], TPA: ['Florida', 'FL'], FLL: ['Florida', 'FL'],
  JAX: ['Florida', 'FL'], DJT: ['Florida', 'FL', 'Palm Beach'], RSW: ['Florida', 'FL', 'Southwest Florida'], SRQ: ['Florida', 'FL', 'Sarasota Bradenton'],
  HNL: ['Hawaii', 'HI', 'Oahu', 'Inouye'], KOA: ['Hawaii', 'HI', 'Big Island', 'Kona'], OGG: ['Hawaii', 'HI', 'Kahului'],
  BNA: ['Tennessee', 'TN'], LAS: ['Nevada', 'NV', 'Harry Reid'], BOS: ['Massachusetts', 'MA', 'Logan'],
  EWR: ['New Jersey', 'NJ', 'New York', 'NYC', 'Liberty'], LGA: ['New York', 'NY', 'NYC'], PHL: ['Pennsylvania', 'PA'], PIT: ['Pennsylvania', 'PA'],
  IAD: ['Virginia', 'VA', 'Dulles', 'DC'], DCA: ['Virginia', 'VA', 'Reagan', 'DC'], ORD: ['Illinois', 'IL', "O'Hare"],
  ATL: ['Georgia', 'GA', 'Hartsfield-Jackson'], DEN: ['Colorado', 'CO', 'Rockies'], IAH: ['Texas', 'TX', 'Bush'],
  AUS: ['Texas', 'TX'], DFW: ['Texas', 'TX', 'Dallas', 'Fort Worth'], SAT: ['Texas', 'TX'], PHX: ['Arizona', 'AZ'],
  SEA: ['Washington State', 'WA', 'Sea-Tac', 'Tacoma'], MSY: ['Louisiana', 'LA', 'Nola'], PDX: ['Oregon', 'OR'],
  RDU: ['North Carolina', 'NC', 'Raleigh', 'Durham'], CLT: ['North Carolina', 'NC'], CHS: ['South Carolina', 'SC'],
  ANC: ['Alaska', 'AK', 'Ted Stevens'], MSP: ['Minnesota', 'MN', 'Twin Cities', 'Minneapolis-Saint Paul'],
  DTW: ['Michigan', 'MI', 'Detroit Metro'], CLE: ['Ohio', 'OH'], CMH: ['Ohio', 'OH'], CVG: ['Kentucky', 'KY', 'Ohio', 'Cincinnati'],
  STL: ['Missouri', 'MO'], IND: ['Indiana', 'IN'], SLC: ['Utah', 'UT'],
  // Europe and beyond (airport names, regions)
  LHR: ['Heathrow', 'England', 'UK', 'Britain', 'Great Britain'], MAN: ['England', 'UK', 'Britain', 'Ringway'], EDI: ['UK', 'Britain', 'Scotland'],
  CDG: ['Charles de Gaulle', 'Roissy', 'Ile-de-France'], NCE: ['Cote d Azur', 'French Riviera', 'Riviera'], LYS: ['Saint-Exupery'],
  FCO: ['Fiumicino', 'Lazio', 'Leonardo da Vinci'], MXP: ['Malpensa', 'Lombardy', 'Lombardia'], VCE: ['Marco Polo', 'Veneto'],
  NAP: ['Campania', 'Capodichino'], CTA: ['Sicily', 'Sicilia', 'Fontanarossa'], BCN: ['Catalonia', 'Catalunya', 'El Prat'],
  MAD: ['Barajas'], PMI: ['Mallorca', 'Majorca', 'Balearic', 'Balearics'], TFS: ['Canary Islands', 'Canarias', 'Canaries', 'Tenerife South'],
  LIS: ['Portela', 'Humberto Delgado'], OPO: ['Francisco Sa Carneiro'], PDL: ['Azores', 'Sao Miguel', 'Ponta Delgada'],
  DUB: ['Eire'], SNN: ['Eire', 'Clare'], AMS: ['Schiphol', 'Holland'], FRA: ['Hesse'], MUC: ['Bavaria', 'Bayern', 'Franz Josef Strauss'],
  BER: ['Brandenburg'], BSL: ['EuroAirport', 'Mulhouse'], GVA: ['Cointrin'], ZRH: ['Kloten'], ARN: ['Arlanda'], CPH: ['Kastrup'],
  KEF: ['Keflavik'], BUD: ['Ferenc Liszt'], DBV: ['Dalmatia', 'Cilipi'], ATH: ['Eleftherios Venizelos', 'Attica'],
  HND: ['Haneda', 'Honshu'], NRT: ['Narita', 'Honshu'], KIX: ['Kansai', 'Honshu', 'Kyoto'], CTS: ['Hokkaido', 'New Chitose'],
  ICN: ['Incheon', 'Korea'], PEK: ['Capital', 'Peking'], PVG: ['Pudong'], CAN: ['Baiyun', 'Guangdong', 'Canton'], HKG: ['Chek Lap Kok'],
  SIN: ['Changi'], BKK: ['Suvarnabhumi'], DEL: ['Indira Gandhi', 'New Delhi'], MNL: ['Ninoy Aquino', 'Luzon'],
  SYD: ['Kingsford Smith', 'New South Wales', 'NSW'], BNE: ['Queensland', 'QLD'], AKL: ['North Island'],
  BOG: ['El Dorado'], CTG: ['Bolivar', 'Rafael Nunez'], GRU: ['Guarulhos', 'Sao Paulo'], GIG: ['Galeao'], LIM: ['Jorge Chavez'],
  SCL: ['Arturo Merino Benitez'], UIO: ['Mariscal Sucre'], BZE: ['Philip Goldson'], GUA: ['La Aurora'], SJO: ['Juan Santamaria'],
  LIR: ['Guanacaste', 'Daniel Oduber'], RTB: ['Bay Islands', 'Islas de la Bahia'], CMN: ['Mohammed V'], DXB: ['United Arab Emirates', 'Emirates'], TLV: ['Ben Gurion'],
};

/** Country-level synonyms, by ISO 3166-1 alpha-2. */
const COUNTRY: Record<string, readonly string[]> = {
  US: ['United States', 'America', 'US', 'States'], GB: ['UK', 'Britain'], AE: ['United Arab Emirates', 'Emirates'],
  CZ: ['Czechia'], KR: ['Korea'], DO: ['DR'], TC: ['Turks and Caicos'],
};

/** Trip-type words to the destination type they select ('beach' selects Sun). */
export const TYPE_WORDS: Readonly<Record<string, DestinationType>> = {
  sun: 'Sun', sunny: 'Sun', beach: 'Sun', beaches: 'Sun', warm: 'Sun', resort: 'Sun', resorts: 'Sun', tropical: 'Sun', island: 'Sun', islands: 'Sun',
  city: 'City', cities: 'City', urban: 'City', culture: 'City',
  adventure: 'Adventure', outdoors: 'Adventure', nature: 'Adventure', hiking: 'Adventure',
};

const SNOW = ['DEN', 'SLC', 'ANC', 'GVA', 'ZRH', 'BSL', 'MUC', 'VIE', 'KEF', 'CTS', 'OSL'];

/** Activity words not covered by a type: destinations near the snow. */
const ACTIVITY: Readonly<Record<string, readonly string[]>> = {
  ski: SNOW, skiing: SNOW, snow: SNOW, snowboard: SNOW,
};

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Normalised alias words (state, island, airport, country synonyms) for a destination. */
export function aliasWords(d: Pick<Destination, 'code' | 'iso2'>): string[] {
  const phrases = [...(A[d.code] ?? []), ...(COUNTRY[d.iso2] ?? [])];
  return phrases.flatMap(p => norm(p.replace(/[-']/g, ' ')).split(/\s+/)).filter(Boolean);
}

/** True when `token` (already normalised) starts an alias word, or names the type or activity of `d`. */
export function matchesAlias(d: Pick<Destination, 'code' | 'iso2' | 'type'>, token: string): boolean {
  if (TYPE_WORDS[token] === d.type) return true;
  if (ACTIVITY[token]?.includes(d.code)) return true;
  return aliasWords(d).some(w => w.startsWith(token));
}
