"""Tests for scripts/build-climate.py: parsing, aggregation, resume and quota stop (no network)."""

import importlib.util
import json
import pathlib
import sys

import pytest

SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
ROOT = SCRIPTS.parent
CLIMATE_JSON = ROOT / "public" / "data" / "climate.json"


def _load():
    name = "build_climate"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / "build-climate.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


bc = _load()


def canned(tmax=20.0, tmin=10.0, precip=(0.0,) * 14, days=14):
    """An Open-Meteo archive answer for one 14-day window."""
    return {
        "latitude": 38.77, "longitude": -9.13,
        "daily": {
            "time": [f"2024-10-{d:02d}" for d in range(8, 8 + days)],
            "temperature_2m_max": [tmax] * days,
            "temperature_2m_min": [tmin] * days,
            "precipitation_sum": list(precip)[:days],
        },
    }


# ── Destinations ────────────────────────────────────────────────────────────

def test_parses_every_destination_and_skips_hubs():
    dests = bc.parse_destinations((ROOT / "src/app/data/destinations.ts").read_text(encoding="utf-8"))
    codes = {d["code"] for d in dests}
    assert len(dests) >= 150
    assert {"LIS", "FLL", "LGA", "OPO"} <= codes
    assert not {"YUL", "YYZ", "YVR"} & codes
    lis = next(d for d in dests if d["code"] == "LIS")
    assert lis["type"] == "City" and abs(lis["lat"] - 38.77) < 0.01


def test_parse_ignores_hub_typed_entries():
    ts = ("export const DESTINATIONS: Destination[] = [\n"
          "  { city: 'A', code: 'AAA', lat: 1.5, lng: -2, type: 'Sun' },\n"
          "  { city: 'H', code: 'HHH', lat: 1, lng: 2, type: 'Hub' },\n"
          "];")
    assert bc.parse_destinations(ts) == [{"code": "AAA", "lat": 1.5, "lng": -2.0, "type": "Sun"}]


def test_request_url_is_the_days_8_to_21_window():
    url = bc.request_url(38.77, -9.13, 2023, 2)
    assert "start_date=2023-02-08" in url and "end_date=2023-02-21" in url
    assert "models=era5" in url and "precipitation_sum" in url and url.startswith("https://archive-api.open-meteo.com/")


# ── Aggregation ─────────────────────────────────────────────────────────────

def test_window_stats_and_the_14_day_scaling():
    precip = [2.0] * 7 + [0.5] * 7  # 7 wet days, 17.5 mm in 14 days
    s = bc.window_stats(canned(25.4, 14.6, precip))
    assert s == {"tmax": 25.4, "tmin": 14.6, "precip_total": 17.5, "wet_days": 7}
    m = bc.aggregate_month([s] * 5, 10)
    # October has 31 days: 17.5 * 31/14 = 38.75 -> 39 mm; 7 * 31/14 = 15.5 -> 16 days (round half even gives 16)
    assert m == {"tmax": 25, "tmin": 15, "precip": 39, "wet": 16}
    feb = bc.aggregate_month([s] * 5, 2)  # 28 days in 2025: exactly double
    assert feb["precip"] == 35 and feb["wet"] == 14


def test_needs_three_years_and_complete_windows():
    s = bc.window_stats(canned())
    assert bc.aggregate_month([s, s, None, None, None], 1) is None
    assert bc.aggregate_month([s, s, s, None, None], 1) is not None
    assert bc.window_stats(canned(days=5)) is None
    assert bc.window_stats({}) is None


def test_location_needs_all_twelve_months():
    m = {"tmax": 1, "tmin": 0, "precip": 2, "wet": 1}
    assert bc.location_normals([m] * 11 + [None]) is None
    n = bc.location_normals([m] * 12)
    assert set(n) == {"tmax", "tmin", "precip", "wet"} and all(len(v) == 12 for v in n.values())


# ── Driver: cache, resume, quota ────────────────────────────────────────────

DEST = {"code": "LIS", "lat": 38.77, "lng": -9.13, "type": "City"}


def test_run_builds_and_caches_then_resumes_without_calls(tmp_path):
    calls = []

    def get(url):
        calls.append(url)
        return canned()

    codes, stopped = bc.run([DEST], tmp_path, get=get, log=lambda *_: None)
    assert not stopped and len(calls) == 60
    assert codes["LIS"]["tmax"] == [20] * 12
    assert len(list(tmp_path.glob("LIS-*.json"))) == 60

    def no_net(url):
        raise AssertionError("should come from the cache")

    again, _ = bc.run([DEST], tmp_path, get=no_net, log=lambda *_: None)
    assert again == codes


def test_stops_on_429_and_keeps_what_is_complete(tmp_path):
    other = {"code": "OPO", "lat": 41.24, "lng": -8.68, "type": "City"}
    n = {"calls": 0}

    def get(url):
        n["calls"] += 1
        if n["calls"] > 70:  # LIS (60 calls) completes, OPO hits the limit
            raise bc.QuotaError("HTTP 429")
        return canned()

    codes, stopped = bc.run([DEST, other], tmp_path, get=get, log=lambda *_: None)
    assert stopped
    assert list(codes) == ["LIS"]
    out = tmp_path / "climate.json"
    bc.write_file(out, bc.build_file(codes, 2))
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["done"] == 1 and data["total"] == 2
    # The OPO windows fetched before the stop are cached for the next run.
    assert len(list(tmp_path.glob("OPO-*.json"))) == 10


def test_a_quota_message_in_the_body_also_stops(tmp_path):
    def get(url):
        return {"error": True, "reason": "Daily API request limit exceeded. Please try again tomorrow."}

    codes, stopped = bc.run([DEST], tmp_path, get=get, log=lambda *_: None)
    assert stopped and codes == {}


def test_build_file_shape():
    data = bc.build_file({"LIS": {"tmax": [1] * 12, "tmin": [0] * 12, "precip": [3] * 12, "wet": [1] * 12}}, 157)
    assert data["v"] == 1 and data["license"] == "CC BY 4.0"
    assert "Open-Meteo" in data["attribution"] and "Copernicus" in data["attribution"]
    assert data["period"] == "2021–2025" and data["method"] == "Mean of days 8–21 of each month"
    assert data["done"] == 1 and data["total"] == 157


# ── The committed file ──────────────────────────────────────────────────────

@pytest.mark.skipif(not CLIMATE_JSON.exists(), reason="climate.json not built")
def test_committed_climate_json_budget_and_shape():
    raw = CLIMATE_JSON.read_bytes()
    assert len(raw) <= 60 * 1024
    data = json.loads(raw)
    assert data["v"] == 1 and data["license"] == "CC BY 4.0"
    assert 0 < data["done"] <= data["total"]
    assert len(data["codes"]) == data["done"]
    for code, c in data["codes"].items():
        assert len(code) == 3
        for k in ("tmax", "tmin", "precip", "wet"):
            assert len(c[k]) == 12, (code, k)
        assert all(lo <= hi for lo, hi in zip(c["tmin"], c["tmax"])), code


def test_order_first_and_offline(tmp_path):
    dests = [{"code": c, "lat": 0, "lng": 0, "type": "Sun"} for c in ("AAA", "BBB", "CCC")]
    assert [d["code"] for d in bc.order_first(dests, "ccc, BBB")] == ["CCC", "BBB", "AAA"]
    bc.run([DEST], tmp_path, get=lambda url: canned(), log=lambda *_: None)
    other = {"code": "OPO", "lat": 41.24, "lng": -8.68, "type": "City"}
    codes, stopped = bc.run([DEST, other], tmp_path, get=bc.offline_get, log=lambda *_: None)
    assert not stopped and list(codes) == ["LIS"]


def test_partial_run_merges_into_the_existing_file(tmp_path, monkeypatch):
    out = tmp_path / "climate.json"
    old = {"OLD": {"m": 1}, "LIS": {"m": "stale"}}
    bc.write_file(out, bc.build_file(old, 5))
    monkeypatch.setattr(bc, "parse_destinations", lambda text: [DEST, {**DEST, "code": "OLD"}])
    monkeypatch.setattr(bc, "run", lambda *a, **k: ({"LIS": {"m": "new"}}, True))
    assert bc.main(["--out", str(out), "--cache", str(tmp_path / "c")]) == 0
    codes = json.loads(out.read_text(encoding="utf-8"))["codes"]
    assert codes == {"OLD": {"m": 1}, "LIS": {"m": "new"}}
    # A code that left the destination list is not resurrected; total is the full list.
    monkeypatch.setattr(bc, "parse_destinations", lambda text: [DEST])
    assert bc.main(["--out", str(out), "--cache", str(tmp_path / "c")]) == 0
    data = json.loads(out.read_text(encoding="utf-8"))
    assert list(data["codes"]) == ["LIS"] and data["total"] == 1
