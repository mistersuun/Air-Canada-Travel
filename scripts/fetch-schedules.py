#!/usr/bin/env python3
"""
Fetches Air Canada Vacations schedule PDFs and regenerates public/data/schedules.json,
the schedule data the app fetches at startup (kept out of the JS bundle, cached
by the service worker).

Usage:
  python3 scripts/fetch-schedules.py [--dry-run] [--skip-domestic] [--allow-route-drop] [--allow-short-coverage] [--out PATH]

The domestic "CANADA-" PDFs are parsed too, keeping only hub-to-hub legs (both
ends in destinations.ts HUBS): they are the real first legs of connections.
--skip-domestic leaves them out (--include-domestic is accepted and is the
default). A domestic PDF that fails is never fatal: the hub-to-hub routes the
run lost are carried forward from the previous file (unexpired records only).

The script refuses to write anything when a safety gate fails (no PDFs found,
too many international PDFs failed, too few routes/records compared with the
previous file, a core hub missing, too many unparseable or orphaned rows).
--dry-run runs every step and every gate and exits with the same status, but
never writes the output file.

A single international PDF that fails (download error, unreadable PDF, zero
routes, or mostly orphaned rows) is tolerated when at most MAX_FAILED_SOURCES
(and MAX_FAILED_FRACTION of all sources) fail: the routes missing from the new
data are carried forward from the previous file (unexpired records only), so a
dead link cannot silently drop a region nor block every future update.

--allow-route-drop accepts a route/record count below MIN_ROUTE_RATIO of the
previous file (a real seasonal cut); the workflow exposes it as an input.

--allow-short-coverage downgrades the coverage-horizon gates to warnings: the
overall coverageTo must be at least MIN_COVERAGE_DAYS (28) ahead of today and
each required hub's own coverage at least MIN_HUB_COVERAGE_DAYS (14). A
coverageFrom that moves backwards against the previous file only warns.

When nothing but generatedAt would change, the file is left untouched so the
workflow commits (and redeploys) only on real data changes.

The parser is pure (parse_pages / parse_text) so it can be tested with plain
text fixtures; pdfplumber is only imported when a real PDF is opened.
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from typing import Callable, Iterable

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
WHERE_WE_FLY_URL = "https://vacations.aircanada.com/en/plan-your-trip/travel-info/where-we-fly"
USER_AGENT = "Mozilla/5.0 (compatible; ac-explorer-schedule-bot)"

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(REPO_ROOT, "public", "data", "schedules.json")
SCHEMA_VERSION = 1
DESTINATIONS_TS = os.path.join(REPO_ROOT, "src", "app", "data", "destinations.ts")

ALLOWED_HOST_SUFFIX = "aircanada.com"
FETCH_TIMEOUT_S = 60
FETCH_BACKOFF_S = (1, 2, 4)        # sleeps between attempts -> 4 attempts total
MAX_PDF_BYTES = 30 * 1024 * 1024

# Safety gates
MIN_ROUTE_RATIO = 0.80             # vs. routes (originCode: entries) in the previous file
MIN_RECORDS = 5000
MAX_REJECT_RATIO = 0.05            # (rejected + orphan rows) / (accepted + rejected + orphans)
MAX_SOURCE_ORPHAN_RATIO = 0.05     # a PDF with more orphans than this has a broken layout
MAX_FAILED_SOURCES = 2             # international PDFs that may fail in one run...
MAX_FAILED_FRACTION = 0.10         # ...as long as they are at most this share of all sources
MIN_COVERAGE_DAYS = 28             # coverageTo must be at least this far past today
MIN_HUB_COVERAGE_DAYS = 14         # ...and each required hub's coverageByHub "to" this far
REQUIRED_HUBS = ("YUL", "YYZ", "YVR")   # hard-fail if any has 0 departures

FALLBACK_HUBS = ("YYZ", "YUL", "YVR", "YYC", "YOW", "YHZ", "YEG", "YQB", "YWG", "YTZ")

# Day mask in the PDFs is MTWRFSU (R = Thursday, U = Sunday), '-' = no flight.
DAY_KEYS = ("M", "T", "W", "R", "F", "S", "U")
DAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

# ---------------------------------------------------------------------------
# Regexes
# ---------------------------------------------------------------------------
# Anything that starts like a schedule row (two ISO dates). Validated field by
# field afterwards so malformed rows are reported instead of silently dropped.
ROW_START_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\s+\d{4}-\d{2}-\d{2}\b")
ROW_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2})\s+"      # fromDate
    r"(\d{4}-\d{2}-\d{2})\s+"       # toDate
    r"(\S+)\s+"                     # day mask (validated separately)
    r"(AC\d{1,4})\s+"               # flight number
    r"(\d{1,2}:\d{2})\s+"           # departure (local)
    r"(\d{1,2}:\d{2})\s+"           # arrival (local)
    r"([A-Z0-9]{2,4})\b"            # aircraft code
)
AIRPORT_CODE_RE = re.compile(r"\(([A-Z]{3})\)")
# City section header, e.g. "Montreal (YUL)". Matched on an ASCII-folded copy
# with apostrophes normalised. Every real header is under 30 characters; longer
# lines of this shape are airport names.
CITY_HEADER_RE = re.compile(r"^([A-Za-z /\-'\.]{2,30})\s+\(([A-Z]{3})\)\s*$")
# The PDFs spell the apostrophe of "St. John's" as a backtick; typographic
# quotes appear too. All become a plain ASCII apostrophe before matching.
APOSTROPHES = str.maketrans({"`": "'", "\u2019": "'", "\u2018": "'", "\u00b4": "'"})
AIRPORT_WORDS = ("airport", "aeroport", "international", "terminal", "pearson", "stanfield")
# Direction line, e.g. "Montreal to Casablanca, Morocco" (not the "to ..." marker
# and not a table-of-contents "to/from ..... X" line).
DIRECTION_RE = re.compile(r"^(?!to\b)(?!from\b)(?!to/from\b)\S.*\sto\s\S.*$")
# Direction markers: "to ..." (outbound) / "from ..." (return), optionally
# followed on the same line by the airport, e.g. "to ... Sangster International Airport (MBJ)".
MARKER_RE = re.compile(r"^(to|from) \.\.\.(?:\s+(.*))?$")


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def fold(text: str) -> str:
    """Strip accents: 'Montréal' -> 'Montreal', 'Bogotá' -> 'Bogota'."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def is_city_header(line: str) -> tuple[str, str] | None:
    """Returns (city_name, code) if line is a city section header, else None."""
    m = CITY_HEADER_RE.match(fold(line).translate(APOSTROPHES))
    if not m:
        return None
    city = m.group(1).lower()
    if any(w in city for w in AIRPORT_WORDS):
        return None
    return (line[: line.rfind("(")].strip(), m.group(2))


def parse_days(mask: str) -> str | None:
    """'M-W-F--' -> 'Mon,Wed,Fri'. Returns None when the mask is malformed."""
    if len(mask) != 7:
        return None
    days = []
    for i, ch in enumerate(mask):
        if ch == "-":
            continue
        if ch != DAY_KEYS[i]:
            return None
        days.append(DAY_NAMES[i])
    return ",".join(days) if days else None


def parse_time(value: str) -> str | None:
    """'7:05' -> '07:05'; None when outside 00:00-23:59."""
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", value)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    if not (0 <= h <= 23 and 0 <= mi <= 59):
        return None
    return f"{h:02d}:{mi:02d}"


def parse_row(line: str) -> tuple[dict | None, str | None]:
    """Returns (record, None) or (None, reject_reason)."""
    m = ROW_RE.match(line)
    if not m:
        return None, "unparseable row"
    from_s, to_s, mask, flight, dep_s, arr_s, aircraft = m.groups()
    try:
        from_d = date.fromisoformat(from_s)
        to_d = date.fromisoformat(to_s)
    except ValueError:
        return None, "invalid date"
    if from_d > to_d:
        return None, "fromDate after toDate"
    days = parse_days(mask)
    if days is None:
        return None, f"malformed day mask {mask!r}"
    dep = parse_time(dep_s)
    arr = parse_time(arr_s)
    if dep is None or arr is None:
        return None, "invalid time"
    return {
        "fromDate": from_s,
        "toDate": to_s,
        "days": days,
        "flightNumber": flight,
        "departure": dep,
        "arrival": arr,
        "aircraft": aircraft,
    }, None


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------
@dataclass
class ParseResult:
    routes: dict = field(default_factory=dict)     # (origin, dest) -> [record]
    orphans: list = field(default_factory=list)    # valid rows with no origin/dest/direction
    rejects: list = field(default_factory=list)    # row-like lines that failed validation

    @property
    def record_count(self) -> int:
        return sum(len(v) for v in self.routes.values())


def _valid_dest(code: str | None, origin: str | None) -> str | None:
    return code if code and code != origin else None


def parse_pages(pages: Iterable[str], source: str = "") -> ParseResult:
    """
    Parses the text of every PDF page (in order) into route records.

    PDF structure per route block (state carries across page breaks):
      [OriginCity] ([OriginCode])          <- city section header (new origin)
      [OriginCity] Airport                 <- ignored
      [OriginCity] to [DestCity]           <- direction line
      [DestCity] Airport ([DestCode])      <- other end of the route
      to ...                               <- OUTBOUND marker: origin -> dest
      [schedule rows]
      [DestCity] to [OriginCity]           <- direction line
      [DestCity] Airport ([DestCode])
      from ...                             <- RETURN marker: dest -> origin
      [schedule rows]
    Either marker may come first.
    """
    result = ParseResult()
    current_origin: str | None = None
    current_dest: str | None = None
    last_airport_code: str | None = None
    direction: str | None = None          # 'outbound' | 'return' | None
    awaiting_dest = False                 # just saw a direction line

    for page_no, page_text in enumerate(pages, start=1):
        for line_no, raw in enumerate((page_text or "").split("\n"), start=1):
            line = raw.strip()
            if not line:
                continue

            # Schedule rows first: they never look like anything else.
            if ROW_START_RE.match(line):
                record, reason = parse_row(line)
                where = {"source": source, "page": page_no, "line": line_no, "text": line}
                if record is None:
                    result.rejects.append({**where, "reason": reason})
                elif current_origin and current_dest and direction:
                    key = ((current_origin, current_dest) if direction == "outbound"
                           else (current_dest, current_origin))
                    result.routes.setdefault(key, []).append(record)
                else:
                    result.orphans.append(where)
                awaiting_dest = False
                continue

            marker_m = MARKER_RE.match(line)
            if marker_m:
                direction = "outbound" if marker_m.group(1) == "to" else "return"
                # After a page break the marker and the airport can share a line:
                # "from ... London Heathrow Airport (LHR)".
                rest_code = AIRPORT_CODE_RE.search(marker_m.group(2) or "")
                if rest_code:
                    last_airport_code = rest_code.group(1)
                    current_dest = _valid_dest(last_airport_code, current_origin)
                    awaiting_dest = False
                elif awaiting_dest:
                    # Marker came before the airport line (text-order quirk,
                    # e.g. "Sao Paulo, Brazil to Montreal / from ... / Guarulhos ... (GRU)").
                    current_dest = None
                else:
                    current_dest = _valid_dest(last_airport_code, current_origin)
                continue

            code_m = AIRPORT_CODE_RE.search(line)

            # An airport line right after a direction line is the route's
            # other end, even if it happens to look like a city header
            # (e.g. "Timmins/Victor M. Power (YTS)").
            if awaiting_dest and code_m:
                last_airport_code = code_m.group(1)
                awaiting_dest = False
                if direction:
                    current_dest = _valid_dest(last_airport_code, current_origin)
                continue

            city = is_city_header(line)
            if city:
                current_origin = city[1]
                current_dest = None
                last_airport_code = None
                direction = None
                awaiting_dest = False
                continue

            if DIRECTION_RE.match(fold(line)) and not code_m:
                current_dest = None
                last_airport_code = None
                direction = None
                awaiting_dest = True
                continue

            if code_m:
                last_airport_code = code_m.group(1)

    return result


def parse_text(text: str, source: str = "") -> ParseResult:
    """Test helper: pages separated by form feeds ('\\f')."""
    return parse_pages(text.split("\f"), source)


def extract_pages(pdf_bytes: bytes) -> list[str]:
    try:
        import pdfplumber
    except ImportError:
        print("pdfplumber not installed. Run: pip install -r scripts/requirements.txt")
        raise
    pages = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            pages.append(page.extract_text() or "")
            page.close()
    return pages


# ---------------------------------------------------------------------------
# Merge, dedupe, conflicts
# ---------------------------------------------------------------------------
def flight_sort_key(flight: str) -> tuple:
    digits = re.sub(r"\D", "", flight)
    return (int(digits) if digits else 0, flight)


def record_sort_key(r: dict) -> tuple:
    return (flight_sort_key(r["flightNumber"]), r["fromDate"], r["toDate"],
            r["days"], r["departure"], r["arrival"], r["aircraft"])


def _weekday_set(days: str) -> set:
    return set(days.split(",")) if days else set()


def shared_operating_date(a: dict, b: dict) -> str | None:
    """
    The first date both records actually operate on, or None. Overlapping date
    ranges and overlapping weekday sets are not enough on their own: 05-19..05-23
    Wed,Sun and 05-21..05-29 Mon,Tue never fly on the same day.
    """
    start = max(a["fromDate"], b["fromDate"])
    end = min(a["toDate"], b["toDate"])
    if start > end:
        return None
    common = _weekday_set(a["days"]) & _weekday_set(b["days"])
    if not common:
        return None
    d = date.fromisoformat(start)
    last = date.fromisoformat(end)
    for _ in range(7):
        if d > last:
            return None
        if DAY_NAMES[d.weekday()] in common:
            return d.isoformat()
        d = date.fromordinal(d.toordinal() + 1)
    return None


@dataclass
class Source:
    name: str
    url: str = ""
    published: float = 0.0     # epoch seconds from Last-Modified / CreationDate, 0 = unknown
    domestic: bool = False


def merge_routes(parsed: list[tuple[Source, ParseResult]],
                 log: Callable[[str], None] = print) -> tuple[dict, list[str]]:
    """
    Merges per-PDF results into { (origin, dest): [records] } with
    deterministic ordering. Records sharing (origin, dest, flight, fromDate,
    toDate, days) are collapsed; if their times differ it is a CONFLICT and
    the record from the most recently published PDF wins (ties broken by PDF
    name, then record content). Records of one flight that operate on a
    common date with different times are logged as CONFLICT but both are kept
    (the app shows the more specific filing on that date, see week.ts
    flightsOn); rows whose ranges and weekdays overlap without a common date
    are not conflicts.
    """
    candidates: dict[tuple, list[tuple[Source, dict]]] = {}
    for src, res in parsed:
        for (origin, dest), records in res.routes.items():
            for r in records:
                k = (origin, dest, r["flightNumber"], r["fromDate"], r["toDate"], r["days"])
                candidates.setdefault(k, []).append((src, r))

    conflicts: list[str] = []
    merged: dict[tuple, list[dict]] = {}
    for k in sorted(candidates):
        cands = candidates[k]
        cands.sort(key=lambda sr: (-sr[0].published, sr[0].name, record_sort_key(sr[1])))
        winner = cands[0][1]
        times = {(r["departure"], r["arrival"]) for _, r in cands}
        if len(times) > 1:
            msg = (f"CONFLICT {k[0]}-{k[1]} {k[2]} {k[3]}..{k[4]} [{k[5]}]: "
                   + "; ".join(sorted(f"{s.name} {r['departure']}-{r['arrival']}" for s, r in cands))
                   + f" -> kept {winner['departure']}-{winner['arrival']} from {cands[0][0].name}")
            conflicts.append(msg)
            log(msg)
        merged.setdefault((k[0], k[1]), []).append(dict(winner))

    for key in merged:
        recs = sorted(merged[key], key=record_sort_key)
        merged[key] = recs
        # Overlap check within a flight number (same origin/dest).
        by_flight: dict[str, list[dict]] = {}
        for r in recs:
            by_flight.setdefault(r["flightNumber"], []).append(r)
        for flight, rs in by_flight.items():
            for i in range(len(rs)):
                for j in range(i + 1, len(rs)):
                    a, b = rs[i], rs[j]
                    if (a["departure"], a["arrival"]) == (b["departure"], b["arrival"]):
                        continue
                    day = shared_operating_date(a, b)
                    if day is None:
                        continue
                    msg = (f"CONFLICT {key[0]}-{key[1]} {flight} on {day}: overlapping "
                           f"{a['fromDate']}..{a['toDate']} {a['departure']}-{a['arrival']} vs "
                           f"{b['fromDate']}..{b['toDate']} {b['departure']}-{b['arrival']} (both kept)")
                    conflicts.append(msg)
                    log(msg)
    return dict(sorted(merged.items())), conflicts


# ---------------------------------------------------------------------------
# Coverage + TS generation
# ---------------------------------------------------------------------------
def coverage(routes: dict, hubs: Iterable[str]) -> dict:
    all_from = [r["fromDate"] for rs in routes.values() for r in rs]
    all_to = [r["toDate"] for rs in routes.values() for r in rs]
    by_hub = {}
    for hub in sorted(set(hubs)):
        f = [r["fromDate"] for (o, d), rs in routes.items() if hub in (o, d) for r in rs]
        t = [r["toDate"] for (o, d), rs in routes.items() if hub in (o, d) for r in rs]
        if f:
            by_hub[hub] = (min(f), max(t))
    return {
        "from": min(all_from) if all_from else "",
        "to": max(all_to) if all_to else "",
        "byHub": by_hub,
    }


def encode_days(days: str) -> str:
    """'Mon,Wed,Fri' -> 'M-W-F--' (the PDFs' MTWRFSU mask; compact in JSON)."""
    have = set(days.split(",")) if days else set()
    return "".join(k if n in have else "-" for k, n in zip(DAY_KEYS, DAY_NAMES))


def decode_days(mask: str) -> str:
    return parse_days(mask) or ""


def _j(v) -> str:
    return json.dumps(v, ensure_ascii=False)


def generate_json(routes: dict, *, generated_at: str, sources: list[str], hubs: Iterable[str],
                  hub_to_hub: bool = False) -> str:
    """
    The schedule file the app loads. One record per line so weekly diffs stay
    readable. Records are [fromDate, toDate, dayMask, flight, departure,
    arrival, aircraft] with the PDFs' MTWRFSU day mask. `hub_to_hub` records
    that the domestic PDFs were parsed, so every published hub-to-hub leg is in
    the file and a missing pair means there is no nonstop (the app then never
    invents one for a connection).
    """
    cov = coverage(routes, hubs)
    live = [(k, v) for k, v in sorted(routes.items()) if v]
    record_count = sum(len(v) for _, v in live)
    meta = {
        "generatedAt": generated_at,
        "coverageFrom": cov["from"],
        "coverageTo": cov["to"],
        "coverageByHub": {h: {"from": f, "to": t} for h, (f, t) in cov["byHub"].items()},
        "hubToHub": hub_to_hub,
        "pdfCount": len(sources),
        "routeCount": len(live),
        "recordCount": record_count,
        "sources": sorted(sources),
    }
    lines = ["{", f'  "version": {SCHEMA_VERSION},', '  "source": ' + _j(WHERE_WE_FLY_URL) + ",", '  "meta": {']
    items = list(meta.items())
    for i, (k, v) in enumerate(items):
        lines.append(f"    {_j(k)}: {_j(v)}" + ("," if i < len(items) - 1 else ""))
    lines += ["  },", '  "routes": {']
    for ri, ((origin, dest), schedules) in enumerate(live):
        lines.append(f'    "{origin}-{dest}": [')
        for si, s in enumerate(schedules):
            row = [s["fromDate"], s["toDate"], encode_days(s["days"]), s["flightNumber"],
                   s["departure"], s["arrival"], s["aircraft"]]
            lines.append("      " + _j(row) + ("," if si < len(schedules) - 1 else ""))
        lines.append("    ]" + ("," if ri < len(live) - 1 else ""))
    lines += ["  }", "}"]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Discovery + download
# ---------------------------------------------------------------------------
class _LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            for name, value in attrs:
                if name.lower() == "href" and value:
                    self.hrefs.append(value)


def is_allowed_host(url: str) -> bool:
    p = urllib.parse.urlparse(url)
    host = (p.hostname or "").lower()
    return p.scheme == "https" and (host == ALLOWED_HOST_SUFFIX or host.endswith("." + ALLOWED_HOST_SUFFIX))


def parse_pdf_links(html: str, base_url: str = WHERE_WE_FLY_URL) -> list[str]:
    """All schedule PDF links on the page: absolute, aircanada.com only, deduplicated, sorted."""
    parser = _LinkParser()
    parser.feed(html)
    urls = set()
    for href in parser.hrefs:
        url = urllib.parse.urljoin(base_url, href.strip())
        path = urllib.parse.urlparse(url).path.lower()
        if not path.endswith(".pdf") or "where-we-fly" not in path:
            continue
        if not is_allowed_host(url):
            continue
        urls.add(url)
    return sorted(urls)


def is_domestic(url: str) -> bool:
    name = urllib.parse.urlparse(url).path.rsplit("/", 1)[-1]
    return "canada-" in name.lower()


def discover_pdf_urls(opener=urllib.request.urlopen) -> list[str]:
    req = urllib.request.Request(WHERE_WE_FLY_URL, headers={"User-Agent": USER_AGENT})
    with opener(req, timeout=FETCH_TIMEOUT_S) as resp:
        html = resp.read().decode("utf-8", errors="replace")
    return parse_pdf_links(html, WHERE_WE_FLY_URL)


def _last_modified(headers) -> float:
    value = headers.get("Last-Modified") if headers is not None else None
    if not value:
        return 0.0
    try:
        return parsedate_to_datetime(value).timestamp()
    except (TypeError, ValueError):
        return 0.0


def fetch_pdf(url: str, opener=urllib.request.urlopen, sleep=time.sleep) -> tuple[bytes, float]:
    """Returns (pdf_bytes, last_modified_epoch). Retries with backoff, validates the body."""
    if not is_allowed_host(url):
        raise ValueError(f"refusing non-aircanada.com URL: {url}")
    last_err: Exception | None = None
    for attempt in range(len(FETCH_BACKOFF_S) + 1):
        if attempt:
            sleep(FETCH_BACKOFF_S[attempt - 1])
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with opener(req, timeout=FETCH_TIMEOUT_S) as resp:
                length = resp.headers.get("Content-Length") if resp.headers is not None else None
                if length and length.isdigit() and int(length) > MAX_PDF_BYTES:
                    raise ValueError(f"PDF too large ({length} bytes)")
                body = resp.read(MAX_PDF_BYTES + 1)
                if len(body) > MAX_PDF_BYTES:
                    raise ValueError("PDF too large")
                if not body.startswith(b"%PDF-"):
                    # Often a transient CDN error page served with 200: retry.
                    last_err = ValueError("response is not a PDF")
                    continue
                return body, _last_modified(resp.headers)
        except ValueError:
            raise
        except urllib.error.HTTPError as e:
            # 4xx (bar timeouts/rate limits) will not fix itself: fail fast.
            if 400 <= e.code < 500 and e.code not in (408, 429):
                raise RuntimeError(f"HTTP {e.code}: {e.reason}") from e
            last_err = e
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            last_err = e
    raise RuntimeError(f"download failed after {len(FETCH_BACKOFF_S) + 1} attempts: {last_err}")


# ---------------------------------------------------------------------------
# Hubs + previous file
# ---------------------------------------------------------------------------
def load_hub_codes(path: str = DESTINATIONS_TS) -> list[str]:
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
        block = re.search(r"export const HUBS[^=]*=\s*\[(.*?)\];", text, re.S)
        codes = re.findall(r"code:\s*['\"]([A-Z]{3})['\"]", block.group(1)) if block else []
        if codes:
            return codes
    except OSError:
        pass
    return list(FALLBACK_HUBS)


_REC_KEYS = ("fromDate", "toDate", "days", "flightNumber", "departure", "arrival", "aircraft")
# Legacy schedules.ts (before the data moved to JSON): still readable so the
# first JSON run can compare against, and carry forward from, the old file.
_PREV_ROUTE_RE = re.compile(r'originCode:\s*"([A-Z0-9]{3})",\s*destinationCode:\s*"([A-Z0-9]{3})"')
_PREV_REC_RE = re.compile(
    r'\{\s*fromDate:\s*"([^"]*)",\s*toDate:\s*"([^"]*)",\s*days:\s*"([^"]*)",\s*'
    r'flightNumber:\s*"([^"]*)",\s*departure:\s*"([^"]*)",\s*arrival:\s*"([^"]*)",\s*aircraft:\s*"([^"]*)"\s*\}')


def _read(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return None


def _parse_json_routes(text: str) -> dict | None:
    try:
        data = json.loads(text)
    except ValueError:
        return None
    if not isinstance(data, dict) or not isinstance(data.get("routes"), dict):
        return None
    routes = {}
    for key, rows in data["routes"].items():
        o, _, d = key.partition("-")
        routes[(o, d)] = [dict(zip(_REC_KEYS, [r[0], r[1], decode_days(r[2]), *r[3:7]])) for r in rows]
    return routes


def _parse_legacy_ts_routes(text: str) -> dict:
    routes: dict = {}
    key = None
    for line in text.split("\n"):
        m = _PREV_ROUTE_RE.search(line)
        if m:
            key = (m.group(1), m.group(2))
            routes.setdefault(key, [])
            continue
        r = _PREV_REC_RE.search(line)
        if r and key:
            routes[key].append(dict(zip(_REC_KEYS, r.groups())))
    return routes


def load_previous_routes(path: str) -> dict:
    """{(origin, dest): [record]} from a previously generated file ({} if unreadable)."""
    text = _read(path)
    if text is None:
        return {}
    parsed = _parse_json_routes(text)
    return parsed if parsed is not None else _parse_legacy_ts_routes(text)


def strip_generated_at(text: str) -> str:
    return re.sub(r'^\s*"?generatedAt"?:.*$', "", text, flags=re.M)


def previous_route_count(path: str) -> int:
    text = _read(path)
    if text is None:
        return 0
    parsed = _parse_json_routes(text)
    if parsed is not None:
        return len(parsed)
    return len(re.findall(r"\boriginCode:\s*\"", text))


# ---------------------------------------------------------------------------
# Gates
# ---------------------------------------------------------------------------
def previous_coverage_from(path: str) -> str:
    """coverageFrom of the previously generated file ('' if missing or not JSON)."""
    text = _read(path)
    try:
        data = json.loads(text) if text else None
    except ValueError:
        return ""
    value = data.get("coverageFrom") if isinstance(data, dict) else ""
    return value if isinstance(value, str) else ""


def check_coverage(*, routes: dict, hubs: Iterable[str], today: str, prev_from: str = "",
                   allow_short: bool = False) -> tuple[list[str], list[str]]:
    """Horizon gates: how far ahead the data reaches (today is 'YYYY-MM-DD')."""
    errors: list[str] = []
    warnings: list[str] = []
    cov = coverage(routes, hubs)
    day = date.fromisoformat(today)
    short: list[str] = []
    if cov["to"] and cov["to"] < (day + timedelta(days=MIN_COVERAGE_DAYS)).isoformat():
        short.append(f"coverageTo {cov['to']} is less than {MIN_COVERAGE_DAYS} days after {today}")
    for hub in REQUIRED_HUBS:
        to = cov["byHub"].get(hub, ("", ""))[1]
        if to and to < (day + timedelta(days=MIN_HUB_COVERAGE_DAYS)).isoformat():
            short.append(f"required hub {hub} coverage ends {to}, less than {MIN_HUB_COVERAGE_DAYS} days after {today}")
    for msg in short:
        (warnings if allow_short else errors).append(msg + (" (allowed by --allow-short-coverage)" if allow_short else ""))
    if prev_from and cov["from"] and cov["from"] < prev_from:
        warnings.append(f"coverageFrom moved backwards: {cov['from']} < previous {prev_from}")
    return errors, warnings


def check_gates(*, pdf_count: int, download_errors: list, routes: dict, prev_routes: int,
                hubs: Iterable[str], accepted_rows: int, rejected_rows: int,
                prev_records: int = 0, allow_drop: bool = False, today: str | None = None,
                prev_coverage_from: str = "", allow_short: bool = False) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    if pdf_count == 0:
        errors.append("no schedule PDFs discovered")
    for name, err in download_errors:
        errors.append(f"source failed: {name}: {err}")
    route_count = len(routes)
    record_count = sum(len(v) for v in routes.values())
    drops = []
    if prev_routes and route_count < MIN_ROUTE_RATIO * prev_routes:
        drops.append(f"route count dropped: {route_count} < {MIN_ROUTE_RATIO:.0%} of previous {prev_routes}")
    if prev_records and record_count < MIN_ROUTE_RATIO * prev_records:
        drops.append(f"record count dropped: {record_count} < {MIN_ROUTE_RATIO:.0%} of previous {prev_records}")
    for d in drops:
        (warnings if allow_drop else errors).append(d + (" (allowed by --allow-route-drop)" if allow_drop else ""))
    if record_count < MIN_RECORDS:
        errors.append(f"too few records: {record_count} < {MIN_RECORDS}")
    origins = {o for (o, _d) in routes}
    for hub in hubs:
        if hub in origins:
            continue
        if hub in REQUIRED_HUBS:
            errors.append(f"required hub {hub} has 0 departing routes")
        else:
            warnings.append(f"hub {hub} has 0 departing routes (seasonal?)")
    total = accepted_rows + rejected_rows
    if total and rejected_rows / total > MAX_REJECT_RATIO:
        errors.append(f"too many rejected rows (incl. orphans): {rejected_rows}/{total}")
    elif rejected_rows:
        warnings.append(f"{rejected_rows} rejected row(s)")
    if today:
        cov_errors, cov_warnings = check_coverage(routes=routes, hubs=hubs, today=today,
                                                  prev_from=prev_coverage_from, allow_short=allow_short)
        errors += cov_errors
        warnings += cov_warnings
    return errors, warnings


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def _write_step_summary(md: str) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(md + "\n")
    except OSError:
        pass


def run(argv: list[str], *, discover: Callable[[], list[str]] = discover_pdf_urls,
        fetch: Callable[[str], tuple[bytes, float]] = fetch_pdf,
        extract: Callable[[bytes], list[str]] = extract_pages,
        out_path: str | None = None, hubs: list[str] | None = None,
        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> int:
    dry_run = "--dry-run" in argv
    include_domestic = "--skip-domestic" not in argv
    allow_drop = "--allow-route-drop" in argv
    allow_short = "--allow-short-coverage" in argv
    if "--out" in argv:
        out_path = argv[argv.index("--out") + 1]
    out_path = out_path or DEFAULT_OUT
    hubs = hubs if hubs is not None else load_hub_codes()
    hub_set = set(hubs)

    print(f"Discovering PDFs from {WHERE_WE_FLY_URL}...")
    try:
        pdf_urls = discover()
    except Exception as e:  # noqa: BLE001
        print(f"ERROR: failed to discover PDFs: {e}")
        return 1
    print(f"Found {len(pdf_urls)} PDFs\n")
    if not pdf_urls:
        print("ERROR: no schedule PDFs discovered; refusing to continue")
        return 1

    parsed: list[tuple[Source, ParseResult]] = []
    download_errors: list[tuple[str, str]] = []
    all_orphans: list[dict] = []
    all_rejects: list[dict] = []
    domestic_failures: list[str] = []

    for url in pdf_urls:
        name = url.rsplit("/", 1)[-1]
        domestic = is_domestic(url)
        if domestic and not include_domestic:
            print(f"Skipping {name} (domestic; --skip-domestic)")
            continue
        print(f"Fetching {name}{' (domestic)' if domestic else ''}...", end=" ", flush=True)
        try:
            pdf_bytes, published = fetch(url)
        except Exception as e:  # noqa: BLE001
            if domestic:
                print(f"WARNING: domestic PDF did not download ({e}); skipping")
                domestic_failures.append(name)
                continue
            print(f"DOWNLOAD ERROR: {e}")
            download_errors.append((name, str(e)))
            continue
        try:
            res = parse_pages(extract(pdf_bytes), name)
        except Exception as e:  # noqa: BLE001
            if domestic:
                print(f"WARNING: domestic PDF did not parse ({e}); skipping")
                domestic_failures.append(name)
                continue
            print(f"PARSE ERROR: {e}")
            download_errors.append((name, f"parse error: {e}"))
            continue
        if domestic:
            if not res.routes:
                print("WARNING: domestic PDF parsed to 0 routes (layout change?); skipping")
                domestic_failures.append(name)
                continue
            # Only hub-to-hub legs feed connections; everything else is out of scope
            # (NorthernCanada, for one, has none).
            res.routes = {k: v for k, v in res.routes.items() if k[0] in hub_set and k[1] in hub_set}
            res.orphans, res.rejects = [], []  # optional data: never gates the run
        print(f"{len(res.routes)} routes, {res.record_count} rows"
              + (f", {len(res.orphans)} orphans" if res.orphans else "")
              + (f", {len(res.rejects)} rejects" if res.rejects else ""))
        if not domestic:
            rows = res.record_count + len(res.orphans)
            if not res.routes:
                download_errors.append((name, "parsed to 0 routes (layout change?)"))
            elif rows and len(res.orphans) / rows > MAX_SOURCE_ORPHAN_RATIO:
                download_errors.append((name, f"{len(res.orphans)}/{rows} orphan rows (layout change?)"))
        parsed.append((Source(name=name, url=url, published=published, domestic=domestic), res))
        all_orphans += res.orphans
        all_rejects += res.rejects

    routes, conflicts = merge_routes(parsed)
    accepted = sum(r.record_count for _, r in parsed)

    previous = load_previous_routes(out_path)
    if not include_domestic:
        # Hub-to-hub legs only come from the domestic PDFs: never compare against them.
        previous = {k: v for k, v in previous.items() if not (k[0] in hub_set and k[1] in hub_set)}
    prev_records = sum(len(v) for v in previous.values())

    source_warnings: list[str] = []
    if domestic_failures:
        # Keep connections real: carry the hub-to-hub legs this run lost.
        today = now().strftime("%Y-%m-%d")
        carried = 0
        for key, recs in previous.items():
            if key in routes or not (key[0] in hub_set and key[1] in hub_set):
                continue
            live = [r for r in recs if r["toDate"] >= today]
            if live:
                routes[key] = sorted(live, key=record_sort_key)
                carried += 1
        routes = dict(sorted(routes.items()))
        source_warnings.append(f"domestic source(s) failed: {', '.join(domestic_failures)}; "
                               f"{carried} hub-to-hub route(s) carried forward")

    # A few failed sources are tolerated; their routes are carried forward.
    source_count = sum(1 for u in pdf_urls if include_domestic or not is_domestic(u))
    if download_errors and len(download_errors) <= MAX_FAILED_SOURCES \
            and len(download_errors) <= MAX_FAILED_FRACTION * source_count:
        today = now().strftime("%Y-%m-%d")
        carried = 0
        for key, recs in previous.items():
            if key in routes or (key[0] in hub_set and key[1] in hub_set):
                continue  # hub-to-hub legs come from the domestic PDFs (handled above)
            live = [r for r in recs if r["toDate"] >= today]
            if live:
                routes[key] = sorted(live, key=record_sort_key)
                carried += 1
        routes = dict(sorted(routes.items()))
        for name, err in download_errors:
            source_warnings.append(f"source failed, tolerated: {name}: {err}")
        if carried:
            source_warnings.append(f"{carried} route(s) carried forward from the previous file")
        download_errors = []

    if all_orphans:
        print(f"\n{len(all_orphans)} orphan row(s) (no origin/destination/direction):")
        for o in all_orphans[:50]:
            print(f"  ORPHAN {o['source']} p{o['page']} l{o['line']}: {o['text']}")
    if all_rejects:
        print(f"\n{len(all_rejects)} rejected row(s):")
        for r in all_rejects[:50]:
            print(f"  REJECT {r['source']} p{r['page']} l{r['line']} ({r['reason']}): {r['text']}")

    prev = len(previous) if previous else previous_route_count(out_path)
    prev_cov_from = previous_coverage_from(out_path)
    errors, warnings = check_gates(
        pdf_count=len(pdf_urls), download_errors=download_errors, routes=routes,
        prev_routes=prev, hubs=hubs, accepted_rows=accepted,
        rejected_rows=len(all_rejects) + len(all_orphans),
        prev_records=prev_records, allow_drop=allow_drop,
        today=now().strftime("%Y-%m-%d"), prev_coverage_from=prev_cov_from, allow_short=allow_short)
    warnings = source_warnings + warnings
    if conflicts:
        warnings.append(f"{len(conflicts)} CONFLICT(s) logged")
    if all_orphans:
        warnings.append(f"{len(all_orphans)} orphan row(s)")

    record_count = sum(len(v) for v in routes.values())
    hub_to_hub = include_domestic and any(o in hub_set and d in hub_set for (o, d) in routes)
    ts = generate_json(routes, generated_at=now().strftime("%Y-%m-%dT%H:%M:%SZ"),
                       sources=[s.url or s.name for s, _ in parsed], hubs=hubs, hub_to_hub=hub_to_hub)
    cov = coverage(routes, hubs)

    print(f"\nTotal: {len(routes)} routes (previous {prev}), {record_count} records, "
          f"coverage {cov['from']}..{cov['to']}")
    for w in warnings:
        print(f"WARNING: {w}")
    for e in errors:
        print(f"ERROR: {e}")

    summary = [
        "### Schedule update" + (" (dry run)" if dry_run else ""),
        "",
        f"- PDFs: {len(pdf_urls)} discovered, {len(parsed)} parsed",
        f"- Routes: {prev} -> {len(routes)}",
        f"- Records: {record_count}",
        f"- Coverage: {cov['from']} .. {cov['to']}",
    ] + [f"  - {h}: {f} .. {t}" for h, (f, t) in cov["byHub"].items()] \
      + [f"- WARNING: {w}" for w in warnings] + [f"- **ERROR: {e}**" for e in errors]
    _write_step_summary("\n".join(summary))

    if errors:
        print(f"\nSafety gates failed; {out_path} left untouched.")
        return 1

    if dry_run:
        print("\n--- DRY RUN: all gates passed, not writing file ---")
        return 0

    try:
        with open(out_path, encoding="utf-8") as f:
            existing = f.read()
    except OSError:
        existing = None
    if existing is not None and strip_generated_at(existing) == strip_generated_at(ts):
        print(f"\nNo schedule changes; {out_path} left untouched (generatedAt kept).")
        return 0

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    tmp_path = out_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(ts)
    # Sanity check the file we are about to publish.
    if previous_route_count(tmp_path) != len(routes):
        os.remove(tmp_path)
        print("ERROR: generated file failed self-check; not replacing")
        return 1
    os.replace(tmp_path, out_path)
    print(f"Written to {out_path}")
    return 0


def main() -> None:
    sys.exit(run(sys.argv[1:]))


if __name__ == "__main__":
    main()
