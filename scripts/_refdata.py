"""
Shared helpers for the small reference-data builders (build-advisories.py,
build-fx.py, build-holidays.py): destination countries, currencies, a JSON GET
with retries, and the write step. Stdlib only.
"""

from __future__ import annotations

import json
import pathlib
import re
import time
import urllib.error
import urllib.request
from typing import Callable

ROOT = pathlib.Path(__file__).resolve().parents[1]
DESTINATIONS_TS = ROOT / "src" / "app" / "data" / "destinations.ts"
CURRENCY_TS = ROOT / "src" / "app" / "pages" / "destination" / "currency.ts"
HOME_COUNTRY = "CA"
USER_AGENT = "routes-app-data-builder (personal, non-commercial)"
MIN_COVERAGE = 0.8

_ISO2 = re.compile(r"\biso2:\s*'([A-Z]{2})'")
_ROW = re.compile(r"\{[^{}]*?code:\s*'[A-Z]{3}'[^{}]*?\}")
_TYPE = re.compile(r"\btype:\s*'(\w+)'")
_CUR = re.compile(r"\b([A-Z]{2}):\s*'([A-Z]{3})'")


def parse_destination_countries(ts: str) -> list[str]:
    """Sorted ISO2 codes of the DESTINATIONS list (Hub rows and the home country skipped)."""
    start = ts.find("export const DESTINATIONS")
    body = ts[start:] if start >= 0 else ts
    end = body.find("export const HUBS")
    if end > 0:
        body = body[:end]
    out: set[str] = set()
    for m in _ROW.finditer(body):
        iso = _ISO2.search(m.group(0))
        typ = _TYPE.search(m.group(0))
        if iso and not (typ and typ.group(1) == "Hub") and iso.group(1) != HOME_COUNTRY:
            out.add(iso.group(1))
    return sorted(out)


def parse_currency_table(ts: str) -> dict[str, str]:
    """{ISO2: ISO4217} from the CURRENCY table of currency.ts."""
    start = ts.find("const CURRENCY")
    end = ts.find("};", start)
    if start < 0 or end < 0:
        return {}
    return {m.group(1): m.group(2) for m in _CUR.finditer(ts[start:end])}


def destination_countries() -> list[str]:
    return parse_destination_countries(DESTINATIONS_TS.read_text(encoding="utf-8"))


def currency_table() -> dict[str, str]:
    return parse_currency_table(CURRENCY_TS.read_text(encoding="utf-8"))


class Final(Exception):
    """A 4xx answer: do not retry."""


def get_json(url: str, tries: int = 4, sleep: Callable[[float], None] = time.sleep,
             opener: Callable[..., object] = urllib.request.urlopen) -> object:
    """GET and parse JSON. Retries network errors and 5xx/429 with backoff; a 4xx raises Final. 204 gives None."""
    last: Exception | None = None
    for attempt in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with opener(req, timeout=60) as res:  # type: ignore[operator]
                body = res.read().decode("utf-8")
                if getattr(res, "status", 200) == 204 or not body.strip():
                    return None
                return json.loads(body)
        except urllib.error.HTTPError as e:
            if e.code != 429 and 400 <= e.code < 500:
                raise Final(f"HTTP {e.code} for {url}") from e
            last = e
        except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError) as e:
            last = e
        if attempt < tries - 1:
            sleep(2 ** attempt)
    raise RuntimeError(f"giving up on {url}: {last}")


def load_json(path: pathlib.Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def write_json(path: pathlib.Path, data: dict) -> int:
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text + "\n", encoding="utf-8")
    return len(text) + 1
