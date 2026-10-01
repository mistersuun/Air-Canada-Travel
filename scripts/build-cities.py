#!/usr/bin/env python3
"""
Builds public/data/cities.json, the compact city index behind "Places" search
(a city Air Canada does not fly to, e.g. Seville, and the airports near it).

Source: GeoNames (https://www.geonames.org), CC BY 4.0. The script downloads
  - cities15000.zip       every populated place with 15,000+ people (~3 MB)
  - admin1CodesASCII.txt  region names ('ES.51' -> 'Andalusia')
  - alternateNamesV2.zip  names by language (~200 MB, streamed, never unpacked)
into a temporary folder (or --cache-dir to keep them between runs) and writes
only the compacted JSON. The raw files are never committed.

Usage:
  python3 scripts/build-cities.py [--out PATH] [--cache-dir DIR]

It is run by hand (city names barely change; the weekly schedules workflow
does not run it because of the 200 MB download). Commit the regenerated
public/data/cities.json after checking the printed size.

Output format (columnar, every column the same length):
  {
    "v": 1, "source": "...", "license": "CC BY 4.0",
    "attribution": "GeoNames (geonames.org)", "generatedAt": "...Z",
    "tz": ["Europe/Madrid", ...],          # time zone table
    "cc": ["ES", ...],                     # ISO 3166-1 alpha-2 table
    "rg": [[0, "Andalusia"], [0, ""], ...], # (country index, region name) table
    "cols": {
      "id":   [delta-encoded geonameid, ascending],
      "name": ["Seville", ...],            # English name when GeoNames has a preferred one
      "alt":  ["Sevilla|Sevilha|Siviglia", ""],  # <= 4 Latin names, only for 100k+ people
      "rg":   [index into rg],             # country and region
      "lat":  [3738, ...], "lng": [-597, ...],   # hundredths of a degree (2 decimals)
      "pop":  [687, ...],                  # thousands
      "tz":   [index into tz]
    }
  }

The parsing and compaction functions are pure so tests can feed them fixtures.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import sys
import tempfile
import unicodedata
import urllib.request
import zipfile
from datetime import datetime, timezone
from typing import Iterable

BASE_URL = "https://download.geonames.org/export/dump/"
CITIES_FILE = "cities15000.zip"
ADMIN1_FILE = "admin1CodesASCII.txt"
ALT_FILE = "alternateNamesV2.zip"
USER_AGENT = "Mozilla/5.0 (compatible; ac-explorer-cities-bot)"

DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "data", "cities.json")

# Alternate names are kept only for big cities, so the file stays small.
ALT_MIN_POPULATION = 100_000
MAX_ALTS = 4
MAX_ALT_LEN = 24
# Languages whose names travellers type, in priority order. The GeoNames
# main name (usually the local one: Sevilla, Lisboa, Kraków) always comes first.
ALT_LANGS = ("en", "fr", "es", "pt", "de", "it", "nl")

SIZE_TARGET = 1_500_000
SIZE_CAP = 2_000_000
GZIP_CAP = 700_000


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------
def fold(s: str) -> str:
    """Accent- and case-insensitive key, like normalizeText in the app: 'Séville' -> 'seville'."""
    nfd = unicodedata.normalize("NFD", s)
    return "".join(c for c in nfd if not unicodedata.combining(c)).casefold().strip()


def is_latin(s: str) -> bool:
    """True when every letter is Latin script (accents allowed): 'Kraków' yes, 'Севилья' no."""
    has_letter = False
    for c in s:
        if c.isalpha():
            has_letter = True
            try:
                if "LATIN" not in unicodedata.name(c):
                    return False
            except ValueError:
                return False
    return has_letter


# ---------------------------------------------------------------------------
# Parsers (pure: take lines, return data)
# ---------------------------------------------------------------------------
def parse_cities(lines: Iterable[str]) -> list[dict]:
    """
    Rows of cities15000.txt (tab-separated, 19 columns):
    geonameid, name, asciiname, alternatenames, latitude, longitude, feature
    class, feature code, country code, cc2, admin1..admin4, population,
    elevation, dem, timezone, modification date.
    Rows without coordinates, country or time zone are skipped.
    """
    out = []
    for line in lines:
        line = line.rstrip("\n")
        if not line or line.startswith("#"):
            continue
        f = line.split("\t")
        if len(f) < 18:
            continue
        try:
            gid = int(f[0])
            lat = float(f[4])
            lng = float(f[5])
            pop = int(f[14] or 0)
        except ValueError:
            continue
        cc = f[8].strip().upper()
        tz = f[17].strip()
        name = f[1].strip()
        if not (name and len(cc) == 2 and tz):
            continue
        out.append({
            "id": gid,
            "name": name,
            "ascii": f[2].strip(),
            "lat": lat,
            "lng": lng,
            "cc": cc,
            "admin1": f[10].strip(),
            "pop": pop,
            "tz": tz,
        })
    return out


def parse_admin1(lines: Iterable[str]) -> dict[str, str]:
    """admin1CodesASCII.txt rows 'ES.51<TAB>Andalusia<TAB>Andalusia<TAB>2593109' -> {'ES.51': 'Andalusia'}."""
    out = {}
    for line in lines:
        f = line.rstrip("\n").split("\t")
        if len(f) >= 2 and f[0] and f[1]:
            out[f[0]] = f[1].strip()
    return out


def parse_alt_names(lines: Iterable[str], wanted: set[int], langs: Iterable[str] = ALT_LANGS) -> dict[int, list[dict]]:
    """
    Rows of alternateNamesV2.txt: alternateNameId, geonameid, isolanguage,
    alternate name, isPreferredName, isShortName, isColloquial, isHistoric,
    from, to. Keeps names of `wanted` places in `langs` that are not
    colloquial or historic, in file order.
    """
    lang_set = set(langs)
    out: dict[int, list[dict]] = {}
    for line in lines:
        f = line.rstrip("\n").split("\t")
        if len(f) < 4:
            continue
        lang = f[2]
        if lang not in lang_set:
            continue
        try:
            gid = int(f[1])
        except ValueError:
            continue
        if gid not in wanted:
            continue
        flag = lambda i: len(f) > i and f[i] == "1"  # noqa: E731
        if flag(6) or flag(7):
            continue
        out.setdefault(gid, []).append({
            "lang": lang,
            "name": f[3].strip(),
            "preferred": flag(4),
            "short": flag(5),
        })
    return out


# ---------------------------------------------------------------------------
# Name choice
# ---------------------------------------------------------------------------
def _pick(names: list[dict], lang: str) -> str | None:
    """The preferred name in `lang` (a short preferred one first), else the first one."""
    own = [n for n in names if n["lang"] == lang and n["name"]]
    if not own:
        return None
    pref = [n for n in own if n["preferred"]]
    pref.sort(key=lambda n: not n["short"])
    return (pref or own)[0]["name"]


def display_name(city: dict, names: list[dict]) -> str:
    """
    The English name when GeoNames has a preferred one ('Seville', 'Lisbon'),
    keeping the GeoNames spelling when they only differ by accents
    ('Montréal', 'Kraków'); otherwise the GeoNames name.
    """
    pref_en = [n for n in names if n["lang"] == "en" and n["preferred"] and n["name"]]
    pref_en.sort(key=lambda n: not n["short"])
    if pref_en:
        en = pref_en[0]["name"]
        if is_latin(en) and fold(en) != fold(city["name"]):
            return en
    return city["name"]


def alternate_names(city: dict, names: list[dict], shown: str) -> list[str]:
    """
    Up to MAX_ALTS Latin-script names other than `shown`, de-duplicated
    accent- and case-insensitively: the GeoNames name first, then one per
    language in ALT_LANGS order. Only for places with ALT_MIN_POPULATION+.
    """
    if city["pop"] < ALT_MIN_POPULATION:
        return []
    seen = {fold(shown)}
    out: list[str] = []
    candidates = [city["name"]] + [_pick(names, lang) for lang in ALT_LANGS]
    for cand in candidates:
        if not cand or len(cand) > MAX_ALT_LEN or "|" in cand or not is_latin(cand):
            continue
        key = fold(cand)
        if key in seen:
            continue
        seen.add(key)
        out.append(cand)
        if len(out) >= MAX_ALTS:
            break
    return out


# ---------------------------------------------------------------------------
# Compaction
# ---------------------------------------------------------------------------
def build_file(cities: list[dict], alt_names: dict[int, list[dict]], admin1: dict[str, str], generated_at: str) -> dict:
    """The cities.json object (see the module docstring)."""
    rows = sorted(cities, key=lambda c: c["id"])
    tz_index: dict[str, int] = {}
    cc_index: dict[str, int] = {}
    rg_index: dict[tuple[int, str], int] = {}
    cols: dict[str, list] = {k: [] for k in ("id", "name", "alt", "rg", "lat", "lng", "pop", "tz")}
    prev = 0
    for c in rows:
        names = alt_names.get(c["id"], [])
        shown = display_name(c, names)
        alts = alternate_names(c, names, shown)
        region = admin1.get(f'{c["cc"]}.{c["admin1"]}') if c["admin1"] else None
        cols["id"].append(c["id"] - prev)
        prev = c["id"]
        cols["name"].append(shown)
        cols["alt"].append("|".join(alts))
        cc = cc_index.setdefault(c["cc"], len(cc_index))
        cols["rg"].append(rg_index.setdefault((cc, region or ""), len(rg_index)))
        cols["lat"].append(round(c["lat"] * 100))
        cols["lng"].append(round(c["lng"] * 100))
        cols["pop"].append(max(1, round(c["pop"] / 1000)))
        cols["tz"].append(tz_index.setdefault(c["tz"], len(tz_index)))
    return {
        "v": 1,
        "source": "GeoNames cities15000, admin1CodesASCII, alternateNamesV2",
        "license": "CC BY 4.0",
        "attribution": "GeoNames (geonames.org)",
        "generatedAt": generated_at,
        "tz": list(tz_index),
        "cc": list(cc_index),
        "rg": [[cc, name] for cc, name in rg_index],
        "cols": cols,
    }


def encode(file: dict) -> str:
    return json.dumps(file, ensure_ascii=False, separators=(",", ":"))


def decode_rows(file: dict) -> list[dict]:
    """Inverse of build_file's columns (used by tests and the summary)."""
    cols = file["cols"]
    out = []
    gid = 0
    for i in range(len(cols["id"])):
        gid += cols["id"][i]
        cc, region = file["rg"][cols["rg"][i]]
        out.append({
            "id": gid,
            "name": cols["name"][i],
            "alt": [a for a in cols["alt"][i].split("|") if a],
            "cc": file["cc"][cc],
            "admin1": region or None,
            "lat": cols["lat"][i] / 100,
            "lng": cols["lng"][i] / 100,
            "pop": cols["pop"][i],
            "tz": file["tz"][cols["tz"][i]],
        })
    return out


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------
def download(name: str, folder: str) -> str:
    path = os.path.join(folder, name)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        print(f"  using cached {name}")
        return path
    url = BASE_URL + name
    print(f"  downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    tmp = path + ".part"
    with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as out:
        shutil.copyfileobj(resp, out, 1 << 20)
    os.replace(tmp, path)
    return path


def zip_lines(path: str, member: str) -> Iterable[str]:
    with zipfile.ZipFile(path) as zf, zf.open(member) as raw:
        yield from io.TextIOWrapper(raw, encoding="utf-8")


def run(out_path: str, cache_dir: str) -> dict:
    print("GeoNames city index")
    cities_zip = download(CITIES_FILE, cache_dir)
    admin1_txt = download(ADMIN1_FILE, cache_dir)
    alt_zip = download(ALT_FILE, cache_dir)

    cities = parse_cities(zip_lines(cities_zip, "cities15000.txt"))
    if len(cities) < 20_000:
        raise SystemExit(f"Only {len(cities)} cities parsed; refusing to write.")
    with open(admin1_txt, encoding="utf-8") as fh:
        admin1 = parse_admin1(fh)
    print(f"  {len(cities)} cities, {len(admin1)} regions; scanning alternate names...")
    alts = parse_alt_names(zip_lines(alt_zip, "alternateNamesV2.txt"), {c["id"] for c in cities})

    generated = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    file = build_file(cities, alts, admin1, generated)
    text = encode(file)
    raw = len(text.encode("utf-8"))
    import gzip
    gz = len(gzip.compress(text.encode("utf-8"), 9))
    print(f"  {raw:,} bytes raw, {gz:,} bytes gzip (target {SIZE_TARGET:,}, cap {SIZE_CAP:,} / {GZIP_CAP:,})")
    if raw > SIZE_CAP or gz > GZIP_CAP:
        raise SystemExit("Over the size budget; refusing to write.")
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"  wrote {out_path}")
    return file


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default=DEFAULT_OUT, help="output JSON (default public/data/cities.json)")
    ap.add_argument("--cache-dir", default=None, help="keep the downloads here (default: a temporary folder)")
    args = ap.parse_args(argv)
    if args.cache_dir:
        os.makedirs(args.cache_dir, exist_ok=True)
        run(args.out, args.cache_dir)
    else:
        with tempfile.TemporaryDirectory(prefix="geonames-") as tmp:
            run(args.out, tmp)
    return 0


if __name__ == "__main__":
    sys.exit(main())
