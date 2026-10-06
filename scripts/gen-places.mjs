// Writes netlify/functions/lib/places.json (IATA code -> lat/lng) from src/app/data/destinations.ts.
// Run: node --experimental-strip-types scripts/gen-places.mjs   (events.spec.ts fails if the JSON is stale)
import { writeFileSync } from 'node:fs';
import { DESTINATIONS, HUBS } from '../src/app/data/destinations.ts';

const out = {};
for (const p of [...HUBS, ...DESTINATIONS]) out[p.code] = { lat: p.lat, lng: p.lng };
const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(new URL('../netlify/functions/lib/places.json', import.meta.url), JSON.stringify(sorted, null, 1) + '\n');
console.log(`places.json: ${Object.keys(sorted).length} places`);
