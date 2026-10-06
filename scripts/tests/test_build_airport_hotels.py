"""Tests for scripts/build-airport-hotels.py with a tiny saved Overpass response (no network)."""

import importlib.util
import json
import pathlib
import sys
from datetime import date

import pytest

SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
ROOT = SCRIPTS.parent


def _load():
    name = "build_airport_hotels"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / "build-airport-hotels.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


bh = _load()
LAT, LNG = 45.47, -73.74  # YUL

RESP = {"elements": [
    {"type": "node", "lat": 45.4705, "lon": -73.7405, "tags": {"tourism": "hotel", "name": "Near Hotel"}},
    {"type": "way", "center": {"lat": 45.48, "lon": -73.75}, "tags": {"tourism": "hotel", "name": "Way  Hotel"}},
    # the same hotel mapped twice (building way + entrance node): counted once
    {"type": "node", "lat": 45.48001, "lon": -73.75001, "tags": {"tourism": "hotel", "name": "way hotel"}},
    {"type": "node", "lat": 45.4706, "lon": -73.7406, "tags": {"tourism": "hostel", "name": "Not a hotel"}},
    {"type": "node", "lat": 45.4707, "lon": -73.7407, "tags": {"tourism": "hotel"}},                 # no name
    {"type": "node", "lat": 45.60, "lon": -73.74, "tags": {"tourism": "hotel", "name": "Too far"}},   # > 3 km
    {"type": "relation", "tags": {"tourism": "hotel", "name": "No position"}},
]}


def test_query_mentions_radius_and_hotel_tag():
    q = bh.overpass_query(LAT, LNG, 3000)
    assert '"tourism"="hotel"' in q and "around:3000,45.47000,-73.74000" in q and "out center" in q


def test_parse_hotels_filters_dedupes_and_sorts_by_distance():
    out = bh.parse_hotels(RESP, LAT, LNG)
    assert [h[0] for h in out] == ["Near Hotel", "Way Hotel"]
    assert out[0][3] < out[1][3] <= 3000
    assert out[0][1:3] == [45.4705, -73.7405]
    assert all(h[3] % 10 == 0 for h in out)


def test_parse_hotels_limit():
    many = {"elements": [{"type": "node", "lat": 45.47 + i * 0.001, "lon": -73.74,
                          "tags": {"tourism": "hotel", "name": f"H{i}"}} for i in range(20)]}
    assert len(bh.parse_hotels(many, LAT, LNG, limit=5)) == 5


def test_parse_airports_and_defaults_cover_hubs_and_gateways():
    ts = ("export const HUBS: Hub[] = [\n  { name: 'Montreal', lat: 45.47, lng: -73.74, code: 'YUL', tz: 'x' },\n];\n"
          "  { city: 'Madrid', code: 'MAD', iso2: 'ES', lat: 40.47, lng: -3.57, region: 'Europe' },\n")
    assert bh.parse_airports(ts) == {"YUL": (45.47, -73.74), "MAD": (40.47, -3.57)}
    assert bh.hub_codes(ts) == ["YUL"]
    d = bh.default_airports()
    assert {"YUL", "YYZ", "YHZ", "MAD"} <= set(d)
    assert all(-90 <= la <= 90 and -180 <= lo <= 180 for la, lo in d.values())


def test_assemble_keeps_previous_for_failed_airports_and_drops_empty():
    prev = {"airports": {"YUL": [["Old", 1, 2, 300]], "YHZ": [["Gone", 1, 2, 300]]}}
    doc = bh.assemble({"YYZ": [["New", 1, 2, 100]], "YOW": []}, {"YUL"}, prev, date(2026, 10, 6))
    assert list(doc["airports"]) == ["YUL", "YYZ"]
    assert doc["license"] == "ODbL-1.0" and "OpenStreetMap" in doc["attribution"] and doc["v"] == 1


def test_main_with_fixture_writes_then_leaves_unchanged(tmp_path, capsys):
    fx = tmp_path / "resp.json"
    fx.write_text(json.dumps(RESP))
    out = tmp_path / "hotels.json"
    assert bh.main(["--out", str(out), "--fixture", str(fx), "--airports", "YUL", "--today", "2026-10-06"]) == 0
    doc = json.loads(out.read_text())
    assert [h[0] for h in doc["airports"]["YUL"]] == ["Near Hotel", "Way Hotel"]
    assert bh.main(["--out", str(out), "--fixture", str(fx), "--airports", "YUL", "--today", "2026-10-07"]) == 0
    assert "unchanged" in capsys.readouterr().out
    assert json.loads(out.read_text())["builtAt"] == "2026-10-06"


def test_main_unknown_airport_exits():
    with pytest.raises(SystemExit):
        bh.main(["--airports", "ZZZ", "--out", "/nonexistent/x.json"])


def test_shipped_file_is_valid_and_small():
    p = ROOT / "public" / "data" / "airport-hotels.json"
    doc = json.loads(p.read_text(encoding="utf-8"))
    assert doc["v"] == 1 and doc["license"] == "ODbL-1.0"
    assert p.stat().st_size <= bh.MAX_BYTES
    for hotels in doc["airports"].values():
        for name, lat, lng, d in hotels:
            assert name and -90 <= lat <= 90 and -180 <= lng <= 180 and 0 <= d <= 3000


def test_overpass_remark_means_failure():
    assert bh.overpass_failed({"remark": "runtime error: Query timed out in \"query\" at line 1"})
    assert bh.overpass_failed({"remark": "runtime error: out of memory"})
    assert not bh.overpass_failed({"elements": []})
    assert not bh.overpass_failed({"remark": "ok"})


def test_every_query_failing_exits_1_and_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(bh, "query_overpass", lambda *a, **k: None)
    monkeypatch.setattr(bh.time, "sleep", lambda s: None)
    out = tmp_path / "h.json"
    out.write_text('{"v":1,"airports":{"YUL":[["Old",1,2,3]]}}\n')
    assert bh.main(["--out", str(out), "--airports", "YUL,YHZ"]) == 1
    assert json.loads(out.read_text())["airports"]["YUL"] == [["Old", 1, 2, 3]]
