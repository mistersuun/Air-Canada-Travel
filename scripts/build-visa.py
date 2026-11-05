#!/usr/bin/env python3
"""
Builds public/data/visa.json: entry requirements by passport for every
destination country (and Canada), shown on the destination page as the
requirement for the traveller's own passport. The app states the facts as
published and adds no interpretation.

Source: Passport Index data (passportindex.org), compiled by
imorte/passport-index-data (MIT licence)
https://github.com/imorte/passport-index-data
  passport-index-tidy-iso2.csv   header: Passport,Destination,Requirement
  README.md                      carries "Last updated 17 February 2026"
Requirement is a number of visa-free days or one of: visa free, visa on arrival,
eta, e-visa, visa required, no admission, -1 (own country). An unknown value is
stored as an empty cell and counted in the summary.

Output: {"v":1, ..., "asOf": ISO, "cols": [destination ISO2, sorted],
         "rows": {"<passport ISO2>": "c0,c1,..."}} with one code per column:
  F<n> visa-free n days   F visa-free, no stated limit   T eta
  A visa on arrival       E e-visa   V visa required   N no admission
  O own country           (empty) missing or unknown

Gate: refuses to write when the data date cannot be read, there are fewer than
150 passports or 40 destination columns, or the CA row has fewer than 40
non-empty cells, leaving the existing file untouched.

Usage: python3 scripts/build-visa.py [--out PATH] [--csv FILE --readme FILE]
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import io
import pathlib
import re
import sys
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import _refdata as rd  # noqa: E402

BASE = "https://raw.githubusercontent.com/imorte/passport-index-data/main/"
CSV_URL = BASE + "passport-index-tidy-iso2.csv"
README_URL = BASE + "README.md"
SOURCE = "Passport Index data (passportindex.org), compiled by imorte/passport-index-data"
LICENSE_URL = "https://github.com/imorte/passport-index-data/blob/main/LICENSE"
ATTRIBUTION = SOURCE + " (MIT licence)"
OUT_DEFAULT = rd.ROOT / "public" / "data" / "visa.json"
MIN_PASSPORTS = 150
MIN_COLS = 40
MIN_HOME_CELLS = 40

CODES = {
    "visa free": "F",
    "eta": "T",
    "visa on arrival": "A",
    "e-visa": "E",
    "visa required": "V",
    "no admission": "N",
    "-1": "O",
}
_DAYS = re.compile(r"\d{1,4}")
_UPDATED = re.compile(r"last\s+updated[\s:*_]*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", re.I)
_MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], 1)}


def parse_as_of(readme: str) -> str:
    """ISO date from a 'Last updated 17 February 2026' line; ValueError when absent or invalid."""
    m = _UPDATED.search(readme or "")
    month = _MONTHS.get(m.group(2).lower()) if m else None
    if not m or not month:
        raise ValueError("data date ('Last updated D Month YYYY') not found in README; not writing")
    try:
        return dt.date(int(m.group(3)), month, int(m.group(1))).isoformat()
    except ValueError as e:
        raise ValueError(f"unreadable data date in README: {e}; not writing") from e


def code_for(requirement: str) -> str | None:
    """Cell code for a Requirement value, or None when unknown."""
    v = (requirement or "").strip().lower()
    if v in CODES:
        return CODES[v]
    if _DAYS.fullmatch(v):
        n = int(v)
        return f"F{n}" if n > 0 else "F"
    return None


def build(csv_text: str, readme: str, wanted: list[str], now: dt.datetime | None = None) -> tuple[dict, Counter, Counter]:
    """(file, counts per code, unknown values); raises ValueError under the sanity gates."""
    as_of = parse_as_of(readme)
    cols = sorted(set(wanted))
    index = {c: i for i, c in enumerate(cols)}
    rows: dict[str, list[str]] = {}
    unknown: Counter = Counter()
    counts: Counter = Counter()
    for rec in csv.DictReader(io.StringIO(csv_text)):
        p = (rec.get("Passport") or "").strip().upper()
        d = (rec.get("Destination") or "").strip().upper()
        if not re.fullmatch(r"[A-Z]{2}", p) or d not in index:
            continue
        raw = (rec.get("Requirement") or "").strip()
        code = code_for(raw)
        if code is None:
            unknown[raw] += 1
            code = ""
        rows.setdefault(p, [""] * len(cols))[index[d]] = code
        counts[code or "(empty)"] += 1
    present = [i for i in range(len(cols)) if any(r[i] for r in rows.values())]
    if len(rows) < MIN_PASSPORTS:
        raise ValueError(f"only {len(rows)} passports (need {MIN_PASSPORTS}); not writing")
    if len(present) < MIN_COLS:
        raise ValueError(f"only {len(present)} destination columns (need {MIN_COLS}); not writing")
    home = rows.get(rd.HOME_COUNTRY)
    if not home or sum(1 for c in home if c) < MIN_HOME_CELLS:
        raise ValueError(f"{rd.HOME_COUNTRY} row missing or under {MIN_HOME_CELLS} non-empty cells; not writing")
    now = now or dt.datetime.now(dt.timezone.utc)
    out = {
        "v": 1,
        "source": SOURCE,
        "license": "MIT",
        "licenseUrl": LICENSE_URL,
        "attribution": ATTRIBUTION,
        "asOf": as_of,
        "generatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cols": cols,
        "rows": {p: ",".join(rows[p]) for p in sorted(rows)},
    }
    return out, counts, unknown


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=pathlib.Path, default=OUT_DEFAULT)
    ap.add_argument("--csv", type=pathlib.Path, help="read this CSV instead of fetching (with --readme)")
    ap.add_argument("--readme", type=pathlib.Path, help="read this README instead of fetching (with --csv)")
    args = ap.parse_args(argv)
    if bool(args.csv) != bool(args.readme):
        ap.error("--csv and --readme go together")
    if args.csv:
        csv_text = args.csv.read_text(encoding="utf-8")
        readme = args.readme.read_text(encoding="utf-8")
    else:
        readme = rd.get_text(README_URL)
        csv_text = rd.get_text(CSV_URL)
    wanted = sorted(set(rd.destination_countries()) | {rd.HOME_COUNTRY})
    try:
        out, counts, unknown = build(csv_text, readme, wanted)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    size = rd.write_json(args.out, out)
    print(f"wrote {args.out} ({size} bytes): {len(out['rows'])} passports x {len(out['cols'])} destinations, as of {out['asOf']}")
    by_kind: Counter = Counter()
    for k, n in counts.items():
        by_kind["F" if k.startswith("F") else k] += n
    print("cells: " + ", ".join(f"{k}={n}" for k, n in sorted(by_kind.items())))
    if unknown:
        print("unknown values (stored empty): " + ", ".join(f"{v!r} x{n}" for v, n in unknown.most_common()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
