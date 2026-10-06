#!/usr/bin/env python3
"""
Builds public/data/holidays.json: public holidays of the destination countries
for this year and next, shown on the destination page and in Trip Prep as
"public holiday" with the date. Facts as published, no interpretation.

Source: Nager.Date v3 (https://date.nager.at, open source, free)
  GET /api/v3/PublicHolidays/{year}/{ISO2}
  -> [{"date", "localName", "name", "countryCode", "global", ...}]
Only rows whose "types" include "Public" are kept.
"global" false means the holiday applies only in some regions of the country.
Countries Nager does not cover (204 or 404) are simply absent.

Output: {"generatedAt", "source", "years": [Y, Y+1],
         "countries": {"ES": [{"date", "name", "localName", "global"}, ...]}}

Partial-run safety: a country that fails to download keeps its rows from the
existing file when those still cover the years asked for. Gate: refuses to
write when fewer than 80% of the destination countries have holidays.

Usage: python3 scripts/build-holidays.py [--out PATH] [--year Y] [--sleep S]
"""

from __future__ import annotations

import argparse
import datetime as dt
import pathlib
import sys
import time
from typing import Callable

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import _refdata as rd  # noqa: E402

API = "https://date.nager.at/api/v3/PublicHolidays"
SOURCE = "Nager.Date public holidays API (date.nager.at)"
OUT_DEFAULT = rd.ROOT / "public" / "data" / "holidays.json"


def parse_rows(raw: object, year: int) -> list[dict]:
    """Rows of one country-year, date-ordered, dropping anything outside the year or malformed."""
    out = []
    for r in raw if isinstance(raw, list) else []:
        if not isinstance(r, dict):
            continue
        date, name = r.get("date"), r.get("name")
        try:
            d = dt.date.fromisoformat(str(date))
        except ValueError:
            continue
        if d.year != year or not isinstance(name, str) or not name.strip():
            continue
        if "Public" not in (r.get("types") if isinstance(r.get("types"), list) else []):
            continue  # Bank, Optional, Observance etc. are not public holidays
        local = r.get("localName")
        out.append({"date": d.isoformat(), "name": name.strip(),
                    "localName": local.strip() if isinstance(local, str) and local.strip() else name.strip(),
                    "global": r.get("global") is not False})
    return sorted(out, key=lambda x: (x["date"], x["name"]))


def fetch_country(iso: str, years: list[int], get: Callable[[str], object]) -> list[dict] | None:
    """All rows for the years; None when any year failed (so the old rows are kept), [] when uncovered."""
    rows: list[dict] = []
    for y in years:
        try:
            raw = get(f"{API}/{y}/{iso}")
        except rd.Final:
            return []
        except RuntimeError:
            return None
        rows.extend(parse_rows(raw, y))
    return rows


def build(wanted: list[str], years: list[int], get: Callable[[str], object], old: dict | None = None,
          now: dt.datetime | None = None, pause: Callable[[], None] = lambda: None,
          log: Callable[[str], None] = print) -> dict:
    old_c = (old or {}).get("countries") if isinstance((old or {}).get("countries"), dict) else {}
    old_ok = (old or {}).get("years") == years
    countries: dict[str, list[dict]] = {}
    for iso in wanted:
        rows = fetch_country(iso, years, get)
        pause()
        if rows is None:
            if old_ok and old_c.get(iso):
                countries[iso] = old_c[iso]
                log(f"{iso}: download failed, kept the previous rows")
            else:
                log(f"{iso}: download failed, skipped")
        elif rows:
            countries[iso] = rows
    if not wanted or len(countries) / len(wanted) < rd.MIN_COVERAGE:
        raise ValueError(f"only {len(countries)}/{len(wanted)} destination countries have holidays (need 80%); not writing")
    now = now or dt.datetime.now(dt.timezone.utc)
    return {"generatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "source": SOURCE, "years": years, "countries": countries}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=pathlib.Path, default=OUT_DEFAULT)
    ap.add_argument("--year", type=int, default=dt.datetime.now(dt.timezone.utc).year)
    ap.add_argument("--sleep", type=float, default=0.2, help="seconds between requests")
    args = ap.parse_args(argv)
    years = [args.year, args.year + 1]
    try:
        out = build(rd.destination_countries(), years, rd.get_json, rd.load_json(args.out),
                    pause=lambda: time.sleep(args.sleep))
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    size = rd.write_json(args.out, out)
    print(f"wrote {args.out} ({size} bytes): {len(out['countries'])} countries, {years[0]}-{years[1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
