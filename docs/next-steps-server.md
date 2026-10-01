# Next steps: adding a server

Everything in Routes today runs on your phone. Schedules, trips, load notes, outcomes, boarding passes and attachments are stored in the browser (localStorage and IndexedDB) and the app works offline. This file lists what a small backend would unlock, how to add one without breaking the offline app, and the order to do it in.

Status: **not started.** Pick this up when you're ready to run a server.

---

## 1. What a server unlocks

| Feature | Why it needs a server | Builds on (already on-device) |
|---|---|---|
| **Accounts and sign-in** | Something has to know who you are across devices | – |
| **Sync and backup** | Same trips, standby log and passes on phone and laptop; nothing lost with a new phone | Trip export/import (`src/app/trips/export.ts`) |
| **Friends** | A list of people you know, and who can see what | – |
| **Live shared trips** | Today a share link is a snapshot (`/trips/import#t=…`). With a server, companions see your updates as they happen (e.g. you switch to Plan B) | Share codec (`src/app/trips/share-codec.ts`) |
| **Trip comments and chat** | Messages need to be stored and delivered | Trips, legs |
| **"I'm on AC812 too"** | Matching friends on the same flight or in the same city | Trips, flight refs |
| **Real notifications** | A static PWA can't send dependable timed alerts. Web Push needs a server to send them | Change detection (`src/app/trips/engine/changes.ts`), prep reminders |
| **Schedule-change alerts while the app is closed** | The server diffs each weekly schedule against everyone's trips and pushes | Same change detection, run server-side |
| **Claude trip planning** | "4 days somewhere warm, home by Monday": the Claude API key must stay on a server, and each request costs money | On-device recommendations, reach, home-by engine |
| **Shared standby insights (opt-in)** | Pooled, anonymous outcome counts per route/day from friends who opt in | Outcome log (`FlightLog.outcomes`) |

## 2. Recommended stack

**Supabase** (free tier is enough for you, friends and family):

- **Auth:** email magic link, plus Google/Apple sign-in.
- **Postgres with Row Level Security:** each row is readable only by its owner and the people they shared it with.
- **Realtime:** live shared trips and chat without writing a socket server.
- **Storage:** boarding pass images and attachments, private buckets, signed URLs.
- **Edge Functions:** Web Push sending, the weekly change-alert job, the Claude API proxy.

It works alongside the existing Netlify site; the Angular app talks to it with `@supabase/supabase-js`. Firebase is the alternative if you prefer Google's ecosystem; the plan below maps one-to-one.

Rough cost at personal scale: **$0** (Supabase free tier, Netlify free tier). Claude planning is pay-per-use: a few cents per planning request with `claude-opus-5-5`, less with `claude-sonnet-5-5`.

## 3. Data model (server side)

Mirror the on-device types in `src/app/trips/model.ts` so sync is a straight copy:

```
profiles        id (auth uid), display_name, home_hub, avatar_url, created_at
friendships     user_id, friend_id, status (pending | accepted), created_at
trips           id, owner_id, data jsonb (the Trip object), updated_at, deleted_at
trip_members    trip_id, user_id, role (owner | editor | viewer)
flight_log      id, owner_id, kind (note | outcome), data jsonb, updated_at
attachments     id, owner_id, trip_id, leg_id, storage_path, mime, size, kind (pass | file | note), created_at
comments        id, trip_id, author_id, leg_id null, body, created_at
push_subs       id, user_id, endpoint, keys jsonb, created_at
```

RLS rules:
- `trips`: the owner can read/write; members can read; editors can write.
- `attachments` with `kind = 'pass'`: **owner only, never shared** (a boarding pass barcode contains your booking reference).
- `flight_log`: owner only. A separate opt-in view exposes anonymous counts for shared insights.

## 4. Sync design (keep offline-first)

The device stays the source of truth while offline; the server is a sync target.

1. Every record already has an `id` and `updatedAt`. Keep that.
2. On sign-in: upload local trips, flight log and attachments the server doesn't have. Merge with the same rule as `mergeBackup` (the newer `updatedAt` wins, per record).
3. While online: subscribe to Realtime on your trips and `trip_members` trips; apply remote changes locally.
4. While offline: queue writes in IndexedDB (`outbox`) and replay them on reconnect.
5. Deletes are soft (`deleted_at`) so they sync.
6. Signed-out mode must keep working exactly like today.

## 5. Notifications

- Ask for permission only from a clear action ("Alert me about changes to this trip").
- Store the Web Push subscription in `push_subs`.
- Weekly job (Edge Function on a schedule, after the schedules workflow publishes): run the change detection from `changes.ts` against each active trip and push "AC813 on Tue Oct 13 was retimed to 11:10".
- Reminder pushes: listing reminders, "you haven't listed for tomorrow", outcome prompt the morning after a flight.
- iOS only delivers Web Push to PWAs added to the Home Screen; tell the user.

## 6. Friends and sharing

- **Invite:** a share link that, when opened signed-in, sends a friend request.
- **Share a trip:** add friends as viewer or editor (`trip_members`). The existing snapshot link keeps working for people without accounts.
- **Comments:** a thread per trip, optionally pinned to a leg ("I'll be on AC812 instead").
- **Same flight / same city:** opt-in per trip; show friends with a leg on the same flight instance (`instanceKey`) or a goal within 50 km on overlapping dates.
- **Privacy defaults:** trips private, passes never shared, load notes shared only inside a shared trip.

## 7. Claude trip planning

- Edge Function `plan-trip` calls the Claude API (`claude-opus-5-5`, adaptive thinking, structured output) with:
  - the user's request, home hub, profile and deadline;
  - a compact candidate list computed on-device (reach + home-by engines over the real schedules), so Claude chooses among real flights and never invents them.
- It returns 2–3 plans as structured JSON that the app renders as draft Trips.
- Rate-limit per user. Log cost per request.
- The API key lives only in Supabase secrets, never in the app bundle.

## 8. Order of work

1. Supabase project, auth, `profiles`. Sign-in is optional; signed-out still works.
2. Sync trips and the flight log (outbox, merge, Realtime). Add a "Synced" indicator.
3. Attachments and passes in private Storage, passes owner-only.
4. Friends and trip members; live shared trips; comments.
5. Web Push: subscriptions, weekly change alerts, reminders.
6. Claude planning Edge Function.
7. Opt-in shared standby insights.

## 9. Decisions to make before starting

- Supabase or Firebase.
- Who can sign up: invite-only (recommended) or open.
- Whether boarding passes sync at all, or stay on-device only (recommended: stay on-device unless you opt in per pass).
- Model for Claude planning: `claude-opus-5-5` (best) or `claude-sonnet-5-5` (cheaper).
- A domain for the app (helps with sign-in links and push).

## 10. Extras when a server exists

Boarding passes, trip files, the travel profile, recommendations and the share card all work today without a server (IndexedDB `routes-files`, `src/app/files/**`, `src/app/passes/**`, `src/app/recs/**`, `src/app/share/**`). A server would add:

- **Opt-in, end-to-end-encrypted sync of trip files.**
  - Encrypt each blob on the device (WebCrypto AES-GCM, key derived from a passphrase or a device-held key wrapped per device), upload only ciphertext to private Storage, and keep the `Attachment` metadata in Postgres under the owner's Row Level Security.
  - Reuse the on-device store: `FilesStore` gains a sync outbox; `FilesService` stays the only writer.
  - **Boarding passes stay device-only** unless the user explicitly opts in **per pass**. A synced pass is encrypted the same way, never visible to companions, and still never appears in share links, share text or images, or backups.
- **Sharing files with a companion.** Per-file, per-trip-member grants (hotel confirmation, train tickets). Passes and booking codes are never shareable this way. Revoking a grant deletes the companion's copy on their next sync.
- **Server-side climate refresh.** A scheduled job reruns `scripts/build-climate.py` against Open-Meteo (within its terms; a commercial plan if the app ever stops being a free personal tool), keeps the CC BY 4.0 attribution, and publishes `data/climate.json` with the weekly schedules. It stays labelled "Typical, not a forecast".
- **Recommendations that use companions' outcome logs.** Only with each companion's consent, only as counts ("Your group boarded 5 of 6 tries"), never percentages or odds, and never implying a seat is free. The on-device engine (`src/app/recs/engine.ts`) takes the pooled counts as one more input; nothing else changes.
