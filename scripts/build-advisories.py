#!/usr/bin/env python3
"""
Builds public/data/advisories.json: the Government of Canada travel advice
level for every destination country, shown on the destination page as the
official wording, the date it was last updated and a link to travel.gc.ca.
The app states the facts as published and adds no interpretation.

Source: Country Travel Advice and Advisories, Global Affairs Canada, open data
https://data.international.gc.ca/travel-voyage/index-alpha-eng.json
(Open Government Licence - Canada).

Structure read (the feed's documented shape; the build sandbox could not reach
it, so tests use a fixture of that shape):
  {"metadata": {...}, "data": {"<ISO2>": {"country-iso": "ES", "advisory-state": 0-3,
     "has-regional-advisory", "date-published": {"timestamp", "date": "YYYY-MM-DD HH:MM:SS", "asp": ISO},
     "eng": {"name", "url-slug", "advisory-text"}}}}}
Levels: 0 Exercise normal security precautions, 1 Exercise a high degree of caution,
2 Avoid non-essential travel, 3 Avoid all travel. The feed's own advisory-text
is kept verbatim; when it is missing the standard wording for the level is used.
A country with no usable level is left out (the app shows nothing for it).

Gate: refuses to write when fewer than 80% of the destination countries are
present, leaving the existing file untouched.

Usage: python3 scripts/build-advisories.py [--out PATH] [--input FEED.json]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import _refdata as rd  # noqa: E402

FEED_URL = "https://data.international.gc.ca/travel-voyage/index-alpha-eng.json"
PAGE_URL = "https://travel.gc.ca/destinations/"
FALLBACK_URL = "https://travel.gc.ca/travelling/advisories"
SOURCE = "Government of Canada, Travel Advice and Advisories (travel.gc.ca)"
OUT_DEFAULT = rd.ROOT / "public" / "data" / "advisories.json"
LEVEL_TEXT = {
    0: "Exercise normal security precautions",
    1: "Exercise a high degree of caution",
    2: "Avoid non-essential travel",
    3: "Avoid all travel",
}


def _entries(feed: object) -> dict:
    data = feed.get("data") if isinstance(feed, dict) else None
    return data if isinstance(data, dict) else {}


def _level(entry: dict) -> int | None:
    raw = entry.get("advisory-state")
    if isinstance(raw, bool) or not isinstance(raw, (int, str)):
        return None
    try:
        n = int(raw)
    except ValueError:
        return None
    return n if 0 <= n <= 3 else None


def _date(entry: dict) -> str | None:
    """YYYY-MM-DD from entry["date-published"] ({date: "YYYY-MM-DD HH:MM:SS", asp: ISO, timestamp})."""
    pub = entry.get("date-published")
    cands = [pub.get("date"), pub.get("asp")] if isinstance(pub, dict) else [pub]
    for s in cands:
        m = re.match(r"(\d{4}-\d{2}-\d{2})", s) if isinstance(s, str) else None
        if not m:
            continue
        try:
            dt.date.fromisoformat(m.group(1))
        except ValueError:
            continue
        return m.group(1)
    return None


def parse_country(entry: object) -> dict | None:
    if not isinstance(entry, dict):
        return None
    level = _level(entry)
    if level is None:
        return None
    eng = entry.get("eng") if isinstance(entry.get("eng"), dict) else {}
    text = eng.get("advisory-text")
    text = " ".join(text.split()) if isinstance(text, str) and text.strip() else LEVEL_TEXT[level]
    slug = eng.get("url-slug")
    url = PAGE_URL + slug if isinstance(slug, str) and re.fullmatch(r"[a-z0-9\-]+", slug) else FALLBACK_URL
    out: dict = {"level": level, "text": text}
    updated = _date(entry)
    if updated:
        out["updated"] = updated
    out["url"] = url
    out["regional"] = entry.get("has-regional-advisory") in (True, 1, "1", "true")
    return out


def build(feed: object, wanted: list[str], now: dt.datetime | None = None) -> dict:
    """The file for the wanted countries; raises ValueError under the 80% gate."""
    data = _entries(feed)
    countries = {}
    for iso in wanted:
        c = parse_country(data.get(iso))
        if c:
            countries[iso] = c
    if not wanted or len(countries) / len(wanted) < rd.MIN_COVERAGE:
        raise ValueError(f"only {len(countries)}/{len(wanted)} destination countries in the feed (need 80%); not writing")
    now = now or dt.datetime.now(dt.timezone.utc)
    return {"generatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "source": SOURCE, "countries": countries}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=pathlib.Path, default=OUT_DEFAULT)
    ap.add_argument("--input", type=pathlib.Path, help="read this feed file instead of fetching")
    args = ap.parse_args(argv)
    feed = json.loads(args.input.read_text(encoding="utf-8")) if args.input else rd.get_json(FEED_URL)
    try:
        out = build(feed, rd.destination_countries())
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    size = rd.write_json(args.out, out)
    print(f"wrote {args.out} ({size} bytes): {len(out['countries'])} countries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
