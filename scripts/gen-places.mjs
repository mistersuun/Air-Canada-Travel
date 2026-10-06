// Writes netlify/functions/lib/places.json (IATA code -> lat/lng) from src/app/data/destinations.ts.
// Airports far from their city (NRT, CDG, MXP...) use the city-centre coordinates listed in
// netlify/functions/lib/place-centres.json, because events are searched around the city.
// Run: node --experimental-strip-types scripts/gen-places.mjs   (events.spec.ts fails if the JSON is stale)
import { readFileSync, writeFileSync } from 'node:fs';
import { DESTINATIONS, HUBS } from '../src/app/data/destinations.ts';

const centres = JSON.parse(readFileSync(new URL('../netlify/functions/lib/place-centres.json', import.meta.url), 'utf8'));
const out = {};
for (const p of [...HUBS, ...DESTINATIONS]) out[p.code] = centres[p.code] ?? { lat: p.lat, lng: p.lng };
const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(new URL('../netlify/functions/lib/places.json', import.meta.url), JSON.stringify(sorted, null, 1) + '\n');
console.log(`places.json: ${Object.keys(sorted).length} places`);
