#!/usr/bin/env python3
"""
Builds public/data/ground.json: real timetables (typical weekday, Saturday and
Sunday departures, both directions) for the hand-kept ground corridors in
src/app/places/corridors.ts. The app shows them as "Scheduled" with the
operator and the dates they are valid for, and falls back to its Estimated
corridor row outside those dates or when the file is missing.

Sources (GTFS, downloaded as published):
  renfe     Renfe AV/LD/MD             CC BY 4.0          data.renfe.com
  sncf      SNCF TGV/Intercités/TER    ODbL 1.0           transport.data.gouv.fr
  eurostar  Eurostar                   Licence Ouverte 2.0 transport.data.gouv.fr
  flix      FlixBus / FlixTrain Europe ODbL 1.0           transport.data.gouv.fr
  dbfv      Germany long distance      CC BY 4.0          DELFI e.V., GTFS.de
  tfi       TFI small operators        CC BY 4.0          National Transport Authority
Opt-in (--include), pending a licence or size decision:
  cp         CP Comboios de Portugal   no licence stated  (LIS-Porto)
  trenitalia Trenitalia (community GTFS of the official NeTEx)  (FCO-Naples, MXP-Turin, VCE-Florence)
  swiss      opentransportdata.swiss   free, cite source  (ZRH-Basel; 289 MB, about 5 min)

Because SNCF and Flix data are ODbL, ground.json is a derived database and is
published under ODbL 1.0; the other licences are met by the attribution kept
in the file ("sources") and shown in the app.

Method, per corridor direction (origin station -> destination station, stop
ids pinned below, child stops included through parent_station):
  * a trip counts when it picks up at an origin stop and later sets down at a
    destination stop (pickup_type / drop_off_type 1 honoured); the last origin
    call before the first destination call gives the departure and ride time
  * times are read in the agency time zone (UTC for Eurostar and Flix), may
    pass 24:00, and are converted to local wall time at the origin station
  * typical days: local dates from build day + 1 to + 28, grouped Mon-Fri, Sat,
    Sun; a departure is kept when it runs on at least half of the group's dates;
    one ride per departure time (the shortest), departures up to 2 min apart
    merged (a train retimed part-way through the window), and rides longer than
    max(1.5 x fastest, fastest + 60 min) are dropped (slow stopping trains)
  * validFrom / validTo: first and last date that has at least half of its
    day type's typical departures (so a calendar that runs on far ahead with a
    few trains does not count); dates inside with no departure at all are
    listed in "x" (the app says "Not found in our timetable data")

Usage:
  python3 scripts/build-ground.py [--out PATH] [--cache DIR] [--offline]
                                  [--only renfe,sncf] [--include cp,trenitalia,swiss]
                                  [--skip flix] [--today YYYY-MM-DD]

Downloads go to --cache (default ~/.cache/routes-ground), with If-Modified-Since.
--offline uses the cache only. A feed that fails keeps the corridors of the
previous ground.json while they are still valid. The file is left untouched
when only builtAt / fetched / validFrom dates would change. Refuses to write over 150 KB.

Stdlib only. Pure functions are unit-tested in scripts/tests/test_build_ground.py
with tiny synthetic GTFS zips.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request
import zipfile
from datetime import date, datetime, timedelta, timezone
from email.utils import formatdate
from typing import Iterable, Iterator
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT_DEFAULT = ROOT / "public" / "data" / "ground.json"
CACHE_DEFAULT = pathlib.Path(os.path.expanduser("~/.cache/routes-ground"))
USER_AGENT = "routes-ground-builder/1 (personal trip planner; +https://github.com/)"

SCAN_DAYS = 28          # typical-day window after the build day
CAL_HORIZON_DAYS = 400  # calendar expansion cap
MAX_BYTES = 150_000
MAX_NO_SERVICE = 30     # cap on listed no-service dates per direction
NEAR_MIN = 2            # departures this close in a template are one train

CC_BY = "https://creativecommons.org/licenses/by/4.0/"
ODBL = "https://opendatacommons.org/licenses/odbl/1-0/"
LO2 = "https://www.etalab.gouv.fr/licence-ouverte-open-licence/"

FILE_LICENSE = "ODbL-1.0"
FILE_LICENSE_NOTE = ("ODbL 1.0 (database). Contains data under CC BY 4.0, Licence Ouverte 2.0 "
                     "and ODbL 1.0; see sources.")

# ── Feeds ───────────────────────────────────────────────────────────────────
# optional: not built unless --include names it (licence or size decision pending).

FEEDS: dict[str, dict] = {
    "renfe": {
        "name": "Renfe", "url": "https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip",
        "page": "https://data.renfe.com/dataset/horarios-de-alta-velocidad-larga-distancia-y-media-distancia",
        "licence": "CC BY 4.0", "licenceUrl": CC_BY, "credit": "Renfe Viajeros (data.renfe.com)",
    },
    "sncf": {
        "name": "SNCF", "url": "https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip",
        "page": "https://transport.data.gouv.fr/datasets/horaires-sncf",
        "licence": "ODbL 1.0", "licenceUrl": ODBL, "credit": "SNCF Voyageurs (transport.data.gouv.fr)",
    },
    "eurostar": {
        "name": "Eurostar", "url": "https://gtfs.eurostar.com/assets/gtfs.zip",
        "page": "https://transport.data.gouv.fr/datasets/eurostar-gtfs",
        "licence": "Licence Ouverte 2.0", "licenceUrl": LO2, "credit": "Eurostar (transport.data.gouv.fr)",
    },
    "flix": {
        "name": "FlixBus", "url": "https://gtfs.gis.flix.tech/gtfs_generic_eu.zip",
        "page": "https://transport.data.gouv.fr/datasets/flixbus-horaires-theoriques-du-reseau-europeen-1",
        "licence": "ODbL 1.0", "licenceUrl": ODBL, "credit": "FlixBus (transport.data.gouv.fr)",
    },
    "dbfv": {
        "name": "Deutsche Bahn", "url": "https://download.gtfs.de/germany/fv_free/latest.zip",
        "page": "https://gtfs.de/en/feeds/de_fv/",
        "licence": "CC BY 4.0", "licenceUrl": CC_BY, "credit": "DELFI e.V., GTFS.de",
    },
    "tfi": {
        "name": "Transport for Ireland",
        "url": "https://www.transportforireland.ie/transitData/Data/GTFS_Small_Operators.zip",
        "page": "https://www.transportforireland.ie/transitData/PT_Data.html",
        "licence": "CC BY 4.0", "licenceUrl": CC_BY, "credit": "National Transport Authority (Transport for Ireland)",
    },
    "cp": {
        "name": "CP", "url": "https://publico.cp.pt/gtfs/gtfs.zip", "page": "https://nap-portugal.imt-ip.pt/",
        "licence": "No licence stated", "licenceUrl": "", "credit": "CP Comboios de Portugal", "optional": True,
    },
    "trenitalia": {
        "name": "Trenitalia", "url": "https://github.com/deryclem/trenitalia-gtfs/raw/HEAD/gtfs-trenitalia.zip",
        "page": "https://github.com/deryclem/trenitalia-gtfs",
        "licence": "CC BY 4.0", "licenceUrl": CC_BY,
        "credit": "Trenitalia via Italy's National Access Point, GTFS by C. Desouche", "optional": True,
    },
    "swiss": {
        "name": "SBB", "url": "https://data.opentransportdata.swiss/de/dataset/timetable-2026-gtfs2020/permalink",
        "page": "https://opentransportdata.swiss/", "licence": "opentransportdata.swiss terms of use",
        "licenceUrl": "https://opentransportdata.swiss/en/terms-of-use/", "credit": "opentransportdata.swiss",
        "optional": True,
    },
}

# ── Corridors ───────────────────────────────────────────────────────────────
# key = '<gateway IATA>-<GeoNames id>' (joins the Corridor row in corridors.ts).
# a = the gateway side, b = the city side; 'out' is a -> b, 'back' is b -> a.
# product: 'short' (route_short_name), 'word' (its first word), 'long'
# (route_long_name), 'stop' (SNCF: the stop_id prefix), or 'name:<literal>'.

_ITALO = "Trenitalia trains only. Italo also runs this route."

CORRIDORS: list[dict] = [
    {"key": "MAD-2510911", "feed": "renfe", "mode": "train", "op": "Renfe", "product": "short",
     "a": {"stops": ["60000"], "name": "Madrid Puerta de Atocha", "tz": "Europe/Madrid"},
     "b": {"stops": ["51003"], "name": "Sevilla Santa Justa", "tz": "Europe/Madrid"},
     "note": "Renfe trains only. Iryo and Ouigo also run this route."},
    {"key": "BCN-2510911", "feed": "renfe", "mode": "train", "op": "Renfe", "product": "short",
     "a": {"stops": ["71801"], "name": "Barcelona Sants", "tz": "Europe/Madrid"},
     "b": {"stops": ["51003"], "name": "Sevilla Santa Justa", "tz": "Europe/Madrid"},
     "note": "Direct Renfe trains only."},
    {"key": "MAD-2517117", "feed": "renfe", "mode": "train", "op": "Renfe", "product": "short",
     "a": {"stops": ["60000"], "name": "Madrid Puerta de Atocha", "tz": "Europe/Madrid"},
     "b": {"stops": ["05000"], "name": "Granada", "tz": "Europe/Madrid"},
     "note": "Renfe trains only. Other operators may also run this route."},
    {"key": "BCN-2509954", "feed": "renfe", "mode": "train", "op": "Renfe", "product": "short",
     "a": {"stops": ["71801"], "name": "Barcelona Sants", "tz": "Europe/Madrid"},
     "b": {"stops": ["65000", "03216"], "name": "València", "tz": "Europe/Madrid"},
     "note": "Renfe trains only. Other operators may also run this route."},
    {"key": "LIS-2510911", "feed": "flix", "mode": "bus", "op": "FlixBus", "product": "name:FlixBus",
     "a": {"stops": ["9a30aab4-4caa-4ee6-9e33-739752be7cd0"], "name": "Lisbon Oriente", "tz": "Europe/Lisbon"},
     "b": {"stops": ["4763b0c9-cd32-4764-acfb-b68f6a2bee21"], "name": "Seville Plaza de Armas", "tz": "Europe/Madrid"},
     "note": "FlixBus only. ALSA also runs this route."},
    {"key": "LIS-2735943", "feed": "cp", "mode": "train", "op": "CP", "product": "short",
     "rename": {"AP": "Alfa Pendular", "IC": "Intercidades", "IR": "Inter-Regional"},
     "a": {"stops": ["94_31039"], "name": "Lisboa Oriente", "tz": "Europe/Lisbon"},
     "b": {"stops": ["94_2006"], "name": "Porto Campanhã", "tz": "Europe/Lisbon"}},
    {"key": "BRU-2988507", "feed": "eurostar", "mode": "train", "op": "Eurostar", "product": "name:Eurostar",
     "a": {"stops": ["8814001"], "name": "Brussels Midi", "tz": "Europe/Brussels"},
     "b": {"stops": ["8727100"], "name": "Paris Gare du Nord", "tz": "Europe/Paris"}},
    {"key": "LHR-2988507", "feed": "eurostar", "mode": "train", "op": "Eurostar", "product": "name:Eurostar",
     "a": {"stops": ["7015400"], "name": "London St Pancras", "tz": "Europe/London"},
     "b": {"stops": ["8727100"], "name": "Paris Gare du Nord", "tz": "Europe/Paris"}},
    {"key": "CDG-2800866", "feed": "sncf", "mode": "train", "op": "SNCF", "product": "stop",
     "rename": {"TGV INOUI": "TGV INOUI", "OUIGO": "OUIGO", "Train": "Train"},
     "a": {"stops": ["StopArea:OCE87271494"], "name": "Aéroport CDG 2 TGV", "tz": "Europe/Paris"},
     "b": {"stops": ["StopArea:OCE88140010"], "name": "Bruxelles Midi", "tz": "Europe/Brussels"}},
    {"key": "AMS-2800866", "feed": "eurostar", "mode": "train", "op": "Eurostar", "product": "name:Eurostar",
     "a": {"stops": ["8400561"], "name": "Schiphol Airport", "tz": "Europe/Amsterdam"},
     "b": {"stops": ["8814001"], "name": "Brussels Midi", "tz": "Europe/Brussels"},
     "note": "Eurostar only. Eurocity Direct trains also run about hourly."},
    {"key": "NCE-2993458", "feed": "sncf", "mode": "train", "op": "SNCF", "product": "stop",
     "rename": {"Train TER": "TER", "TGV INOUI": "TGV INOUI", "INTERCITES": "Intercités", "OUIGO": "OUIGO"},
     "a": {"stops": ["StopArea:OCE87756056"], "name": "Nice-Ville", "tz": "Europe/Paris"},
     "b": {"stops": ["StopArea:OCE87756403"], "name": "Monaco-Monte-Carlo", "tz": "Europe/Monaco"}},
    {"key": "DUB-2655984", "feed": "tfi", "mode": "bus", "op": "Dublin Express", "product": "name:Dublin Express",
     "agency": "Dublin Express",
     "a": {"stops": ["8240000551", "8240DB003665", "8240000550", "8240B111911"], "name": "Dublin Airport",
           "tz": "Europe/Dublin"},
     "b": {"stops": ["700000017125", "700000017104"], "name": "Belfast Grand Central", "tz": "Europe/London"},
     "note": "Dublin Express only. Translink Goldline also runs this route."},
    {"key": "FRA-2886242", "feed": "dbfv", "mode": "train", "op": "Deutsche Bahn", "product": "word",
     "a": {"stops": ["350706"], "name": "Frankfurt Airport long-distance station", "tz": "Europe/Berlin"},
     "b": {"stops": ["2678"], "name": "Köln Hbf", "tz": "Europe/Berlin"}},
    {"key": "FCO-3172394", "feed": "trenitalia", "mode": "train", "op": "Trenitalia", "product": "long",
     "a": {"stops": ["IT::StopPlace:otherTRENITALIA:830008409"], "name": "Roma Termini", "tz": "Europe/Rome"},
     "b": {"stops": ["IT::StopPlace:otherTRENITALIA:830009218"], "name": "Napoli Centrale", "tz": "Europe/Rome"},
     "note": _ITALO},
    {"key": "MXP-3165524", "feed": "trenitalia", "mode": "train", "op": "Trenitalia", "product": "long",
     "a": {"stops": ["IT::StopPlace:otherTRENITALIA:830001700"], "name": "Milano Centrale", "tz": "Europe/Rome"},
     "b": {"stops": ["IT::StopPlace:otherTRENITALIA:830000219"], "name": "Torino Porta Nuova", "tz": "Europe/Rome"},
     "note": _ITALO},
    {"key": "VCE-3176959", "feed": "trenitalia", "mode": "train", "op": "Trenitalia", "product": "long",
     "a": {"stops": ["IT::StopPlace:otherTRENITALIA:830002589"], "name": "Venezia Mestre", "tz": "Europe/Rome"},
     "b": {"stops": ["IT::StopPlace:otherTRENITALIA:830006421"], "name": "Firenze Santa Maria Novella",
           "tz": "Europe/Rome"},
     "note": _ITALO},
    {"key": "ZRH-2661604", "feed": "swiss", "mode": "train", "op": "SBB", "product": "short",
     "a": {"stops": ["Parentch:1:sloid:3016"], "name": "Zürich Flughafen", "tz": "Europe/Zurich"},
     "b": {"stops": ["Parentch:1:sloid:10"], "name": "Basel SBB", "tz": "Europe/Zurich"},
     "note": "Direct trains only."},
]

# GTFS route_type values that are buses or coaches (a 'train' corridor skips them).
def is_bus_route_type(rt: str) -> bool:
    try:
        n = int(rt)
    except ValueError:
        return False
    return n == 3 or 200 <= n < 300 or 700 <= n < 800


class PinnedStopMissing(Exception):
    """A pinned stop id is not in the feed's stops.txt: fix the config, never write nothing silently."""


# ── Reading GTFS ────────────────────────────────────────────────────────────

def has(z: zipfile.ZipFile, name: str) -> bool:
    return name in z.namelist()


def rows(z: zipfile.ZipFile, name: str, cols: Iterable[str]) -> Iterator[tuple[str, ...]]:
    """Stream a GTFS table as tuples of the requested columns, every header and value stripped
    (Renfe pads both with spaces). A missing column gives ''."""
    cols = list(cols)
    with z.open(name) as f:
        rdr = csv.reader(io.TextIOWrapper(f, "utf-8-sig", newline=""))
        try:
            header = [h.strip() for h in next(rdr)]
        except StopIteration:
            return
        idx = [header.index(c) if c in header else -1 for c in cols]
        n = len(header)
        for r in rdr:
            if not r:
                continue
            if len(r) < n:
                r = r + [""] * (n - len(r))
            yield tuple(r[i].strip() if i >= 0 else "" for i in idx)


def parse_secs(t: str) -> int | None:
    """'7:00:00' / '25:10:00' -> seconds after the service day's noon-minus-12h. None when empty."""
    t = t.strip()
    if not t:
        return None
    parts = t.split(":")
    h, m = int(parts[0]), int(parts[1])
    s = int(parts[2]) if len(parts) > 2 else 0
    return h * 3600 + m * 60 + s


def ymd(s: str) -> date:
    return date(int(s[0:4]), int(s[4:6]), int(s[6:8]))


def resolve_stops(stops: dict[str, str], pinned: list[str], where: str) -> set[str]:
    """Pinned ids plus their child stops (parent_station). stops: id -> parent_station."""
    missing = [s for s in pinned if s not in stops]
    if missing:
        raise PinnedStopMissing(f"{where}: pinned stop(s) not in the feed: {', '.join(missing)}")
    want = set(pinned)
    return want | {s for s, parent in stops.items() if parent in want}


def stop_product(stop_id: str) -> str:
    """SNCF 'StopPoint:OCETGV INOUI-87271494' -> 'TGV INOUI'."""
    m = re.match(r"StopPoint:OCE(.+)-\d+$", stop_id)
    return m.group(1) if m else ""


def service_dates(cal: dict[str, tuple], extra: dict[str, list[tuple[date, str]]],
                  sid: str, lo: date, hi: date) -> set[date]:
    """Dates in [lo, hi] a service runs: calendar weekdays in range, then calendar_dates add (1) / remove (2)."""
    out: set[date] = set()
    c = cal.get(sid)
    if c:
        start, end, days = c
        d = max(start, lo)
        last = min(end, hi)
        while d <= last:
            if days[d.weekday()]:
                out.add(d)
            d += timedelta(days=1)
    for d, kind in extra.get(sid, ()):
        if not lo <= d <= hi:
            continue
        if kind == "1":
            out.add(d)
        elif kind == "2":
            out.discard(d)
    return out


def load_feed(z: zipfile.ZipFile, corridors: list[dict], lo: date, hi: date) -> dict[str, dict[str, list]]:
    """For every corridor of one feed, both directions: {key: {'out': runs, 'back': runs}} where a run is
    (local departure datetime, ride minutes, product). Reads only what it needs; never shapes.txt."""
    stops = {sid: parent for sid, parent in rows(z, "stops.txt", ("stop_id", "parent_station"))}
    sets: dict[str, tuple[set[str], set[str]]] = {}
    for c in corridors:
        sets[c["key"]] = (resolve_stops(stops, c["a"]["stops"], f"{c['key']} ({c['a']['name']})"),
                          resolve_stops(stops, c["b"]["stops"], f"{c['key']} ({c['b']['name']})"))
    every = set().union(*(a | b for a, b in sets.values()))

    agencies = {aid: (name, tz) for aid, name, tz in rows(z, "agency.txt", ("agency_id", "agency_name", "agency_timezone"))}
    default_agency = next(iter(agencies.values()), ("", "UTC"))
    routes = {rid: (aid, short, long_, rtype)
              for rid, aid, short, long_, rtype in rows(
                  z, "routes.txt", ("route_id", "agency_id", "route_short_name", "route_long_name", "route_type"))}

    # stop_times: one pass, only calls at the pinned stops.
    calls: dict[str, list[tuple[int, str, int | None, int | None, str, str]]] = {}
    for tid, arr, dep, sid, seq, pu, do in rows(
            z, "stop_times.txt",
            ("trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "pickup_type", "drop_off_type")):
        if sid not in every:
            continue
        a, d = parse_secs(arr), parse_secs(dep)
        calls.setdefault(tid, []).append((int(seq), sid, a if a is not None else d, d if d is not None else a, pu, do))
    if not calls:
        return {c["key"]: {"out": [], "back": []} for c in corridors}

    trips = {tid: (svc, rid) for tid, svc, rid in rows(z, "trips.txt", ("trip_id", "service_id", "route_id")) if tid in calls}

    freqs: dict[str, list[tuple[int, int, int]]] = {}
    if has(z, "frequencies.txt"):
        for tid, start, end, headway in rows(z, "frequencies.txt", ("trip_id", "start_time", "end_time", "headway_secs")):
            if tid in trips and headway:
                freqs.setdefault(tid, []).append((parse_secs(start) or 0, parse_secs(end) or 0, int(headway)))

    services = {svc for svc, _ in trips.values()}
    cal: dict[str, tuple] = {}
    if has(z, "calendar.txt"):
        for row in rows(z, "calendar.txt", ("service_id", "monday", "tuesday", "wednesday", "thursday", "friday",
                                            "saturday", "sunday", "start_date", "end_date")):
            if row[0] in services:
                cal[row[0]] = (ymd(row[8]), ymd(row[9]), tuple(x == "1" for x in row[1:8]))
    extra: dict[str, list[tuple[date, str]]] = {}
    if has(z, "calendar_dates.txt"):
        for svc, d, kind in rows(z, "calendar_dates.txt", ("service_id", "date", "exception_type")):
            if svc in services:
                extra.setdefault(svc, []).append((ymd(d), kind))
    dates_cache: dict[str, set[date]] = {}

    out: dict[str, dict[str, list]] = {}
    for c in corridors:
        A, B = sets[c["key"]]
        agency_rx = re.compile(c["agency"]) if c.get("agency") else None
        res: dict[str, list] = {"out": [], "back": []}
        for direction, (X, Y, origin) in (("out", (A, B, c["a"])), ("back", (B, A, c["b"]))):
            local_tz = ZoneInfo(origin["tz"])
            for tid, cl in calls.items():
                if tid not in trips:
                    continue
                svc, rid = trips[tid]
                aid, short, long_, rtype = routes.get(rid, ("", "", "", ""))
                if c["mode"] == "train" and is_bus_route_type(rtype):
                    continue
                agency_name, agency_tz = agencies.get(aid, default_agency)
                if agency_rx and not agency_rx.search(agency_name):
                    continue
                hit = pick_calls(cl, X, Y)
                if not hit:
                    continue
                x, y = hit
                product = product_of(c, short, long_, x[1])
                if product is None:
                    continue
                ride = round((y[2] - x[3]) / 60)
                if ride <= 0:
                    continue
                if svc not in dates_cache:
                    dates_cache[svc] = service_dates(cal, extra, svc, lo, hi)
                offsets = [x[3]]
                if tid in freqs:
                    first = min(v[3] for v in cl)
                    offsets = [x[3] - first + t for s, e, h in freqs[tid] for t in range(s, e, h)]
                tz = ZoneInfo(agency_tz or "UTC")
                for d in dates_cache[svc]:
                    base = datetime(d.year, d.month, d.day, 12, tzinfo=tz) - timedelta(hours=12)
                    for off in offsets:
                        dep = (base + timedelta(seconds=off)).astimezone(local_tz)
                        res[direction].append((dep, ride, product))
        out[c["key"]] = res
    return out


def pick_calls(cl: list[tuple], X: set[str], Y: set[str]) -> tuple[tuple, tuple] | None:
    """The boarding call (last origin call before the first destination call that comes after an
    origin call), honouring pickup/drop_off 1 (not available)."""
    cl = sorted(cl)
    origins = [v for v in cl if v[1] in X and v[4] != "1" and v[3] is not None]
    if not origins:
        return None
    first = origins[0][0]
    dests = [v for v in cl if v[1] in Y and v[0] > first and v[5] != "1" and v[2] is not None]
    if not dests:
        return None
    y = dests[0]
    x = max(v for v in origins if v[0] < y[0])
    return x, y


def product_of(c: dict, short: str, long_: str, stop_id: str) -> str | None:
    spec = c.get("product", "short")
    if spec.startswith("name:"):
        name = spec[5:]
    elif spec == "stop":
        name = stop_product(stop_id)
        if c["mode"] == "train" and name.startswith("Car"):
            return None  # SNCF 'Car TER' is a coach
    elif spec == "word":
        name = (short.split() or [long_])[0] if (short or long_) else ""
    elif spec == "long":
        name = long_ or short
    else:
        name = short or long_
    return c.get("rename", {}).get(name, name) or c.get("op", "")


# ── Typical days ────────────────────────────────────────────────────────────

def day_type(d: date) -> str:
    wd = d.weekday()
    return "sat" if wd == 5 else "sun" if wd == 6 else "wk"


def by_local_date(runs: list[tuple[datetime, int, str]]) -> dict[date, dict[int, tuple[int, str]]]:
    """{local date: {departure minute: (shortest ride, product)}}, duplicates merged."""
    out: dict[date, dict[int, tuple[int, str]]] = {}
    for dep, ride, product in runs:
        day = out.setdefault(dep.date(), {})
        m = dep.hour * 60 + dep.minute
        if m not in day or ride < day[m][0]:
            day[m] = (ride, product)
    return out


def drop_slow(days: dict[date, dict[int, tuple[int, str]]], fastest: int) -> dict[date, dict[int, tuple[int, str]]]:
    limit = max(1.5 * fastest, fastest + 60)
    return {d: {m: v for m, v in deps.items() if v[0] <= limit} for d, deps in days.items()}


def typical(days: dict[date, dict[int, tuple[int, str]]], today: date) -> dict[str, list[tuple[int, int, str]]]:
    """Mon-Fri / Sat / Sun templates from today + 1 .. + SCAN_DAYS: departures running on at least
    half the group's dates (ride = the shortest seen for that minute)."""
    groups: dict[str, list[date]] = {"wk": [], "sat": [], "sun": []}
    for i in range(1, SCAN_DAYS + 1):
        d = today + timedelta(days=i)
        groups[day_type(d)].append(d)
    out: dict[str, list[tuple[int, int, str]]] = {}
    for g, ds in groups.items():
        seen: dict[int, int] = {}
        best: dict[int, tuple[int, str]] = {}
        for d in ds:
            for m, v in days.get(d, {}).items():
                seen[m] = seen.get(m, 0) + 1
                if m not in best or v[0] < best[m][0]:
                    best[m] = v
        need = math.ceil(len(ds) / 2)
        # A train retimed by a minute part-way through the window shows up twice: keep the
        # more frequent of departures NEAR_MIN apart.
        kept: list[int] = []
        for m, n in sorted(seen.items(), key=lambda kv: (-kv[1], kv[0])):
            if n >= need and all(abs(m - k) > NEAR_MIN for k in kept):
                kept.append(m)
        out[g] = sorted((m, best[m][0], best[m][1]) for m in kept)
    return out


def validity(days: dict[date, dict], tmpl: dict[str, list], today: date) -> tuple[date, date, list[date]] | None:
    """First / last date (from today) with at least half its day type's typical departures, and the
    dates in between with none at all. None when no date qualifies."""
    good = sorted(d for d, deps in days.items()
                  if d >= today and deps and tmpl[day_type(d)] and len(deps) >= len(tmpl[day_type(d)]) / 2)
    if not good:
        return None
    lo, hi = good[0], good[-1]
    gaps = []
    d = lo
    while d <= hi:
        if tmpl[day_type(d)] and not days.get(d):
            gaps.append(d)
        d += timedelta(days=1)
    return lo, hi, gaps[:MAX_NO_SERVICE]


def build_direction(runs: list[tuple[datetime, int, str]], today: date, meta: dict) -> dict | None:
    """One ground.json direction, or None when the feed has nothing usable for it."""
    days = by_local_date(runs)
    window = [today + timedelta(days=i) for i in range(1, SCAN_DAYS + 1)]
    rides = [v[0] for d in window for v in days.get(d, {}).values()]
    if not rides:
        return None
    days = drop_slow(days, min(rides))
    tmpl = typical(days, today)
    if not any(tmpl.values()):
        return None
    span = validity(days, tmpl, today)
    if not span:
        return None
    lo, hi, gaps = span
    products: list[str] = []
    enc: dict[str, list[list[int]]] = {}
    for g in ("wk", "sat", "sun"):
        enc[g] = []
        for m, ride, p in tmpl[g]:
            if p not in products:
                products.append(p)
            enc[g].append([m, ride, products.index(p)])
    out = {**meta, "validFrom": lo.isoformat(), "validTo": hi.isoformat(), "p": products, **enc}
    if gaps:
        out["x"] = [d.isoformat() for d in gaps]
    return out


def build_corridor(c: dict, runs: dict[str, list], today: date) -> dict | None:
    src = c["feed"]
    entry: dict = {"mode": c["mode"]}
    for direction, (o, d) in (("out", (c["a"], c["b"])), ("back", (c["b"], c["a"]))):
        meta = {"src": src, "op": c["op"], "from": o["name"], "to": d["name"], "tz": o["tz"]}
        if c.get("note"):
            meta["note"] = c["note"]
        built = build_direction(runs.get(direction, []), today, meta)
        if built:
            entry[direction] = built
    return entry if "out" in entry or "back" in entry else None


# ── Download and cache ──────────────────────────────────────────────────────

def fetch(feed_id: str, cache: pathlib.Path, offline: bool, log=print) -> pathlib.Path | None:
    """The cached zip, refreshed with If-Modified-Since unless offline. None when unavailable."""
    path = cache / f"{feed_id}.zip"
    if offline:
        return path if path.exists() else None
    cache.mkdir(parents=True, exist_ok=True)
    headers = {"User-Agent": USER_AGENT}
    if path.exists():
        headers["If-Modified-Since"] = formatdate(path.stat().st_mtime, usegmt=True)
    req = urllib.request.Request(FEEDS[feed_id]["url"], headers=headers)
    tmp = path.with_suffix(".part")
    try:
        with urllib.request.urlopen(req, timeout=600) as res, open(tmp, "wb") as f:
            while chunk := res.read(1 << 20):
                f.write(chunk)
        if not zipfile.is_zipfile(tmp):
            raise ValueError("not a zip")
        tmp.replace(path)
        log(f"  {feed_id}: downloaded {path.stat().st_size / 1e6:.1f} MB")
    except urllib.error.HTTPError as e:
        tmp.unlink(missing_ok=True)
        if e.code == 304:
            log(f"  {feed_id}: not modified, using cache")
            path.touch()
        else:
            log(f"  {feed_id}: HTTP {e.code}{', using cache' if path.exists() else ''}")
    except (OSError, ValueError) as e:
        tmp.unlink(missing_ok=True)
        log(f"  {feed_id}: {e}{', using cache' if path.exists() else ''}")
    return path if path.exists() else None


# ── Assemble and write ──────────────────────────────────────────────────────

def still_valid(entry: dict, today: date) -> bool:
    return any(entry.get(d, {}).get("validTo", "") >= today.isoformat() for d in ("out", "back"))


def source_entry(feed_id: str, fetched: str) -> dict:
    f = FEEDS[feed_id]
    return {"name": f["name"], "credit": f["credit"], "licence": f["licence"], "licenceUrl": f["licenceUrl"],
            "url": f["page"], "fetched": fetched}


def assemble(corridors: dict[str, dict], fetched: dict[str, str], previous: dict | None, failed: set[str],
             today: date) -> dict:
    """The ground.json document. Corridors of failed feeds come from the previous file while still valid."""
    corr = dict(corridors)
    sources = {fid: source_entry(fid, d) for fid, d in fetched.items()}
    if previous:
        for key, entry in previous.get("corridors", {}).items():
            src = (entry.get("out") or entry.get("back") or {}).get("src")
            if key not in corr and src in failed and still_valid(entry, today):
                corr[key] = entry
                if src in previous.get("sources", {}):
                    sources.setdefault(src, previous["sources"][src])
    used = {(e.get("out") or e.get("back"))["src"] for e in corr.values()}
    return {
        "v": 1, "builtAt": today.isoformat(), "license": FILE_LICENSE, "licenseNote": FILE_LICENSE_NOTE,
        "licenseUrl": ODBL,
        "sources": {k: v for k, v in sorted(sources.items()) if k in used},
        "corridors": dict(sorted(corr.items())),
    }


def encode(doc: dict) -> str:
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"


def same_content(a: dict, b: dict) -> bool:
    """Equal apart from builtAt, the fetched dates and validFrom (which follows the build day)."""
    def strip(d: dict) -> dict:
        d = json.loads(json.dumps(d))
        d.pop("builtAt", None)
        for s in d.get("sources", {}).values():
            s.pop("fetched", None)
        for e in d.get("corridors", {}).values():
            for direction in ("out", "back"):
                if isinstance(e.get(direction), dict):
                    e[direction].pop("validFrom", None)
        return d
    return strip(a) == strip(b)


def selected_feeds(only: list[str], include: list[str], skip: list[str]) -> list[str]:
    for f in only + include + skip:
        if f not in FEEDS:
            raise SystemExit(f"unknown feed: {f} (known: {', '.join(FEEDS)})")
    ids = only or [f for f in FEEDS if not FEEDS[f].get("optional") or f in include]
    return [f for f in ids if f not in skip]


def summary_line(key: str, entry: dict) -> str:
    parts = []
    for d in ("out", "back"):
        e = entry.get(d)
        if not e:
            parts.append(f"{d} -")
            continue
        wk = e["wk"]
        rides = sorted(r for _, r, _ in wk) or [0]
        parts.append(f"{d} {len(wk)}/{len(e['sat'])}/{len(e['sun'])} ride {rides[0]}-{rides[-1]} to {e['validTo']}")
    return f"  {key:<12} " + " | ".join(parts)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=pathlib.Path, default=OUT_DEFAULT)
    ap.add_argument("--cache", type=pathlib.Path, default=CACHE_DEFAULT)
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--only", default="", help="comma-separated feed ids (overrides the default set)")
    ap.add_argument("--include", default="", help="opt-in feeds: cp, trenitalia, swiss")
    ap.add_argument("--skip", default="")
    ap.add_argument("--today", default="", help="build day (YYYY-MM-DD), default today in UTC")
    args = ap.parse_args(argv)
    split = lambda s: [x for x in s.split(",") if x]  # noqa: E731
    feeds = selected_feeds(split(args.only), split(args.include), split(args.skip))
    today = date.fromisoformat(args.today) if args.today else datetime.now(timezone.utc).date()
    lo, hi = today - timedelta(days=1), today + timedelta(days=CAL_HORIZON_DAYS)

    previous = None
    if args.out.exists():
        try:
            previous = json.loads(args.out.read_text(encoding="utf-8"))
        except ValueError:
            previous = None

    built: dict[str, dict] = {}
    fetched: dict[str, str] = {}
    failed: set[str] = set()
    for fid in feeds:
        corridors = [c for c in CORRIDORS if c["feed"] == fid]
        if not corridors:
            continue
        print(f"{fid}:")
        path = fetch(fid, args.cache, args.offline)
        if not path:
            failed.add(fid)
            continue
        with zipfile.ZipFile(path) as z:
            runs = load_feed(z, corridors, lo, hi)  # PinnedStopMissing propagates: fail loudly
        fetched[fid] = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).date().isoformat()
        for c in corridors:
            entry = build_corridor(c, runs[c["key"]], today)
            if entry:
                built[c["key"]] = entry
                print(summary_line(c["key"], entry))
            else:
                print(f"  {c['key']:<12} no departures in the next {SCAN_DAYS} days: left out")

    doc = assemble(built, fetched, previous, failed, today)
    text = encode(doc)
    size = len(text.encode("utf-8"))
    if size > MAX_BYTES:
        print(f"refusing to write {size} bytes (limit {MAX_BYTES})", file=sys.stderr)
        return 1
    if previous and same_content(previous, doc):
        print(f"{args.out}: unchanged apart from dates, left as is")
        return 0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text, encoding="utf-8")
    print(f"wrote {args.out} ({size / 1000:.1f} KB, {len(doc['corridors'])} corridors)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
