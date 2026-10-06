// Daily cleanup: deletes group blobs past their expiresAt (GET also deletes lazily on 410).
import { getStore } from '@netlify/blobs';
import { sweepGroups, type GroupStore } from './lib/group.ts';

export default async (): Promise<void> => {
  const removed = await sweepGroups(getStore({ name: 'groups', consistency: 'strong' }) as unknown as GroupStore, Date.now());
  console.log(`group-sweep removed ${removed}`);
};

export const config = { schedule: '@daily' };
