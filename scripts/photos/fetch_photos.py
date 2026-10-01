#!/usr/bin/env python3
"""Destination photos: find, fetch, optimise and credit.

Sources are Wikimedia Commons (via the MediaWiki API, licence checked per
file) and Unsplash (curated photo ids; with UNSPLASH_ACCESS_KEY the API is
used for metadata and the download_location ping the API guidelines require).

Sub-commands
  suggest [CODE ...] [--n 4] [--out DIR]
      Search Commons with the query in queries.json, keep licence-allowed,
      landscape, >= 1600px files (Quality / Featured / Valued first), write
      DIR/candidates.json and one labelled contact sheet per 12 codes.
  fetch [--force CODE ...] [--force-all]
      Read picks.json, download each pick, write public/img/dest/<CODE>.webp
      (960w) and <CODE>-400.webp, and rebuild credits.json. Idempotent: codes
      whose files exist are skipped unless forced (their credit is kept).
  contact [--out FILE]
      Grid of every 400w output, labelled with its code, for review.

picks.json: { "<CODE>": {"commons": "File:....jpg", "position": "50% 40%"}
                       | {"unsplash": "<photo id>", ...} | {"skip": "reason"} }
"""
from __future__ import annotations

import argparse
import html
import io
import json
import math
import os
import re
import sys
import time
from datetime import date
from pathlib import Path

import requests
from PIL import Image, ImageCms, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = ROOT / "public" / "img" / "dest"
PICKS = HERE / "picks.json"
QUERIES = HERE / "queries.json"
CREDITS = OUT / "credits.json"
FETCHED = HERE / "fetched.json"  # code -> pick id the current files came from

UA = "ac-explorer-photos/1.0 (https://github.com/mistersuun/Air-Canada-Travel; destination photos for a schedule explorer)"
API = "https://commons.wikimedia.org/w/api.php"

ALLOWED = {
    "cc0": "CC0", "public domain": "Public domain", "pd": "Public domain",
    "cc by 2.0": "CC BY 2.0", "cc by 2.5": "CC BY 2.5", "cc by 3.0": "CC BY 3.0", "cc by 4.0": "CC BY 4.0",
    "cc by-sa 2.0": "CC BY-SA 2.0", "cc by-sa 2.5": "CC BY-SA 2.5", "cc by-sa 3.0": "CC BY-SA 3.0",
    "cc by-sa 4.0": "CC BY-SA 4.0",
}
LICENSE_URLS = {
    "CC0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "Public domain": "https://commons.wikimedia.org/wiki/Commons:Public_domain",
}
QUALITY_CATS = ("Quality images", "Featured pictures", "Valued images", "Pictures of the day")

MAIN_W, MAIN_Q, MAIN_MAX = 960, 62, 110_000
SMALL_W, SMALL_Q, SMALL_MAX = 400, 60, 30_000
MAX_ASPECT, MIN_ASPECT = 1.5, 0.8  # crop to at most 3:2 wide and 4:5 tall

session = requests.Session()
session.headers["User-Agent"] = UA


# ─── helpers ────────────────────────────────────────────────────────────────

def strip_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def first_href(s: str) -> str | None:
    m = re.search(r'href="([^"]+)"', s or "")
    if not m:
        return None
    url = html.unescape(m.group(1))
    return "https:" + url if url.startswith("//") else url


def norm_license(short: str) -> str | None:
    key = (short or "").strip().lower()
    return ALLOWED.get(key)


def get(url: str, **kw) -> requests.Response:
    for attempt in range(5):
        r = session.get(url, timeout=60, **kw)
        if r.status_code in (429, 503):
            time.sleep(5 * (attempt + 1))
            continue
        r.raise_for_status()
        return r
    r.raise_for_status()
    return r


def commons_info(titles: list[str], thumb_w: int = 1920) -> dict[str, dict]:
    """imageinfo + extmetadata for File: titles, keyed by normalised title."""
    out: dict[str, dict] = {}
    for i in range(0, len(titles), 40):
        chunk = titles[i:i + 40]
        r = get(API, params={
            "action": "query", "format": "json", "formatversion": 2,
            "titles": "|".join(chunk), "prop": "imageinfo",
            "iiprop": "url|size|mime|extmetadata", "iiurlwidth": thumb_w,
        }).json()
        if "error" in r:
            print("API error:", r["error"].get("info"), file=sys.stderr)
        qr = r.get("query", {})
        norm = {n["from"]: n["to"] for n in qr.get("normalized", [])}
        for p in qr.get("pages", []):
            if "imageinfo" in p:
                out[p["title"]] = p
        for src, dst in norm.items():
            if dst in out:
                out[src] = out[dst]
    return out


def describe(page: dict) -> dict | None:
    """Credit fields for a Commons page, or None when the licence is not allowed."""
    ii = page["imageinfo"][0]
    md = ii.get("extmetadata", {})
    val = lambda k: md.get(k, {}).get("value", "")
    lic = norm_license(val("LicenseShortName"))
    if not lic:
        return None
    artist_html = val("Artist")
    author = strip_html(artist_html) or strip_html(val("Credit")) or "Unknown"
    author = re.sub(r"\s*\(talk\)$", "", author)[:80]
    title = page["title"]
    subject = strip_html(val("ObjectName")) or re.sub(r"\.\w+$", "", title.removeprefix("File:"))
    subject = re.sub(r"[_]+", " ", subject)[:90]
    return {
        "subject": subject,
        "author": author,
        "authorUrl": first_href(artist_html) or ii["descriptionurl"],
        "source": "wikimedia",
        "sourceUrl": ii["descriptionurl"],
        "license": lic,
        "licenseUrl": val("LicenseUrl") or LICENSE_URLS.get(lic, ii["descriptionurl"]),
        "_download": ii.get("thumburl") or ii["url"],
        "_w": ii["width"], "_h": ii["height"], "_mime": ii.get("mime", ""),
        "_cats": val("Categories"),
    }


# ─── suggest ────────────────────────────────────────────────────────────────

def search(q: str, limit: int = 40) -> list[str]:
    r = get(API, params={
        "action": "query", "format": "json", "formatversion": 2, "list": "search",
        "srnamespace": 6, "srsearch": q, "srlimit": limit,
    }).json()
    return [h["title"] for h in r.get("query", {}).get("search", [])]


def fold(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", s.lower()) if not unicodedata.combining(c))


def candidates(query: str, n: int) -> list[dict]:
    """query is "search words" or "search words|key"; key (default: the first
    word) must appear in the file title or its categories. "a&b" requires both."""
    query, _, key = query.partition("|")
    key = fold(key or query.split()[0])
    titles: list[str] = []
    for q in (f'{query} incategory:"Quality_images"', f'{query} incategory:"Featured_pictures_on_Wikimedia_Commons"',
              f'intitle:"{key}" incategory:"Quality_images"', query):
        for t in search(q):
            if t not in titles and re.search(r"\.jpe?g$", t, re.I):
                titles.append(t)
    info = commons_info(titles, thumb_w=330)
    found = []
    for t in titles:
        p = info.get(t)
        if not p:
            continue
        d = describe(p)
        if not d or d["_mime"] != "image/jpeg" or d["_w"] < 1600:
            continue
        ar = d["_w"] / d["_h"]
        if not 1.2 <= ar <= 2.0:
            continue
        hay = fold(t + " " + d["_cats"])
        if not all(k.strip() in hay for k in key.split("&")):
            continue
        d["title"] = t
        d["quality"] = any(c in d["_cats"] for c in QUALITY_CATS)
        found.append(d)
    found.sort(key=lambda d: not d["quality"])  # stable: keeps search rank
    return found[:n]


def font(size: int):
    for f in ("/usr/share/fonts/TTF/DejaVuSans-Bold.ttf", "/usr/share/fonts/TTF/DejaVuSans.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def label(im: Image.Image, text: str) -> None:
    d = ImageDraw.Draw(im)
    f = font(14)
    box = d.textbbox((0, 0), text, font=f)
    d.rectangle((0, 0, box[2] + 10, box[3] + 8), fill=(0, 0, 0))
    d.text((5, 3), text, fill=(255, 255, 255), font=f)


def sheet(cells: list[tuple[str, Image.Image | None]], cols: int, cw: int, ch: int, path: Path) -> None:
    rows = math.ceil(len(cells) / cols)
    out = Image.new("RGB", (cols * cw, rows * ch), (40, 40, 40))
    for i, (text, im) in enumerate(cells):
        tile = Image.new("RGB", (cw - 4, ch - 4), (90, 90, 90))
        if im is not None:
            tile = ImageOps.fit(im.convert("RGB"), (cw - 4, ch - 4))
        label(tile, text)
        out.paste(tile, ((i % cols) * cw + 2, (i // cols) * ch + 2))
    out.save(path, quality=80)


def cmd_suggest(args) -> None:
    queries = json.loads(QUERIES.read_text())
    codes = args.codes or list(queries)
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    cpath = outdir / "candidates.json"
    allc = json.loads(cpath.read_text()) if cpath.exists() else {}
    for b in range(0, len(codes), 12):
        batch = codes[b:b + 12]
        cells = []
        for code in batch:
            q = args.query if args.query else queries[code]
            try:
                allc[code] = [{k: v for k, v in d.items() if k != "_cats"} for d in candidates(q, args.n)]
            except Exception as e:
                print(f"{code}: {e}", file=sys.stderr)
                allc[code] = []
            print(f"{code}: {len(allc[code])} candidates for {q!r}", flush=True)
            cs = allc[code]
            for i in range(args.n):
                im = None
                if i < len(cs):
                    try:
                        im = Image.open(io.BytesIO(get(cs[i]["_download"]).content))
                    except Exception:
                        im = None
                cells.append((f"{code} {i}{'*' if i < len(cs) and cs[i]['quality'] else ''}", im))
        cpath.write_text(json.dumps(allc, indent=1, ensure_ascii=False))
        path = outdir / f"{args.sheet or 'cand'}-{b // 12:02d}.jpg"
        sheet(cells, args.n, 220, 150, path)
        print("wrote", path, flush=True)


# ─── fetch ──────────────────────────────────────────────────────────────────

def to_srgb(im: Image.Image) -> Image.Image:
    icc = im.info.get("icc_profile")
    if icc:
        try:
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            dst = ImageCms.createProfile("sRGB")
            im = ImageCms.profileToProfile(im, src, dst, outputMode="RGB")
        except Exception:
            pass
    return im.convert("RGB")


def parse_pos(pos: str) -> tuple[float, float]:
    x, y = (float(p.rstrip("%")) / 100 for p in pos.split())
    return x, y


def crop_aspect(im: Image.Image, pos: str) -> Image.Image:
    w, h = im.size
    fx, fy = parse_pos(pos)
    ar = w / h
    if ar > MAX_ASPECT:
        nw = round(h * MAX_ASPECT)
        left = round(min(max(fx * w - nw / 2, 0), w - nw))
        return im.crop((left, 0, left + nw, h))
    if ar < MIN_ASPECT:
        nh = round(w / MIN_ASPECT)
        top = round(min(max(fy * h - nh / 2, 0), h - nh))
        return im.crop((0, top, w, top + nh))
    return im


def encode(im: Image.Image, width: int, q: int, cap: int) -> bytes:
    h = round(im.height * width / im.width)
    small = im.resize((width, h), Image.LANCZOS)
    while True:
        buf = io.BytesIO()
        small.save(buf, "WEBP", quality=q, method=6)
        if buf.tell() <= cap or q <= 40:
            return buf.getvalue()
        q -= 4


def tone(im: Image.Image) -> str:
    mean = sum(g.tobytes()) / (64 * 32)
    g = im.crop((0, int(h * 0.6), w, h)).convert("L").resize((64, 32))
    mean = sum(g.getdata()) / (64 * 32)
    return "dark" if mean < 128 else "light"


def unsplash_meta(pid: str) -> dict:
    key = os.environ.get("UNSPLASH_ACCESS_KEY")
    if not key:
        raise SystemExit(f"unsplash pick {pid}: set UNSPLASH_ACCESS_KEY so the author and licence can be verified")
    h = {"Authorization": f"Client-ID {key}", "Accept-Version": "v1"}
    p = get(f"https://api.unsplash.com/photos/{pid}", headers=h).json()
    get(p["links"]["download_location"], headers=h)  # API guideline: count the download
    u = p["user"]
    return {
        "subject": (p.get("alt_description") or p.get("description") or "")[:90],
        "author": u["name"], "authorUrl": u["links"]["html"],
        "source": "unsplash", "sourceUrl": p["links"]["html"],
        "license": "Unsplash License", "licenseUrl": "https://unsplash.com/license",
        "_download": p["urls"]["raw"] + "&w=1600&q=85&fm=jpg",
    }


def load_image(url: str) -> Image.Image:
    """Download and decode, retrying truncated transfers."""
    for attempt in range(3):
        try:
            im = Image.open(io.BytesIO(get(url).content))
            return to_srgb(ImageOps.exif_transpose(im))
        except OSError:
            if attempt == 2:
                raise
            time.sleep(3 * (attempt + 1))
    raise RuntimeError("unreachable")


def cmd_fetch(args) -> None:
    picks = json.loads(PICKS.read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    old = json.loads(CREDITS.read_text())["photos"] if CREDITS.exists() else {}
    fetched = json.loads(FETCHED.read_text()) if FETCHED.exists() else {}
    force = set(args.force or [])
    commons_titles = [p["commons"] for c, p in picks.items() if "commons" in p]
    info = commons_info(commons_titles)
    photos: dict[str, dict] = {}
    for code, pick in sorted(picks.items()):
        main, small = OUT / f"{code}.webp", OUT / f"{code}-400.webp"
        if "skip" in pick:
            for f in (main, small):
                f.unlink(missing_ok=True)
            continue
        pos = pick.get("position", "50% 50%")
        have = main.exists() and small.exists() and code in old
        same = have and fetched.get(code) == (pick.get("commons") or pick.get("unsplash"))
        if same and not args.force_all and code not in force:
            entry = dict(old[code])
            entry["position"] = pos
            photos[code] = entry
            continue
        if "commons" in pick:
            page = info.get(pick["commons"])
            if not page:
                print(f"{code}: {pick['commons']} not found", file=sys.stderr)
                continue
            meta = describe(page)
            if not meta:
                print(f"{code}: licence not allowed", file=sys.stderr)
                continue
        else:
            meta = unsplash_meta(pick["unsplash"])
        if pick.get("subject"):
            meta["subject"] = pick["subject"]
        try:
            im = load_image(meta["_download"])
        except Exception as e:
            print(f"{code}: download failed: {e}", file=sys.stderr)
            continue
        im = crop_aspect(im, pos)
        main.write_bytes(encode(im, MAIN_W, MAIN_Q, MAIN_MAX))
        small.write_bytes(encode(im, SMALL_W, SMALL_Q, SMALL_MAX))
        entry = {k: v for k, v in meta.items() if not k.startswith("_")}
        entry["position"] = pos
        entry["tone"] = tone(im)
        fetched[code] = pick.get("commons") or pick.get("unsplash")
        photos[code] = entry
        print(f"{code}: {main.stat().st_size // 1024} KB / {small.stat().st_size // 1024} KB  {entry['license']}  {entry['author']}")
        time.sleep(0.3)
    # Only list codes whose files exist.
    photos = {c: e for c, e in photos.items() if (OUT / f"{c}.webp").exists() and (OUT / f"{c}-400.webp").exists()}
    for f in OUT.glob("*.webp"):
        if f.name.split("-")[0].split(".")[0] not in photos:
            f.unlink()
    CREDITS.write_text(json.dumps({"version": 1, "generated": date.today().isoformat(), "photos": photos},
                                  indent=1, ensure_ascii=False) + "\n")
    FETCHED.write_text(json.dumps({c: fetched[c] for c in sorted(photos) if c in fetched}, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(photos)} photos, credits written")


def cmd_contact(args) -> None:
    files = sorted(OUT.glob("*-400.webp"))
    cells = [(f.name.split("-")[0], Image.open(f)) for f in files]
    sheet(cells, 10, 240, 160, Path(args.out))
    print("wrote", args.out, len(cells))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("suggest")
    s.add_argument("codes", nargs="*")
    s.add_argument("--n", type=int, default=6)
    s.add_argument("--query")
    s.add_argument("--sheet", help="contact sheet base name")
    s.add_argument("--out", default="photo-candidates")
    s.set_defaults(fn=cmd_suggest)
    f = sub.add_parser("fetch")
    f.add_argument("--force", nargs="*")
    f.add_argument("--force-all", action="store_true")
    f.set_defaults(fn=cmd_fetch)
    c = sub.add_parser("contact")
    c.add_argument("--out", default="photos-contact.jpg")
    c.set_defaults(fn=cmd_contact)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
