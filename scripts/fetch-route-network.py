#!/usr/bin/env python3
"""
Builds public/data/route-network.json: which Air Canada routes are flown
(mainline, Express and Rouge) from the 10 hubs. It records that a route
exists, never when it flies: there are no times in this file.

Why: schedules.json comes from the Air Canada Vacations "Where we fly" PDFs.
Those cover the Vacations network, so many Air Canada Express routes
(YHZ-BOS, YHZ-EWR, YHZ-YDF, ...) and some hub-to-hub legs (YHZ-YOW) are not
in it. Without this file the app could only say "not found in our schedule
data" for a route that is flown every day.

Sources (all legitimate, free, scriptable):
  - English Wikipedia hub airport articles, "Airlines and destinations"
    table (Airport-dest-list / Airport destination list templates), read
    through the MediaWiki API. CC BY-SA 4.0: the output file carries the
    licence, the attribution and each article's revision id.
  - OurAirports airports.csv (public domain): article title -> IATA code,
    and name / country / position for airports the app does not know.
  - Wikidata (CC0) P238 as a fallback for title -> IATA.
  - public/data/cities.json (GeoNames, already in the repo): the nearest
    city's IANA time zone for those airports, plus an override table.

aircanada.com is never fetched (its terms forbid scraping).

Usage:
  python3 scripts/fetch-route-network.py [--dry-run] [--allow-route-drop] [--out PATH]

Safety gates (exit non-zero and leave the file untouched):
  - every hub article fetched and holding a destinations table;
  - at most MAX_UNRESOLVED_RATIO of linked destinations unresolved;
  - each hub keeps >= MIN_HUB_RATIO of its previous route count, and the
    total >= MIN_TOTAL_RATIO of the previous total (--allow-route-drop
    turns both into warnings, for a real network cut);
  - YUL, YYZ and YVR list at least MIN_BIG_HUB_ROUTES routes each.

When nothing but builtAt and article revision ids would change, the file is
left untouched.
"""

from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Callable, Iterable

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, "public", "data", "route-network.json")
DESTINATIONS_TS = os.path.join(ROOT, "src", "app", "data", "destinations.ts")
CITIES_JSON = os.path.join(ROOT, "public", "data", "cities.json")

WIKI_API = "https://en.wikipedia.org/w/api.php"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
OURAIRPORTS_CSV = "https://davidmegginson.github.io/ourairports-data/airports.csv"
USER_AGENT = ("RoutesBot/1.0 (personal non-commercial trip planner; "
              "https://github.com/mistersuun/Air-Canada-Travel)")
REQUEST_GAP_S = 1.5
BACKOFF_S = (10, 20, 40, 60)

LICENSE = "CC BY-SA 4.0"
ATTRIBUTION = ("Route list from the \"Airlines and destinations\" tables of English Wikipedia "
               "airport articles (Wikipedia contributors, CC BY-SA 4.0); airport details from "
               "OurAirports (public domain) and Wikidata (CC0); time zones from GeoNames (CC BY 4.0).")

# Hub code -> English Wikipedia article title.
HUB_ARTICLES: dict[str, str] = {
    "YYZ": "Toronto Pearson International Airport",
    "YUL": "Montréal–Trudeau International Airport",
    "YVR": "Vancouver International Airport",
    "YYC": "Calgary International Airport",
    "YOW": "Ottawa Macdonald–Cartier International Airport",
    "YHZ": "Halifax Stanfield International Airport",
    "YEG": "Edmonton International Airport",
    "YWG": "Winnipeg James Armstrong Richardson International Airport",
    "YQB": "Québec City Jean Lesage International Airport",
    "YTZ": "Billy Bishop Toronto City Airport",
}

BRANDS = {"Air Canada": "A", "Air Canada Express": "X", "Air Canada Rouge": "R"}
BRAND_ORDER = "AXR"

MAX_UNRESOLVED_RATIO = 0.05
MIN_HUB_RATIO = 0.70
MIN_TOTAL_RATIO = 0.80
BIG_HUBS = ("YUL", "YYZ", "YVR")
MIN_BIG_HUB_ROUTES = 50

# Time zones the nearest-city rule gets wrong or cannot be trusted with.
TZ_BY_CODE: dict[str, str] = {
    # Labrador airports are on Atlantic time (Goose Bay zone), not Newfoundland.
    "YYR": "America/Goose_Bay",
    "YWK": "America/Goose_Bay",
    "YDP": "America/Goose_Bay",
    "YRF": "America/Goose_Bay",
    "YBI": "America/St_Johns",  # Black Tickle, southeast Labrador, Newfoundland time
    "YNP": "America/Goose_Bay",
    # Lloydminster sits on the AB/SK border and keeps Alberta time.
    "YLL": "America/Edmonton",
    # Creston/Cranbrook (BC Kootenays) are on Mountain time.
    "YXC": "America/Edmonton",
}
TZ_BY_REGION: dict[str, str] = {
    "CA-NL": "America/St_Johns",
    "CA-SK": "America/Regina",
    "CA-YT": "America/Whitehorse",
    "CA-NS": "America/Halifax",
    "CA-PE": "America/Halifax",
    "CA-NB": "America/Moncton",
}

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"], start=1)}


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
def http_get(url: str, opener=urllib.request.urlopen, sleep=time.sleep, timeout: int = 60) -> bytes:
    """GET with a descriptive User-Agent; backs off on HTTP 429 / 5xx."""
    last: Exception | None = None
    for wait in (0, *BACKOFF_S):
        if wait:
            sleep(wait)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with opener(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code != 429 and e.code < 500:
                raise
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
    raise RuntimeError(f"GET failed after {len(BACKOFF_S) + 1} attempts: {url}: {last}")


def api(base: str, params: dict, opener=urllib.request.urlopen, sleep=time.sleep) -> dict:
    """One polite MediaWiki API call (sequential, REQUEST_GAP_S apart)."""
    sleep(REQUEST_GAP_S)
    q = dict(params, format="json", formatversion="2")
    return json.loads(http_get(base + "?" + urllib.parse.urlencode(q), opener, sleep).decode("utf-8"))


# ---------------------------------------------------------------------------
# Wikitext parsing
# ---------------------------------------------------------------------------
TEMPLATE_START_RE = re.compile(r"\{\{\s*Airport[- _]dest(?:ination)?[- _]list", re.I)
REF_RE = re.compile(r"<ref[^>/]*/>|<ref[^>]*>.*?</ref>", re.S | re.I)
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
BR_RE = re.compile(r"<br\s*/?>", re.I)
LINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
AIRLINE_RE = re.compile(r"^\s*\[\[(Air Canada(?: Express| Rouge)?)(?:\|[^\]]*)?\]\]\s*$")
PARAM_RE = re.compile(r"^\s*[0-9A-Za-z_]+\s*=")
WRAPPER_RE = re.compile(r"\{\{\s*(?:nowrap|small|nobr)\s*\|((?:[^{}]|\{\{[^{}]*\}\})*)\}\}", re.I)
NOTE_RE = re.compile(
    r"\(\s*(begins|ends|resumes|suspended until|suspended|ended|terminates|starts)\s+"
    r"([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4}|[A-Za-z]+\s+[0-9]{1,2},?\s+[0-9]{4}|[A-Za-z]+\s+[0-9]{4})\s*\)",
    re.I)


@dataclass(frozen=True)
class Row:
    """One destination listed under an Air Canada brand in a hub article."""
    brand: str          # 'A' | 'X' | 'R'
    title: str          # linked article title (normalised)
    seasonal: bool
    begins: str | None = None
    ends: str | None = None
    resumes: str | None = None


def normalize_title(title: str) -> str:
    t = urllib.parse.unquote(title).replace("_", " ").strip()
    t = re.sub(r"\s+", " ", t)
    return t[:1].upper() + t[1:] if t else t


def parse_date(text: str) -> str | None:
    """'1 December 2026' | 'December 1, 2026' | 'December 2026' -> ISO date (1st of month for month-only)."""
    s = re.sub(r"[,\s]+", " ", text.strip()).lower()
    m = re.fullmatch(r"(\d{1,2}) ([a-z]+) (\d{4})", s)
    if m:
        d, mon, y = int(m.group(1)), m.group(2), int(m.group(3))
    else:
        m = re.fullmatch(r"([a-z]+) (\d{1,2}) (\d{4})", s)
        if m:
            mon, d, y = m.group(1), int(m.group(2)), int(m.group(3))
        else:
            m = re.fullmatch(r"([a-z]+) (\d{4})", s)
            if not m:
                return None
            mon, d, y = m.group(1), 1, int(m.group(2))
    if mon not in MONTHS:
        return None
    try:
        return date(y, MONTHS[mon], d).isoformat()
    except ValueError:
        return None


def parse_notes(text: str) -> dict[str, str]:
    """'(begins 17 December 2026)' -> {'begins': '2026-12-17'} (ends/resumes too)."""
    out: dict[str, str] = {}
    for m in NOTE_RE.finditer(text):
        kind = m.group(1).lower()
        iso = parse_date(m.group(2))
        if not iso:
            continue
        key = {"begins": "begins", "starts": "begins", "ends": "ends", "ended": "ends",
               "terminates": "ends"}.get(kind, "resumes")
        out.setdefault(key, iso)
    return out


def template_body(wikitext: str) -> str | None:
    """Text inside the first destinations template (balanced {{ }}), without the name."""
    m = TEMPLATE_START_RE.search(wikitext)
    if not m:
        return None
    depth = 0
    i = m.start()
    while i < len(wikitext):
        two = wikitext[i:i + 2]
        if two == "{{":
            depth += 1
            i += 2
            continue
        if two == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return wikitext[m.end():i - 2]
            continue
        i += 1
    return wikitext[m.end():]


def split_cells(body: str) -> list[str]:
    """Split on '|' outside [[ ]] and {{ }}."""
    cells: list[str] = []
    buf: list[str] = []
    depth = 0
    i = 0
    while i < len(body):
        two = body[i:i + 2]
        if two in ("[[", "{{"):
            depth += 1
            buf.append(two)
            i += 2
            continue
        if two in ("]]", "}}") and depth > 0:
            depth -= 1
            buf.append(two)
            i += 2
            continue
        ch = body[i]
        if ch == "|" and depth == 0:
            cells.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
        i += 1
    cells.append("".join(buf).strip())
    return cells


def unwrap(text: str) -> str:
    prev = None
    while prev != text:
        prev = text
        text = WRAPPER_RE.sub(r"\1", text)
    return text


def parse_dest_list(wikitext: str) -> list[Row] | None:
    """Air Canada brand rows of the article's destinations table; None when there is no table."""
    body = template_body(wikitext)
    if body is None:
        return None
    body = COMMENT_RE.sub("", REF_RE.sub("", body))
    cells = split_cells(body)
    if cells and cells[0] == "":
        cells = cells[1:]
    params = [c for c in cells if PARAM_RE.match(c)]
    stride = 3 if any(re.match(r"^\s*3rdcol", p, re.I) for p in params) else 2
    cells = [c for c in cells if not PARAM_RE.match(c)]
    rows: list[Row] = []
    for i in range(0, len(cells) - 1, stride):
        airline = AIRLINE_RE.match(unwrap(cells[i]))
        if not airline:
            continue
        brand = BRANDS[airline.group(1)]
        seasonal = False
        for part in BR_RE.split(unwrap(cells[i + 1])):
            if re.search(r"seasonal", part, re.I):
                seasonal = True
            links = list(LINK_RE.finditer(part))
            for j, lm in enumerate(links):
                end = links[j + 1].start() if j + 1 < len(links) else len(part)
                notes = parse_notes(part[lm.end():end])
                rows.append(Row(brand, normalize_title(lm.group(1)), seasonal,
                                notes.get("begins"), notes.get("ends"), notes.get("resumes")))
    return rows


# ---------------------------------------------------------------------------
# Airports: title -> IATA, and details for unknown airports
# ---------------------------------------------------------------------------
@dataclass
class Airport:
    iata: str
    name: str
    municipality: str
    country: str
    region: str
    lat: float
    lng: float


def parse_ourairports(text: str) -> tuple[dict[str, str], dict[str, Airport]]:
    """(wikipedia title -> IATA, IATA -> Airport) from airports.csv."""
    by_title: dict[str, str] = {}
    by_iata: dict[str, Airport] = {}
    for r in csv.DictReader(io.StringIO(text)):
        code = (r.get("iata_code") or "").strip().upper()
        if not re.fullmatch(r"[A-Z]{3}", code):
            continue
        if r.get("type") == "closed":
            continue
        try:
            lat, lng = float(r["latitude_deg"]), float(r["longitude_deg"])
        except (KeyError, TypeError, ValueError):
            continue
        ap = Airport(code, (r.get("name") or "").strip(), (r.get("municipality") or "").strip(),
                     (r.get("iso_country") or "").strip(), (r.get("iso_region") or "").strip(), lat, lng)
        # Prefer airports with scheduled service when two share a code.
        if code not in by_iata or (r.get("scheduled_service") == "yes"):
            by_iata[code] = ap
        link = (r.get("wikipedia_link") or "").strip()
        m = re.search(r"wikipedia\.org/wiki/(.+)$", link)
        if m and "en.wikipedia" in link:
            by_title.setdefault(normalize_title(m.group(1)), code)
    return by_title, by_iata


def resolve_titles(titles: Iterable[str], by_title: dict[str, str], call_api: Callable[[str, dict], dict]
                   ) -> dict[str, str | None]:
    """Article title -> IATA: OurAirports link, then API redirects, then Wikidata P238."""
    out: dict[str, str | None] = {}
    pending: list[str] = []
    for t in sorted(set(titles)):
        out[t] = by_title.get(t)
        if out[t] is None:
            pending.append(t)
    for i in range(0, len(pending), 40):
        batch = pending[i:i + 40]
        j = call_api(WIKI_API, {"action": "query", "titles": "|".join(batch), "redirects": 1,
                                "prop": "pageprops", "ppprop": "wikibase_item"})
        q = j.get("query", {})
        norm = {r["from"]: r["to"] for r in q.get("normalized", [])}
        red = {r["from"]: r["to"] for r in q.get("redirects", [])}
        items = {p.get("title"): p.get("pageprops", {}).get("wikibase_item") for p in q.get("pages", [])}
        need_wd: dict[str, str] = {}
        for t in batch:
            target = norm.get(t, t)
            target = red.get(target, target)
            code = by_title.get(normalize_title(target))
            if code:
                out[t] = code
            elif items.get(target):
                need_wd[t] = items[target]
        if need_wd:
            w = call_api(WIKIDATA_API, {"action": "wbgetentities", "ids": "|".join(sorted(set(need_wd.values()))),
                                        "props": "claims"})
            ents = w.get("entities", {})
            for t, qid in need_wd.items():
                claims = ents.get(qid, {}).get("claims", {}).get("P238", [])
                for c in claims:
                    v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
                    if isinstance(v, str) and re.fullmatch(r"[A-Z]{3}", v):
                        out[t] = v
                        break
    return out


def load_cities(path: str = CITIES_JSON) -> list[tuple[float, float, str]]:
    """(lat, lng, tz) for every GeoNames city in the app's cities.json."""
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    cols = d["cols"]
    return [(cols["lat"][i] / 100, cols["lng"][i] / 100, d["tz"][cols["tz"][i]]) for i in range(len(cols["lat"]))]


def nearest_tz(lat: float, lng: float, cities: list[tuple[float, float, str]]) -> str | None:
    best, best_d = None, math.inf
    cos = math.cos(math.radians(lat))
    for clat, clng, tz in cities:
        dlng = (lng - clng + 180) % 360 - 180
        d = (lat - clat) ** 2 + (dlng * cos) ** 2
        if d < best_d:
            best, best_d = tz, d
    return best


def airport_tz(ap: Airport, cities: list[tuple[float, float, str]]) -> str | None:
    if ap.iata in TZ_BY_CODE:
        return TZ_BY_CODE[ap.iata]
    if ap.region in TZ_BY_REGION:
        return TZ_BY_REGION[ap.region]
    return nearest_tz(ap.lat, ap.lng, cities)


def load_known_codes(path: str = DESTINATIONS_TS) -> tuple[list[str], set[str]]:
    """(hub codes in order, every hub + destination code) from destinations.ts."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    block = re.search(r"export const HUBS[^=]*=\s*\[(.*?)\];", text, re.S)
    hubs = re.findall(r"code:\s*['\"]([A-Z]{3})['\"]", block.group(1)) if block else list(HUB_ARTICLES)
    return hubs, set(re.findall(r"code:\s*['\"]([A-Z]{3})['\"]", text))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
def route_key(a: str, b: str, hubs: list[str]) -> str:
    """Undirected key: hub first; two hubs (or two non-hubs) alphabetically."""
    if (a in hubs) != (b in hubs):
        return f"{a}-{b}" if a in hubs else f"{b}-{a}"
    x, y = sorted((a, b))
    return f"{x}-{y}"


@dataclass
class Fact:
    brands: set = field(default_factory=set)
    mentions: list = field(default_factory=list)  # Row per mention


def merge_routes(hub_rows: dict[str, list[Row]], codes: dict[str, str | None], hubs: list[str],
                 today: date) -> dict[str, list]:
    """{key: [brands, seasonal, begins, ends, resumes]} with past dates applied."""
    t = today.isoformat()
    facts: dict[str, Fact] = {}
    for hub, rows in hub_rows.items():
        for r in rows:
            code = codes.get(r.title)
            if not code or code == hub:
                continue
            if r.ends and r.ends < t:
                continue  # ended
            row = Row(r.brand, r.title, r.seasonal,
                      r.begins if r.begins and r.begins >= t else None,
                      r.ends,
                      r.resumes if r.resumes and r.resumes >= t else None)
            f = facts.setdefault(route_key(hub, code, hubs), Fact())
            f.brands.add(r.brand)
            f.mentions.append(row)
    out: dict[str, list] = {}
    for key in sorted(facts):
        ms = facts[key].mentions
        brands = "".join(b for b in BRAND_ORDER if b in facts[key].brands)
        seasonal = 1 if all(m.seasonal for m in ms) else 0
        begins = resumes = None
        if all(m.begins or m.resumes for m in ms):
            # Not flying today under any brand: keep the earliest start, and
            # whether it is a new route (begins) or a pause (resumes).
            start = min((m.begins or m.resumes, 0 if m.begins else 1) for m in ms)
            if start[1] == 0:
                begins = start[0]
            else:
                resumes = start[0]
        ends = None if any(not m.ends for m in ms) else max(m.ends for m in ms)
        out[key] = [brands, seasonal, begins, ends, resumes]
    return out


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
def _j(v) -> str:
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def generate_json(routes: dict[str, list], airports: dict[str, list], sources: list[dict], built_at: str) -> str:
    """Deterministic file text: one route / airport / source per line, keys sorted."""
    lines = ["{", '  "version": 1,', f'  "license": {_j(LICENSE)},', f'  "attribution": {_j(ATTRIBUTION)},',
             '  "meta": {', f'    "builtAt": {_j(built_at)},', f'    "routeCount": {len(routes)},',
             f'    "airportCount": {len(airports)},', '    "sources": [']
    lines += [f"      {_j(s)}" + ("," if i < len(sources) - 1 else "") for i, s in enumerate(sources)]
    lines += ["    ]", "  },", '  "airports": {']
    akeys = sorted(airports)
    lines += [f"    {_j(k)}: {_j(airports[k])}" + ("," if i < len(akeys) - 1 else "") for i, k in enumerate(akeys)]
    lines += ["  },", '  "routes": {']
    rkeys = sorted(routes)
    lines += [f"    {_j(k)}: {_j(routes[k])}" + ("," if i < len(rkeys) - 1 else "") for i, k in enumerate(rkeys)]
    lines += ["  }", "}", ""]
    return "\n".join(lines)


def comparable(text: str) -> dict | None:
    """The file minus builtAt and revision ids (edits that did not change the data)."""
    try:
        d = json.loads(text)
    except ValueError:
        return None
    meta = dict(d.get("meta") or {})
    meta.pop("builtAt", None)
    meta["sources"] = [{k: v for k, v in s.items() if k not in ("revid", "url")} for s in meta.get("sources", [])]
    d["meta"] = meta
    return d


def load_previous(path: str) -> dict | None:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Gates
# ---------------------------------------------------------------------------
def check_gates(*, hub_rows: dict[str, list[Row] | None], fetch_errors: list[str], unresolved: int,
                linked: int, hub_counts: dict[str, int], prev: dict | None, total: int,
                allow_drop: bool = False) -> tuple[list[str], list[str]]:
    errors = list(fetch_errors)
    warnings: list[str] = []
    for hub in HUB_ARTICLES:
        if hub_rows.get(hub) is None and not any(e.startswith(hub) for e in fetch_errors):
            errors.append(f"{hub}: no destinations table found")
    if linked and unresolved / linked > MAX_UNRESOLVED_RATIO:
        errors.append(f"too many unresolved destinations: {unresolved}/{linked}")
    elif unresolved:
        warnings.append(f"{unresolved} unresolved destination link(s)")
    for hub in BIG_HUBS:
        if hub_counts.get(hub, 0) < MIN_BIG_HUB_ROUTES:
            errors.append(f"{hub}: only {hub_counts.get(hub, 0)} routes (< {MIN_BIG_HUB_ROUTES})")
    drops: list[str] = []
    if prev:
        prev_hubs = {s.get("hub"): s.get("routes", 0) for s in prev.get("meta", {}).get("sources", [])}
        for hub, n in prev_hubs.items():
            if n and hub_counts.get(hub, 0) < MIN_HUB_RATIO * n:
                drops.append(f"{hub}: routes dropped {n} -> {hub_counts.get(hub, 0)} (< {MIN_HUB_RATIO:.0%})")
        prev_total = prev.get("meta", {}).get("routeCount") or len(prev.get("routes", {}))
        if prev_total and total < MIN_TOTAL_RATIO * prev_total:
            drops.append(f"total routes dropped {prev_total} -> {total} (< {MIN_TOTAL_RATIO:.0%})")
    for d in drops:
        (warnings if allow_drop else errors).append(d + (" (allowed by --allow-route-drop)" if allow_drop else ""))
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


def run(argv: list[str], *, opener=urllib.request.urlopen, sleep=time.sleep,
        out_path: str | None = None, destinations_ts: str = DESTINATIONS_TS, cities_json: str = CITIES_JSON,
        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> int:
    dry_run = "--dry-run" in argv
    allow_drop = "--allow-route-drop" in argv
    if "--out" in argv:
        out_path = argv[argv.index("--out") + 1]
    out_path = out_path or DEFAULT_OUT
    hubs, known = load_known_codes(destinations_ts)
    hubs = [h for h in hubs if h in HUB_ARTICLES] + [h for h in HUB_ARTICLES if h not in hubs]
    call_api = lambda base, params: api(base, params, opener, sleep)  # noqa: E731

    hub_rows: dict[str, list[Row] | None] = {}
    sources: list[dict] = []
    fetch_errors: list[str] = []
    for hub, title in HUB_ARTICLES.items():
        try:
            j = call_api(WIKI_API, {"action": "parse", "page": title, "prop": "wikitext|revid", "redirects": 1})
            p = j["parse"]
            hub_rows[hub] = parse_dest_list(p["wikitext"])
            revid = int(p.get("revid") or 0)
            sources.append({"hub": hub, "title": p.get("title", title), "revid": revid,
                            "url": f"https://en.wikipedia.org/w/index.php?oldid={revid}"})
            print(f"{hub}: {len(hub_rows[hub] or [])} Air Canada rows (rev {revid})")
        except Exception as e:  # noqa: BLE001
            hub_rows[hub] = None
            fetch_errors.append(f"{hub}: fetch failed: {e}")
            print(f"ERROR {hub}: {e}")

    try:
        by_title, by_iata = parse_ourairports(http_get(OURAIRPORTS_CSV, opener, sleep).decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"ERROR: OurAirports download failed: {e}")
        return 1
    titles = {r.title for rows in hub_rows.values() if rows for r in rows}
    codes = resolve_titles(titles, by_title, call_api)
    unresolved = sorted(t for t, c in codes.items() if not c)
    for t in unresolved:
        print(f"  unresolved: {t}")

    today = now().date()
    routes = merge_routes({h: r for h, r in hub_rows.items() if r}, codes, hubs, today)
    hub_counts = {h: sum(1 for k in routes if h in k.split("-")) for h in HUB_ARTICLES}
    for s in sources:
        s["routes"] = hub_counts.get(s["hub"], 0)

    cities = load_cities(cities_json)
    airports: dict[str, list] = {}
    missing_airports: list[str] = []
    for key in routes:
        for code in key.split("-"):
            if code in known or code in airports:
                continue
            ap = by_iata.get(code)
            tz = airport_tz(ap, cities) if ap else None
            if not ap or not tz:
                missing_airports.append(code)
                continue
            airports[code] = [ap.municipality or ap.name, ap.country, tz, round(ap.lat, 2), round(ap.lng, 2)]

    prev = load_previous(out_path)
    errors, warnings = check_gates(hub_rows=hub_rows, fetch_errors=fetch_errors, unresolved=len(unresolved),
                                   linked=len(titles), hub_counts=hub_counts, prev=prev, total=len(routes),
                                   allow_drop=allow_drop)
    if missing_airports:
        errors.append(f"no airport details for: {', '.join(sorted(set(missing_airports)))}")

    for w in warnings:
        print(f"WARNING: {w}")
    for e in errors:
        print(f"ERROR: {e}")
    prev_n = len((prev or {}).get("routes", {}))
    _write_step_summary("\n".join(
        ["### Route network update" + (" (dry run)" if dry_run else ""), "",
         f"- Routes: {prev_n} -> {len(routes)}", f"- Extra airports: {len(airports)}"]
        + [f"  - {h}: {n}" for h, n in hub_counts.items()]
        + [f"- WARNING: {w}" for w in warnings] + [f"- **ERROR: {e}**" for e in errors]))

    if errors:
        print(f"\nSafety gates failed; {out_path} left untouched.")
        return 1
    built_at = now().strftime("%Y-%m-%dT%H:%M:%SZ")
    text = generate_json(routes, airports, sources, built_at)
    if dry_run:
        print("\n--- DRY RUN: all gates passed, not writing file ---")
        return 0
    try:
        with open(out_path, encoding="utf-8") as f:
            existing = f.read()
    except OSError:
        existing = None
    if existing is not None and comparable(existing) == comparable(text):
        print(f"\nNo route changes; {out_path} left untouched (builtAt kept).")
        return 0
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    if len(json.loads(open(tmp, encoding="utf-8").read())["routes"]) != len(routes):
        os.remove(tmp)
        print("ERROR: generated file failed self-check; not replacing")
        return 1
    os.replace(tmp, out_path)
    print(f"Written {len(routes)} routes to {out_path}")
    return 0


def main() -> None:
    sys.exit(run(sys.argv[1:]))


if __name__ == "__main__":
    main()
