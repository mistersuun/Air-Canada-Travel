#!/usr/bin/env python3
"""
Builds public/data/climate.json: typical monthly weather (normals) for every
Air Canada destination, shown in the app as "Typical, not a forecast".

Source: Open-Meteo Historical Weather API (https://open-meteo.com), ERA5
reanalysis, CC BY 4.0. Contains modified Copernicus Climate Change Service
information. The free API is for non-commercial use; Routes is a free personal
tool, so it qualifies.

Method: for each destination, each year 2021..2025 and each month, one request
for days 8-21 of that month (14 days, so Open-Meteo counts it as one call).
60 calls per location keeps ~160 locations under the free 10,000 calls a day.
Responses are cached under --cache (default ~/.cache/routes-climate), so a run
that stops on the quota resumes tomorrow where it left off.

Aggregation per month, over the 5 x 14 days:
  tmax / tmin  mean daily max / min temperature, rounded to an integer deg C
  precip       mean 14-day total x (days in month / 14), rounded mm
  wet          mean count of days >= 1 mm x (days in month / 14), rounded
A location is written only when all 12 months have >= 3 years of data.

Usage:
  python3 scripts/build-climate.py [--out PATH] [--cache DIR] [--limit N] [--sleep S]
                                   [--first LIS,FLL] [--offline]

--first fetches those codes before the rest; --offline makes no request and
writes every location already complete in the cache (a partial file).

Stdlib only. The pure functions (parse, aggregate, build) are unit-tested in
scripts/tests/test_build_climate.py with canned responses.
"""

from __future__ import annotations

import argparse
import calendar
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Callable, Iterable

ROOT = pathlib.Path(__file__).resolve().parents[1]
DESTINATIONS_TS = ROOT / "src" / "app" / "data" / "destinations.ts"
OUT_DEFAULT = ROOT / "public" / "data" / "climate.json"
CACHE_DEFAULT = pathlib.Path(os.path.expanduser("~/.cache/routes-climate"))

API = "https://archive-api.open-meteo.com/v1/archive"
YEARS = (2021, 2022, 2023, 2024, 2025)
WINDOW = (8, 21)  # days of the month, inclusive (14 days)
WINDOW_DAYS = WINDOW[1] - WINDOW[0] + 1
MIN_YEARS = 3
USER_AGENT = "Mozilla/5.0 (compatible; routes-climate-builder)"

SOURCE = "Open-Meteo Historical Weather API, ERA5 reanalysis"
ATTRIBUTION = ("Weather data by Open-Meteo.com (CC BY 4.0). Contains modified Copernicus "
               "Climate Change Service information (ERA5).")
PERIOD = "2021–2025"
METHOD = "Mean of days 8–21 of each month"


class QuotaError(Exception):
    """HTTP 429 or a 'limit exceeded' answer: stop and write what is complete."""


# ── Destinations ────────────────────────────────────────────────────────────

_ENTRY = re.compile(r"\{[^{}]*?code:\s*'([A-Z]{3})'[^{}]*?\}")
_FIELD = {
    "lat": re.compile(r"\blat:\s*(-?\d+(?:\.\d+)?)"),
    "lng": re.compile(r"\blng:\s*(-?\d+(?:\.\d+)?)"),
    "type": re.compile(r"\btype:\s*'(\w+)'"),
}


def parse_destinations(ts: str) -> list[dict]:
    """[{code, lat, lng, type}] from destinations.ts, Hub entries and the HUBS list skipped."""
    start = ts.find("export const DESTINATIONS")
    body = ts[start:] if start >= 0 else ts
    out: list[dict] = []
    seen: set[str] = set()
    for m in _ENTRY.finditer(body):
        block = m.group(0)
        fields = {k: rx.search(block) for k, rx in _FIELD.items()}
        if not all(fields.values()):
            continue
        typ = fields["type"].group(1)
        code = m.group(1)
        if typ == "Hub" or code in seen:
            continue
        seen.add(code)
        out.append({"code": code, "lat": float(fields["lat"].group(1)),
                    "lng": float(fields["lng"].group(1)), "type": typ})
    return out


# ── Requests and cache ──────────────────────────────────────────────────────

def window_dates(year: int, month: int) -> tuple[str, str]:
    return f"{year}-{month:02d}-{WINDOW[0]:02d}", f"{year}-{month:02d}-{WINDOW[1]:02d}"


def request_url(lat: float, lng: float, year: int, month: int) -> str:
    start, end = window_dates(year, month)
    return (f"{API}?latitude={lat}&longitude={lng}&start_date={start}&end_date={end}"
            "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&models=era5&timezone=GMT")


def cache_path(cache: pathlib.Path, code: str, year: int, month: int) -> pathlib.Path:
    return cache / f"{code}-{year}-{month:02d}.json"


def http_get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            pass
        if e.code == 429 or "limit" in body.lower():
            raise QuotaError(f"HTTP {e.code}: {body[:200]}") from e
        raise


def is_quota_answer(data: dict) -> bool:
    return bool(data.get("error")) and "limit" in str(data.get("reason", "")).lower()


def fetch_month(dest: dict, year: int, month: int, cache: pathlib.Path,
                get: Callable[[str], dict], pause: Callable[[], None]) -> dict | None:
    """One window, from the cache when present. Raises QuotaError. None on a bad answer."""
    path = cache_path(cache, dest["code"], year, month)
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            path.unlink(missing_ok=True)
    data = get(request_url(dest["lat"], dest["lng"], year, month))
    pause()
    if is_quota_answer(data):
        raise QuotaError(str(data.get("reason")))
    if data.get("error") or "daily" not in data:
        return None
    cache.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")
    return data


# ── Aggregation ─────────────────────────────────────────────────────────────

def window_stats(data: dict) -> dict | None:
    """Means over one 14-day window: {tmax, tmin, precip_total, wet_days}, or None when incomplete."""
    daily = (data or {}).get("daily") or {}
    tmax = [v for v in daily.get("temperature_2m_max") or [] if v is not None]
    tmin = [v for v in daily.get("temperature_2m_min") or [] if v is not None]
    pr = [v for v in daily.get("precipitation_sum") or [] if v is not None]
    if len(tmax) < 10 or len(tmin) < 10 or len(pr) < 10:
        return None
    scale = WINDOW_DAYS / len(pr)  # a short window still describes 14 days
    return {
        "tmax": sum(tmax) / len(tmax),
        "tmin": sum(tmin) / len(tmin),
        "precip_total": sum(pr) * scale,
        "wet_days": sum(1 for v in pr if v >= 1.0) * scale,
    }


def aggregate_month(windows: Iterable[dict | None], month: int, ref_year: int = 2025) -> dict | None:
    """Normals for one month from up to 5 window stats; None with fewer than MIN_YEARS."""
    ok = [w for w in windows if w]
    if len(ok) < MIN_YEARS:
        return None
    n = len(ok)
    factor = calendar.monthrange(ref_year, month)[1] / WINDOW_DAYS
    return {
        "tmax": round(sum(w["tmax"] for w in ok) / n),
        "tmin": round(sum(w["tmin"] for w in ok) / n),
        "precip": round(sum(w["precip_total"] for w in ok) / n * factor),
        "wet": round(sum(w["wet_days"] for w in ok) / n * factor),
    }


def location_normals(months: list[dict | None]) -> dict | None:
    """{tmax:[12], tmin:[12], precip:[12], wet:[12]} or None when any month is missing."""
    if len(months) != 12 or any(m is None for m in months):
        return None
    return {k: [m[k] for m in months] for k in ("tmax", "tmin", "precip", "wet")}


def build_file(codes: dict[str, dict], total: int, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    return {
        "v": 1,
        "source": SOURCE,
        "license": "CC BY 4.0",
        "attribution": ATTRIBUTION,
        "period": PERIOD,
        "method": METHOD,
        "generatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "done": len(codes),
        "total": total,
        "codes": dict(sorted(codes.items())),
    }


def write_file(path: pathlib.Path, data: dict) -> int:
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text + "\n", encoding="utf-8")
    return len(text) + 1


# ── Driver ──────────────────────────────────────────────────────────────────

def order_first(dests: list[dict], first: str) -> list[dict]:
    """The listed codes first (in that order), then the rest in file order."""
    want = [c.strip().upper() for c in first.split(",") if c.strip()]
    rank = {c: i for i, c in enumerate(want)}
    return sorted(dests, key=lambda d: rank.get(d["code"], len(want)))


def offline_get(url: str) -> dict:
    """--offline: a cache miss is just missing data (the location is skipped)."""
    return {"error": True, "reason": "offline: not in cache"}


def run(dests: list[dict], cache: pathlib.Path, get: Callable[[str], dict] = http_get,
        pause: Callable[[], None] = lambda: None, log: Callable[[str], None] = print) -> tuple[dict, bool]:
    """Builds normals for every destination it can. Returns (codes, stopped_on_quota)."""
    codes: dict[str, dict] = {}
    for i, dest in enumerate(dests, 1):
        months: list[dict | None] = []
        try:
            for month in range(1, 13):
                stats = [window_stats(fetch_month(dest, y, month, cache, get, pause) or {}) for y in YEARS]
                months.append(aggregate_month(stats, month))
        except QuotaError as e:
            log(f"stopped on the API limit at {dest['code']} ({e}); rerun later to resume from the cache")
            return codes, True
        normals = location_normals(months)
        if normals:
            codes[dest["code"]] = normals
        log(f"[{i}/{len(dests)}] {dest['code']} {'ok' if normals else 'incomplete, skipped'}")
    return codes, False


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=pathlib.Path, default=OUT_DEFAULT)
    ap.add_argument("--cache", type=pathlib.Path, default=CACHE_DEFAULT)
    ap.add_argument("--limit", type=int, default=0, help="only the first N destinations (testing)")
    ap.add_argument("--sleep", type=float, default=0.8, help="seconds between API calls")
    ap.add_argument("--first", default="", help="comma-separated codes to fetch first")
    ap.add_argument("--offline", action="store_true", help="cache only: no requests, write what is complete")
    args = ap.parse_args(argv)

    dests = order_first(parse_destinations(DESTINATIONS_TS.read_text(encoding="utf-8")), args.first)
    if args.limit:
        dests = dests[: args.limit]
    get = offline_get if args.offline else http_get
    codes, stopped = run(dests, args.cache, get=get, pause=lambda: None if args.offline else time.sleep(args.sleep))
    size = write_file(args.out, build_file(codes, len(dests)))
    print(f"wrote {args.out} ({size} bytes): {len(codes)}/{len(dests)} locations"
          + (" (partial: API limit reached)" if stopped else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
