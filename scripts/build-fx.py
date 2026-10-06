#!/usr/bin/env python3
"""
Builds public/data/fx.json: exchange rates from Canadian dollars to the
currencies of the destination countries, shown as "1 CAD = 0.66 EUR · ECB,
Oct 3" with the date. Indicative reference rates, not a quote.

Source: Frankfurter (https://frankfurter.dev), which republishes the European
Central Bank euro foreign exchange reference rates (published on ECB working
days, about 16:00 CET). Currencies the ECB does not publish are simply absent.

Output: {"date": "YYYY-MM-DD", "source": "...", "base": "CAD", "rates": {"EUR": 0.66, ...}}

Gate: refuses to write when the answer has no date, is not based on CAD, or
holds rates for fewer than half of the currencies asked for. A failed run
leaves the existing file untouched.

Usage: python3 scripts/build-fx.py [--out PATH]
"""

from __future__ import annotations

import argparse
import datetime as dt
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import _refdata as rd  # noqa: E402

API = "https://api.frankfurter.dev/v1/latest"
SOURCE = "European Central Bank reference rates via Frankfurter"
OUT_DEFAULT = rd.ROOT / "public" / "data" / "fx.json"
BASE = "CAD"
MIN_SHARE = 0.5


def wanted_currencies(table: dict[str, str], countries: list[str]) -> list[str]:
    """Distinct currency codes of the destination countries, CAD excluded."""
    return sorted({table[c] for c in countries if c in table} - {BASE})


def request_url(codes: list[str]) -> str:
    return f"{API}?base={BASE}&symbols={','.join(codes)}"


def build(answer: object, codes: list[str]) -> dict:
    if not isinstance(answer, dict) or answer.get("base") != BASE:
        raise ValueError("unexpected answer (not a CAD-based rate table)")
    try:
        date = dt.date.fromisoformat(str(answer.get("date")))
    except ValueError as e:
        raise ValueError("answer has no valid date") from e
    raw = answer.get("rates")
    rates: dict[str, float] = {}
    if isinstance(raw, dict):
        for code in codes:
            v = raw.get(code)
            if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
                rates[code] = float(f"{v:.6g}")
    if not codes or len(rates) < len(codes) * MIN_SHARE:
        raise ValueError(f"only {len(rates)}/{len(codes)} currencies in the answer; not writing")
    return {"date": date.isoformat(), "source": SOURCE, "base": BASE, "rates": rates}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=pathlib.Path, default=OUT_DEFAULT)
    args = ap.parse_args(argv)
    codes = wanted_currencies(rd.currency_table(), rd.destination_countries())
    try:
        out = build(rd.get_json(request_url(codes)), codes)
    except (ValueError, rd.Final, RuntimeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    size = rd.write_json(args.out, out)
    print(f"wrote {args.out} ({size} bytes): {len(out['rates'])}/{len(codes)} currencies, {out['date']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
