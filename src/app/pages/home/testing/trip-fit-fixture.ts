/** Small visa, climate and advisory files for the trip-fit specs (values are illustrative). */
import { decodeClimate } from '../../../recs/climate';
import { decodeAdvisories } from '../../../reference/reference';
import { decodeVisa } from '../../../reference/visa';

const twelve = (base: number): number[] => Array.from({ length: 12 }, () => base);
const wx = (tmax: number, wet: number) => ({ tmax: twelve(tmax), tmin: twelve(tmax - 8), precip: twelve(60), wet: twelve(wet) });

/** Canadian passport: GB authorization (T), GR visa-free (F90), AU authorization (T), IN e-visa (E), CA own country (O), FR visa (V). */
export const VISA_FILE = {
  v: 1, source: 'Passport Index data', license: 'MIT', licenseUrl: 'https://github.com/imorte/passport-index-data/blob/main/LICENSE',
  attribution: 'Passport Index data (passportindex.org), compiled by imorte/passport-index-data (MIT licence)',
  asOf: '2026-09-01', generatedAt: '2026-10-01T00:00:00Z',
  cols: ['AU', 'CA', 'FR', 'GB', 'GR', 'IN'],
  rows: { CA: 'T,O,V,T,F90,E', IN: 'V,V,V,V,V,O' },
};

/** LHR cool and wet, ATH warm and dry, SYD has no data. */
export const CLIMATE_FILE = {
  v: 1, attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)', period: '2021–2025',
  codes: { LHR: wx(14, 12), ATH: wx(26, 4), CDG: wx(17, 8) },
};

/** GR level 0, GB level 2, FR level 1; AU has none. */
export const ADVISORY_FILE = {
  countries: {
    GR: { level: 0, text: 'Exercise normal security precautions', url: 'https://travel.gc.ca/destinations/greece' },
    GB: { level: 2, text: 'Avoid non-essential travel', url: 'https://travel.gc.ca/destinations/united-kingdom' },
    FR: { level: 1, text: 'Exercise a high degree of caution', url: 'https://travel.gc.ca/destinations/france' },
  },
};

export const visaTable = () => decodeVisa(VISA_FILE)!;
export const climateIndex = () => decodeClimate(CLIMATE_FILE)!;
export const advisoryIndex = () => decodeAdvisories(ADVISORY_FILE)!;
