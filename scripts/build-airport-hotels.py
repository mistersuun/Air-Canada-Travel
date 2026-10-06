#!/usr/bin/env python3
"""
Builds public/data/airport-hotels.json: hotels within about 3 km of each hub
airport and each ground-corridor gateway, for the "Stuck tonight?" card on the
recover page. Name, coordinates and straight-line distance only: no prices, no
availability, no ratings.

Source: OpenStreetMap through the Overpass API (tourism=hotel, nodes, ways and
relations), (c) OpenStreetMap contributors, ODbL 1.0. The file is a derived
database and is published under ODbL 1.0; the app shows the attribution next
to the list.

Airports: the hubs in src/app/data/destinations.ts, plus the gateway of every
row in src/app/places/corridors.ts (coordinates read from destinations.ts), or
--airports YUL,YHZ. Per airport the nearest MAX_PER_AIRPORT hotels are kept
(one per name within ~100 m), so the file stays small.

Usage:
  python3 scripts/build-airport-hotels.py [--out PATH] [--radius METRES]
                                          [--airports YUL,YHZ] [--today YYYY-MM-DD]
                                          [--fixture overpass.json]   (offline: one saved response for every airport)

An airport whose query fails keeps its hotels from the previous file. The file
is left untouched when nothing but builtAt would change. Refuses to write over
MAX_BYTES. Stdlib only; pure functions are unit-tested in
scripts/tests/test_build_airport_hotels.py.
"""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT_DEFAULT = ROOT / "public" / "data" / "airport-hotels.json"
DESTINATIONS_TS = ROOT / "src" / "app" / "data" / "destinations.ts"
CORRIDORS_TS = ROOT / "src" / "app" / "places" / "corridors.ts"
USER_AGENT = "routes-airport-hotels-builder/1 (personal trip planner)"
ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]

RADIUS_M = 3000
MAX_PER_AIRPORT = 8
MAX_BYTES = 60_000
DEDUPE_M = 100
PAUSE_S = 2.0   # between queries: be kind to the public Overpass servers

ODBL_URL = "https://opendatacommons.org/licenses/odbl/1-0/"
ATTRIBUTION = "(c) OpenStreetMap contributors (openstreetmap.org/copyright), ODbL 1.0"


# ── Airports ────────────────────────────────────────────────────────────────

def parse_airports(ts: str) -> dict[str, tuple[float, float]]:
    """{IATA: (lat, lng)} from the object literals of destinations.ts (hubs and destinations)."""
    out: dict[str, tuple[float, float]] = {}
    for m in re.finditer(r"\{[^{}]*?\}", ts):
        body = m.group(0)
        code = re.search(r"\bcode:\s*'([A-Z]{3})'", body)
        lat = re.search(r"\blat:\s*(-?\d+(?:\.\d+)?)", body)
        lng = re.search(r"\blng:\s*(-?\d+(?:\.\d+)?)", body)
        if code and lat and lng:
            out[code.group(1)] = (float(lat.group(1)), float(lng.group(1)))
    return out


def hub_codes(ts: str) -> list[str]:
    """The codes inside the HUBS array."""
    m = re.search(r"export const HUBS[^=]*=\s*\[(.*?)\n\];", ts, re.S)
    return re.findall(r"code:\s*'([A-Z]{3})'", m.group(1)) if m else []


def corridor_gateways(ts: str) -> list[str]:
    return sorted(set(re.findall(r"\{\s*code:\s*'([A-Z]{3})',\s*geonameId", ts)))


def default_airports() -> dict[str, tuple[float, float]]:
    dest = DESTINATIONS_TS.read_text(encoding="utf-8")
    coords = parse_airports(dest)
    codes = hub_codes(dest) + corridor_gateways(CORRIDORS_TS.read_text(encoding="utf-8"))
    return {c: coords[c] for c in dict.fromkeys(codes) if c in coords}


# ── Overpass ────────────────────────────────────────────────────────────────

def overpass_query(lat: float, lng: float, radius: int = RADIUS_M) -> str:
    return (f'[out:json][timeout:60];nwr["tourism"="hotel"]["name"](around:{radius},{lat:.5f},{lng:.5f});'
            "out center tags;")


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def parse_hotels(resp: dict, lat: float, lng: float, radius: int = RADIUS_M,
                 limit: int = MAX_PER_AIRPORT) -> list[list]:
    """[[name, lat, lng, distM], ...] nearest first: named tourism=hotel elements within `radius`
    (ways and relations by their centre), the same name within DEDUPE_M counted once."""
    found: list[tuple[float, str, float, float]] = []
    for el in resp.get("elements", []):
        tags = el.get("tags") or {}
        if tags.get("tourism") != "hotel":
            continue
        name = re.sub(r"\s+", " ", (tags.get("name") or "").strip())
        if not name:
            continue
        pos = el if "lat" in el else el.get("center") or {}
        if "lat" not in pos or "lon" not in pos:
            continue
        la, lo = float(pos["lat"]), float(pos["lon"])
        d = haversine_m(lat, lng, la, lo)
        if d > radius:
            continue
        found.append((d, name, la, lo))
    found.sort(key=lambda t: (t[0], t[1]))
    kept: list[tuple[float, str, float, float]] = []
    for d, name, la, lo in found:
        if any(k[1].casefold() == name.casefold() and haversine_m(k[2], k[3], la, lo) <= DEDUPE_M for k in kept):
            continue
        kept.append((d, name, la, lo))
        if len(kept) >= limit:
            break
    return [[name, round(la, 5), round(lo, 5), int(round(d / 10.0) * 10)] for d, name, la, lo in kept]


def overpass_failed(resp: dict) -> bool:
    """Overpass answers 200 with a `remark` when a query ran out of time or memory: the elements are then partial."""
    return bool(re.search(r"error|timed out|out of memory", str(resp.get("remark", "")), re.I))


def query_overpass(lat: float, lng: float, radius: int = RADIUS_M, log=print) -> dict | None:
    data = urllib.parse.urlencode({"data": overpass_query(lat, lng, radius)}).encode()
    for url in ENDPOINTS:
        req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=90) as res:
                resp = json.loads(res.read().decode("utf-8"))
            if overpass_failed(resp):
                log(f"    {url}: {resp.get('remark')}")
                continue
            return resp
        except (OSError, ValueError) as e:  # URLError, HTTPError, timeouts, bad JSON
            log(f"    {url}: {e}")
    return None


# ── Assemble and write ──────────────────────────────────────────────────────

def assemble(airports: dict[str, list[list]], failed: set[str], previous: dict | None, today: date) -> dict:
    """The document. A failed airport keeps its previous hotels; airports with no hotels are left out."""
    out = {code: hotels for code, hotels in airports.items() if hotels}
    if previous:
        for code in failed:
            old = previous.get("airports", {}).get(code)
            if old and code not in out:
                out[code] = old
    return {
        "v": 1, "builtAt": today.isoformat(), "license": "ODbL-1.0", "licenseUrl": ODBL_URL,
        "attribution": ATTRIBUTION, "radiusM": RADIUS_M,
        "airports": dict(sorted(out.items())),
    }


def encode(doc: dict) -> str:
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"


def same_content(a: dict, b: dict) -> bool:
    strip = lambda d: {k: v for k, v in d.items() if k != "builtAt"}  # noqa: E731
    return strip(a) == strip(b)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=pathlib.Path, default=OUT_DEFAULT)
    ap.add_argument("--radius", type=int, default=RADIUS_M)
    ap.add_argument("--airports", default="", help="comma-separated IATA codes (default: hubs and corridor gateways)")
    ap.add_argument("--today", default="")
    ap.add_argument("--fixture", type=pathlib.Path, help="a saved Overpass response used for every airport (no network)")
    args = ap.parse_args(argv)
    today = date.fromisoformat(args.today) if args.today else datetime.now(timezone.utc).date()

    coords = default_airports()
    if args.airports:
        every = parse_airports(DESTINATIONS_TS.read_text(encoding="utf-8"))
        wanted = [c for c in args.airports.split(",") if c]
        unknown = [c for c in wanted if c not in every]
        if unknown:
            raise SystemExit(f"unknown airport(s): {', '.join(unknown)}")
        coords = {c: every[c] for c in wanted}

    previous = None
    if args.out.exists():
        try:
            previous = json.loads(args.out.read_text(encoding="utf-8"))
        except ValueError:
            previous = None

    fixture = json.loads(args.fixture.read_text(encoding="utf-8")) if args.fixture else None
    built: dict[str, list[list]] = {}
    failed: set[str] = set()
    for code, (lat, lng) in coords.items():
        resp = fixture if fixture is not None else query_overpass(lat, lng, args.radius)
        if resp is None:
            print(f"  {code}: query failed, keeping the previous list")
            failed.add(code)
        else:
            built[code] = parse_hotels(resp, lat, lng, args.radius)
            print(f"  {code}: {len(built[code])} hotels")
        if fixture is None:
            time.sleep(PAUSE_S)

    doc = assemble(built, failed, previous, today)
    doc["radiusM"] = args.radius
    text = encode(doc)
    size = len(text.encode("utf-8"))
    if size > MAX_BYTES:
        print(f"refusing to write {size} bytes (limit {MAX_BYTES})", file=sys.stderr)
        return 1
    if failed and len(failed) == len(coords):
        print("every query failed: nothing written", file=sys.stderr)
        return 1
    if previous and same_content(previous, doc):
        print(f"{args.out}: unchanged apart from the date, left as is")
        return 0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text, encoding="utf-8")
    print(f"wrote {args.out} ({size / 1000:.1f} KB, {len(doc['airports'])} airports)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
