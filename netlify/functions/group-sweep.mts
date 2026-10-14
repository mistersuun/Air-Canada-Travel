// Daily cleanup: deletes group blobs past their expiresAt (GET also deletes lazily on 410),
// and the per-day budget counters (calls-YYYY-MM-DD) older than 7 days.
import { getStore } from '@netlify/blobs';
import { sweepGroups, type GroupStore } from './lib/group.ts';
import { sweepBudgetKeys, type CounterSweepStore } from './lib/limits.ts';

const BUDGET_STORES = ['groups-budget', 'aeroapi-budget', 'ticketmaster-budget'];

export default async (): Promise<void> => {
  const now = Date.now();
  const removed = await sweepGroups(getStore({ name: 'groups', consistency: 'strong' }) as unknown as GroupStore, now);
  console.log(`group-sweep removed ${removed}`);
  for (const name of BUDGET_STORES) {
    try {
      const n = await sweepBudgetKeys(getStore({ name, consistency: 'strong' }) as unknown as CounterSweepStore, now);
      if (n) console.log(`group-sweep removed ${n} old counters from ${name}`);
    } catch { /* next run */ }
  }
};

export const config = { schedule: '@daily' };
