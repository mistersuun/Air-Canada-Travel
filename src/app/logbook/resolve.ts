import { resolveRef } from '../trips/engine/legs';
import type { DetailResolver } from './logbook';

/** Times and equipment for a flight the log only names, from the schedules when they still list it. Shared by the logbook and the recap card so both count alike. */
export const scheduleDetail: DetailResolver = f => {
  const i = resolveRef({ ...f, depLocal: '', arrLocal: '', arrDateKey: f.dateKey, aircraft: null });
  return i ? { aircraft: i.aircraft ?? null, depLocal: i.depLocal, arrLocal: i.arrLocal, arrDateKey: i.arrDateKey } : null;
};
