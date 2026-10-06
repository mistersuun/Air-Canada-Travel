/*
 * Custom service worker: Angular's ngsw-worker.js (offline cache, updates)
 * plus three small, same-origin-only extras. Nothing here sends data anywhere.
 *
 *  1. Web Share Target: POST /share-in (multipart) -> files/text stashed in
 *     Cache Storage ('ac-share-in') -> 303 to /share-in?id=<id>, where the app
 *     reads and deletes them.
 *  2. Periodic Background Sync 'schedule-check' (installed Chromium PWAs):
 *     fetches data/schedules.json; if meta.generatedAt changed, tells open
 *     windows, or else shows one local notification. Best effort: the browser
 *     decides when (if ever) it runs.
 *  3. notificationclick: focuses or opens /trips.
 *
 * Our fetch/message listeners are registered BEFORE importScripts so a share
 * POST is answered here and ngsw never sees it (stopImmediatePropagation).
 * Keep the stash layout in sync with src/app/share-in/share-payload.ts.
 */
'use strict';

var SHARE_CACHE = 'ac-share-in';
var SHARE_PATH = '/share-in';
var SYNC_CACHE = 'ac-sched-check';
var SYNC_TAG = 'schedule-check';
var SEEN_KEY = '/__sched-seen';
var MAX_AGE_MS = 60 * 60 * 1000;
var MAX_FILES = 5;
var MAX_BYTES = 25 * 1024 * 1024;

function str(v) {
  return typeof v === 'string' ? v.slice(0, 100000) : '';
}

/** Stashes the form under /__share/<id>/<n> (+ meta.json) and returns the id. */
async function stashShare(form) {
  var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  var cache = await caches.open(SHARE_CACHE);
  await purgeOld(cache);
  var files = [];
  var entries = form.getAll('files').filter(function (f) { return typeof f !== 'string'; });
  var total = 0;
  for (var k = 0; k < entries.length; k++) total += entries[k].size;
  if (entries.length > MAX_FILES || total > MAX_BYTES) return null;
  for (var i = 0; i < entries.length; i++) {
    var f = entries[i];
    if (typeof f === 'string') continue;
    await cache.put('/__share/' + id + '/' + files.length, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }));
    files.push({ name: f.name || 'shared', type: f.type || '', size: f.size });
  }
  var meta = { at: Date.now(), title: str(form.get('title')), text: str(form.get('text')), url: str(form.get('url')), files: files };
  await cache.put('/__share/' + id + '/meta.json', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  return id;
}

/** Drops stashes the app never collected (older than an hour). */
async function purgeOld(cache) {
  var keys = await cache.keys();
  for (var i = 0; i < keys.length; i++) {
    var m = /\/__share\/([^/]+)\/meta\.json$/.exec(keys[i].url);
    if (!m) continue;
    var res = await cache.match(keys[i]);
    var meta = res ? await res.json().catch(function () { return null; }) : null;
    if (meta && Date.now() - meta.at <= MAX_AGE_MS) continue;
    var all = await cache.keys();
    for (var j = 0; j < all.length; j++) if (all[j].url.indexOf('/__share/' + m[1] + '/') >= 0) await cache.delete(all[j]);
  }
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url = new URL(req.url);
  if (req.method !== 'POST' || url.pathname !== SHARE_PATH) return;
  // Only a same-origin navigation (the OS share sheet or our own form) may leave files here.
  if (url.origin !== self.location.origin || req.mode !== 'navigate') return;
  if (req.referrer && new URL(req.referrer).origin !== self.location.origin) return;
  event.stopImmediatePropagation();
  event.respondWith((async function () {
    try {
      var id = await stashShare(await req.formData());
      if (id === null) id = 'too-large';
      return Response.redirect(new URL(SHARE_PATH + '?id=' + id, self.location.href).href, 303);
    } catch (e) {
      return Response.redirect(new URL(SHARE_PATH + '?id=failed', self.location.href).href, 303);
    }
  })());
});

/** True only for a newer value (ISO strings sort) against a known baseline: a first run is not a change. */
function scheduleChanged(previous, current) {
  return !!current && !!previous && current > previous;
}

async function readSeen() {
  var cache = await caches.open(SYNC_CACHE);
  var res = await cache.match(SEEN_KEY);
  return res ? res.text() : null;
}

async function writeSeen(value) {
  var cache = await caches.open(SYNC_CACHE);
  await cache.put(SEEN_KEY, new Response(value));
}

async function checkSchedules() {
  var res = await fetch('/data/schedules.json', { cache: 'no-store' });
  if (!res.ok) return;
  var json = await res.json();
  var current = json && json.meta && typeof json.meta.generatedAt === 'string' ? json.meta.generatedAt : null;
  var previous = await readSeen();
  if (current && (!previous || current > previous)) await writeSeen(current);
  if (!scheduleChanged(previous, current)) return;
  var clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clients.length) {
    clients.forEach(function (c) { c.postMessage({ type: 'ac:schedules-updated', generatedAt: current }); });
    return;
  }
  await self.registration.showNotification('Schedules updated', {
    body: 'Open to check your trips.', tag: SYNC_TAG, icon: '/icons/icon-192x192.png', data: { url: '/trips' },
  });
}

self.addEventListener('periodicsync', function (event) {
  if (event.tag === SYNC_TAG) event.waitUntil(checkSchedules().catch(function () { /* try again next time */ }));
});

/** The app reports the schedules it has loaded, so we never notify about what the user already sees. */
self.addEventListener('message', function (event) {
  var d = event.data;
  if (d && d.type === 'ac:schedules-seen' && typeof d.generatedAt === 'string') {
    event.waitUntil(readSeen().then(function (prev) { if (!prev || d.generatedAt > prev) return writeSeen(d.generatedAt); }));
  }
});

self.addEventListener('notificationclick', function (event) {
  var data = event.notification.data;
  if (!data || typeof data.url !== 'string') return; // not ours (ngsw handles its own)
  event.notification.close();
  event.waitUntil((async function () {
    var clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (var i = 0; i < clients.length; i++) {
      if ('focus' in clients[i]) {
        await clients[i].focus();
        if ('navigate' in clients[i]) await clients[i].navigate(data.url).catch(function () { /* ignore */ });
        return;
      }
    }
    await self.clients.openWindow(data.url);
  })());
});

importScripts('./ngsw-worker.js');
