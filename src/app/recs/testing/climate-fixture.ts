/**
 * A small climate.json for tests (values are illustrative, not real normals).
 * LIS October is 30° / 23° so formatTypical matches the mock's 'Oct 30° / 23°'.
 */
import type { ClimateFile } from '../model';

const twelve = (base: number, step = 0): number[] => Array.from({ length: 12 }, (_, i) => base + step * i);

export const CLIMATE_FIXTURE: ClimateFile = {
  v: 1,
  source: 'Open-Meteo Historical Weather API, ERA5 reanalysis',
  license: 'CC BY 4.0',
  attribution: 'Weather data by Open-Meteo.com (CC BY 4.0). Contains modified Copernicus Climate Change Service information (ERA5).',
  period: '2021–2025',
  method: 'Mean of days 8–21 of each month',
  generatedAt: '2026-10-01T00:00:00Z',
  done: 4,
  total: 5,
  codes: {
    LIS: { tmax: [15, 16, 19, 20, 23, 27, 29, 29, 27, 30, 18, 15], tmin: [8, 9, 10, 12, 14, 17, 18, 19, 18, 23, 12, 9], precip: twelve(60), wet: twelve(8) },
    FLL: { tmax: [25, 26, 27, 28, 30, 31, 32, 32, 31, 30, 28, 26], tmin: [17, 18, 19, 21, 23, 25, 26, 26, 25, 23, 20, 18], precip: twelve(90), wet: twelve(9) },
    CUN: { tmax: [28, 28, 29, 30, 31, 32, 32, 32, 31, 31, 30, 28], tmin: [20, 20, 21, 22, 24, 25, 25, 25, 24, 23, 22, 20], precip: twelve(80), wet: twelve(7) },
    OPO: { tmax: twelve(14, 1), tmin: twelve(6, 1), precip: twelve(100), wet: twelve(10) },
  },
};
