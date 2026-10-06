"""Tests for build-advisories.py, build-fx.py, build-holidays.py and _refdata.py (fixtures, no network)."""

import datetime as dt
import importlib.util
import io
import json
import pathlib
import sys
import urllib.error

import pytest

SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import _refdata as rd  # noqa: E402


def _load(name, file):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / file)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


adv = _load("build_advisories", "build-advisories.py")
fx = _load("build_fx", "build-fx.py")
hol = _load("build_holidays", "build-holidays.py")

NOW = dt.datetime(2026, 10, 6, 12, 0, tzinfo=dt.timezone.utc)

DEST_TS = """
export const DESTINATIONS: Destination[] = [
  { city: 'Lisbon', country: 'Portugal', code: 'LIS', iso2: 'PT', tz: 'Europe/Lisbon', lat: 38.7, lng: -9.1, region: 'Europe', type: 'City' },
  { city: 'Porto', country: 'Portugal', code: 'OPO', iso2: 'PT', tz: 'Europe/Lisbon', lat: 41.2, lng: -8.6, region: 'Europe', type: 'City' },
  { city: 'Cancun', country: 'Mexico', code: 'CUN', iso2: 'MX', tz: 'America/Cancun', lat: 21.0, lng: -86.8, region: 'Mexico', type: 'Sun' },
  { city: 'Toronto', country: 'Canada', code: 'YYZ', iso2: 'CA', tz: 'America/Toronto', lat: 43.6, lng: -79.6, region: 'Canada', type: 'Hub' },
  { city: 'Tokyo', country: 'Japan', code: 'HND', iso2: 'JP', tz: 'Asia/Tokyo', lat: 35.5, lng: 139.7, region: 'Asia', type: 'City' },
];
export const HUBS = [
  { city: 'Paris', country: 'France', code: 'CDG', iso2: 'FR', lat: 49, lng: 2 },
];
"""
CUR_TS = "const CURRENCY: Readonly<Record<string, string>> = {\n  CA: 'CAD', JP: 'JPY', MX: 'MXN', PT: 'EUR',\n};\n"


def test_destination_countries_skip_hubs_and_home():
    assert rd.parse_destination_countries(DEST_TS) == ["JP", "MX", "PT"]


def test_currency_table():
    assert rd.parse_currency_table(CUR_TS) == {"CA": "CAD", "JP": "JPY", "MX": "MXN", "PT": "EUR"}


def test_real_sources_parse():
    countries = rd.destination_countries()
    assert len(countries) > 30 and "CA" not in countries
    table = rd.currency_table()
    assert all(c in table for c in ("ES", "JP", "MX"))
    assert len(fx.wanted_currencies(table, countries)) > 15


# ── get_json ────────────────────────────────────────────────────────────────

class Res:
    def __init__(self, body, status=200):
        self.body, self.status = body, status

    def read(self):
        return self.body.encode()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def http_error(code):
    return urllib.error.HTTPError("http://x", code, "err", {}, io.BytesIO(b""))


def test_get_json_retries_5xx_then_succeeds():
    calls = []

    def opener(req, timeout):
        calls.append(1)
        if len(calls) < 3:
            raise http_error(503)
        return Res('{"ok": 1}')

    assert rd.get_json("http://x", opener=opener, sleep=lambda s: None) == {"ok": 1}
    assert len(calls) == 3


def test_get_json_4xx_is_final_and_204_is_none():
    def nf(req, timeout):
        raise http_error(404)

    with pytest.raises(rd.Final):
        rd.get_json("http://x", opener=nf, sleep=lambda s: None)
    assert rd.get_json("http://x", opener=lambda r, timeout: Res("", 204), sleep=lambda s: None) is None


def test_get_json_gives_up():
    def boom(req, timeout):
        raise urllib.error.URLError("down")

    with pytest.raises(RuntimeError):
        rd.get_json("http://x", tries=2, opener=boom, sleep=lambda s: None)


# ── advisories ──────────────────────────────────────────────────────────────

def feed(entries):
    return {"metadata": {}, "data": entries}


def entry(state, text=None, slug="portugal", date="2026-09-30 14:02:11"):
    eng = {"name": "x", "url-slug": slug, "date-published": {"asp": "x", "date": date}}
    if text:
        eng["advisory-text"] = text
    return {"advisory-state": state, "eng": eng}


def test_advisory_build():
    f = feed({
        "PT": entry(0, "Take normal security precautions"),
        "MX": entry(1, "  Exercise a high degree\n of caution ", "mexico"),
        "JP": entry(2, None, "japan"),
        "ZZ": entry(3),
    })
    out = adv.build(f, ["JP", "MX", "PT"], NOW)
    assert out["generatedAt"] == "2026-10-06T12:00:00Z"
    assert out["countries"]["MX"] == {"level": 1, "text": "Exercise a high degree of caution",
                                       "updated": "2026-09-30", "url": "https://travel.gc.ca/destinations/mexico"}
    assert out["countries"]["JP"]["text"] == "Avoid non-essential travel"
    assert "ZZ" not in out["countries"]


def test_advisory_bad_entries_dropped_and_url_sanitised():
    f = feed({"PT": entry(0, slug="../evil"), "MX": entry("x"), "JP": entry(7), "FR": "nope"})
    out = adv.build(f, ["PT"], NOW)
    assert out["countries"]["PT"]["url"] == adv.FALLBACK_URL
    assert adv.parse_country(entry(1, date="garbage"))["level"] == 1
    assert "updated" not in adv.parse_country(entry(1, date="garbage"))
    assert adv.parse_country(entry(True)) is None


def test_advisory_gate(tmp_path):
    f = feed({"PT": entry(0)})
    with pytest.raises(ValueError):
        adv.build(f, ["PT", "MX", "JP"], NOW)
    with pytest.raises(ValueError):
        adv.build({"nope": 1}, ["PT"], NOW)
    # CLI: refuses and writes nothing
    src = tmp_path / "feed.json"
    src.write_text(json.dumps(f))
    out = tmp_path / "advisories.json"
    assert adv.main(["--input", str(src), "--out", str(out)]) == 1
    assert not out.exists()


# ── fx ──────────────────────────────────────────────────────────────────────

def test_fx_build_and_missing_currencies():
    codes = fx.wanted_currencies({"PT": "EUR", "JP": "JPY", "MX": "MXN", "CA": "CAD", "DO": "DOP"}, ["PT", "JP", "MX", "DO", "CA"])
    assert codes == ["DOP", "EUR", "JPY", "MXN"]
    ans = {"amount": 1, "base": "CAD", "date": "2026-10-02", "rates": {"EUR": 0.6612345678, "JPY": 108.2, "MXN": 13.1}}
    out = fx.build(ans, codes)
    assert out == {"date": "2026-10-02", "source": fx.SOURCE, "base": "CAD",
                   "rates": {"EUR": 0.661235, "JPY": 108.2, "MXN": 13.1}}
    assert fx.request_url(["EUR", "JPY"]).endswith("?base=CAD&symbols=EUR,JPY")


def test_fx_gate():
    for bad in (None, {"base": "USD", "date": "2026-10-02", "rates": {}}, {"base": "CAD", "date": "x", "rates": {}},
                {"base": "CAD", "date": "2026-10-02", "rates": {"EUR": 0.6}}, {"base": "CAD", "date": "2026-10-02", "rates": {"EUR": -1, "JPY": 0}}):
        with pytest.raises(ValueError):
            fx.build(bad, ["EUR", "JPY", "MXN"])


# ── holidays ────────────────────────────────────────────────────────────────

def row(date, name="Fiesta", local="Fiesta Local", glob=True):
    return {"date": date, "localName": local, "name": name, "countryCode": "ES", "global": glob, "types": ["Public"]}


def test_parse_rows_filters_and_orders():
    raw = [row("2026-12-25", "Christmas"), row("2026-10-12", "National Day", "Fiesta Nacional"),
           row("2027-01-01"), {"date": "bad", "name": "x"}, "x", row("2026-05-01", glob=False)]
    out = hol.parse_rows(raw, 2026)
    assert [r["date"] for r in out] == ["2026-05-01", "2026-10-12", "2026-12-25"]
    assert out[1] == {"date": "2026-10-12", "name": "National Day", "localName": "Fiesta Nacional", "global": True}
    assert out[0]["global"] is False
    assert hol.parse_rows(None, 2026) == []


def fake_get(table):
    def get(url):
        key = url.rsplit("/", 2)
        y, iso = key[1], key[2]
        v = table.get((iso, int(y)), [])
        if isinstance(v, Exception):
            raise v
        return v
    return get


def test_holidays_build_gate_and_uncovered_country():
    table = {("ES", 2026): [row("2026-10-12")], ("ES", 2027): [row("2027-01-01")],
             ("FR", 2026): [row("2026-11-01")], ("FR", 2027): [],
             ("XX", 2026): rd.Final("404"), ("XX", 2027): rd.Final("404")}
    # 2 of 3 is under the gate
    with pytest.raises(ValueError):
        hol.build(["ES", "FR", "XX"], [2026, 2027], fake_get(table), now=NOW)
    out = hol.build(["ES", "FR"], [2026, 2027], fake_get(table), now=NOW)
    assert out["years"] == [2026, 2027]
    assert [r["date"] for r in out["countries"]["ES"]] == ["2026-10-12", "2027-01-01"]
    assert len(out["countries"]["FR"]) == 1


def test_holidays_failed_country_keeps_previous_rows():
    old = {"years": [2026, 2027], "countries": {"ES": [{"date": "2026-10-12", "name": "A", "localName": "A", "global": True}]}}
    table = {("ES", 2026): RuntimeError("down"), ("FR", 2026): [row("2026-11-01")], ("FR", 2027): []}
    logs = []
    out = hol.build(["ES", "FR"], [2026, 2027], fake_get(table), old=old, now=NOW, log=logs.append)
    assert out["countries"]["ES"] == old["countries"]["ES"]
    assert any("kept" in m for m in logs)
    # different years in the old file: not reused, gate trips
    with pytest.raises(ValueError):
        hol.build(["ES", "FR"], [2026, 2027], fake_get(table), old={**old, "years": [2025, 2026]}, now=NOW, log=logs.append)
