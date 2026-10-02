"""Tests for scripts/build-ground.py with tiny synthetic GTFS zips (no network)."""

import importlib.util
import io
import json
import pathlib
import sys
import zipfile
from datetime import date

import pytest

SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
ROOT = SCRIPTS.parent
GROUND_JSON = ROOT / "public" / "data" / "ground.json"


def _load():
    name = "build_ground"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / "build-ground.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


bg = _load()

TODAY = date(2026, 10, 2)  # a Friday
LO, HI = date(2026, 10, 1), date(2026, 12, 31)


def gtfs(tables: dict[str, str]) -> zipfile.ZipFile:
    """An in-memory GTFS zip from {'stops.txt': 'csv text', ...}."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, text in tables.items():
            z.writestr(name, text.strip() + "\n")
    buf.seek(0)
    return zipfile.ZipFile(buf)


STOPS = """stop_id,stop_name,parent_station
A,Origin,
A1,Origin platform 1,A
B,Destination,
C,Elsewhere,
"""


def corridor(**kw):
    c = {"key": "AAA-1", "feed": "t", "mode": "train", "op": "Op", "product": "short",
         "a": {"stops": ["A"], "name": "Origin", "tz": "Europe/Madrid"},
         "b": {"stops": ["B"], "name": "Destination", "tz": "Europe/Madrid"}}
    c.update(kw)
    return c


def feed(stop_times: str, *, agency_tz="Europe/Madrid", calendar=None, calendar_dates=None,
         routes=None, trips=None, extra=None):
    tables = {
        "agency.txt": f"agency_id,agency_name,agency_timezone\nAG,Agency,{agency_tz}",
        "stops.txt": STOPS,
        "routes.txt": routes or "route_id,agency_id,route_short_name,route_long_name,route_type\nR,AG,AVE,Alta Velocidad,2",
        "trips.txt": trips or "trip_id,route_id,service_id\nT1,R,S\nT2,R,S",
        "calendar.txt": calendar or ("service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
                                     "S,1,1,1,1,1,1,1,20261001,20261231"),
        "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n" + stop_times,
    }
    if calendar_dates:
        tables["calendar_dates.txt"] = calendar_dates
    tables.update(extra or {})
    return gtfs(tables)


def build(z, c=None, today=TODAY):
    c = c or corridor()
    runs = bg.load_feed(z, [c], LO, HI)[c["key"]]
    return bg.build_corridor(c, runs, today)


# ── Reading ─────────────────────────────────────────────────────────────────

def test_strips_padded_headers_and_values_and_unpadded_hours():
    z = feed(" T1 , 7:00:00 , 7:00:00 , A1 , 1 , 0 , 1 \nT1,9:40:00,9:40:00,B,2,1,0",
             trips="trip_id ,route_id , service_id \nT1 ,R ,S ")
    e = build(z)
    assert e["mode"] == "train"
    out = e["out"]
    assert out["wk"] == [[420, 160, 0]] and out["sat"] == [[420, 160, 0]]
    assert out["p"] == ["AVE"] and out["from"] == "Origin" and out["tz"] == "Europe/Madrid"
    assert "back" not in e


def test_child_platform_counts_as_its_station():
    z = feed("T1,08:00:00,08:00:00,A1,1,0,0\nT1,09:00:00,09:00:00,B,2,0,0")
    assert build(z)["out"]["wk"][0][:2] == [480, 60]


def test_both_directions_from_one_pass():
    z = feed("T1,08:00:00,08:00:00,A,1,0,0\nT1,09:00:00,09:00:00,B,2,0,0\n"
             "T2,10:00:00,10:00:00,B,1,0,0\nT2,11:15:00,11:15:00,A,2,0,0")
    e = build(z)
    assert e["out"]["wk"] == [[480, 60, 0]]
    assert e["back"]["wk"] == [[600, 75, 0]]
    assert e["back"]["from"] == "Destination" and e["back"]["to"] == "Origin"


def test_utc_agency_converted_to_local_time_at_origin_across_dst():
    # 06:00 UTC is 08:00 in Madrid (CEST) until Oct 25, then 07:00 (CET).
    z = feed("T1,06:00:00,06:00:00,A,1,0,0\nT1,07:00:00,07:00:00,B,2,0,0", agency_tz="UTC")
    runs = bg.load_feed(z, [corridor()], LO, HI)["AAA-1"]["out"]
    by = {d.date(): d.hour for d, _, _ in runs}
    assert by[date(2026, 10, 20)] == 8 and by[date(2026, 11, 2)] == 7


def test_after_midnight_times_land_on_the_next_local_date():
    z = feed("T1,24:30:00,24:30:00,A,1,0,0\nT1,26:00:00,26:00:00,B,2,0,0",
             calendar="service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
                      "S,0,0,0,0,1,0,0,20261001,20261231")
    e = build(z)
    # Runs on Friday service days, so leaves 00:30 on Saturday mornings.
    assert e["out"]["sat"] == [[30, 90, 0]]
    assert e["out"]["wk"] == [] and e["out"]["sun"] == []


def test_calendar_dates_add_and_remove():
    cal = ("service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
           "S,1,1,1,1,1,0,0,20261001,20261231")
    z = feed("T1,08:00:00,08:00:00,A,1,0,0\nT1,09:00:00,09:00:00,B,2,0,0", calendar=cal,
             calendar_dates="service_id,date,exception_type\nS,20261014,2\nS,20261017,1\nX,20261018,1")
    runs = bg.load_feed(z, [corridor()], LO, HI)["AAA-1"]["out"]
    days = {d.date() for d, _, _ in runs}
    assert date(2026, 10, 14) not in days
    assert date(2026, 10, 17) in days
    assert date(2026, 10, 18) not in days
    e = build(z)
    assert "2026-10-14" in e["out"]["x"]  # a weekday inside validity with nothing running


def test_service_only_in_calendar_dates():
    z = feed("T1,08:00:00,08:00:00,A,1,0,0\nT1,09:00:00,09:00:00,B,2,0,0",
             calendar="service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
             calendar_dates="service_id,date,exception_type\n" + "\n".join(
                 f"S,202610{d:02d},1" for d in range(1, 32)))
    e = build(z)
    assert e["out"]["wk"] == [[480, 60, 0]]
    assert e["out"]["validTo"] == "2026-10-31"


def test_duplicate_trips_are_one_departure_with_the_shortest_ride():
    z = feed("T1,08:00:00,08:00:00,A,1,0,0\nT1,09:10:00,09:10:00,B,2,0,0\n"
             "T2,08:00:00,08:00:00,A,1,0,0\nT2,09:00:00,09:00:00,B,2,0,0")
    assert build(z)["out"]["wk"] == [[480, 60, 0]]


def test_slow_trains_dropped():
    # Fastest 60: keep up to max(90, 120) = 120 minutes.
    z = feed("T1,08:00:00,08:00:00,A,1,0,0\nT1,09:00:00,09:00:00,B,2,0,0\n"
             "T2,10:00:00,10:00:00,A,1,0,0\nT2,12:00:00,12:00:00,B,2,0,0\n"
             "T3,13:00:00,13:00:00,A,1,0,0\nT3,15:30:00,15:30:00,B,2,0,0",
             trips="trip_id,route_id,service_id\nT1,R,S\nT2,R,S\nT3,R,S")
    assert [d[:2] for d in build(z)["out"]["wk"]] == [[480, 60], [600, 120]]


def test_pickup_and_drop_off_not_available_are_honoured():
    # T1 does not pick up at A; T2 does not set down at B.
    z = feed("T1,08:00:00,08:00:00,A,1,1,0\nT1,09:00:00,09:00:00,B,2,0,0\n"
             "T2,10:00:00,10:00:00,A,1,0,0\nT2,11:00:00,11:00:00,B,2,0,1")
    assert build(z) is None


def test_boards_at_the_last_origin_call_before_the_destination():
    # A loop that calls at A, C, A again, then B: board at the second A call.
    z = feed("T1,08:00:00,08:00:00,A,1,0,0\nT1,08:20:00,08:20:00,C,2,0,0\n"
             "T1,08:40:00,08:45:00,A1,3,0,0\nT1,09:30:00,09:30:00,B,4,0,0")
    assert build(z)["out"]["wk"] == [[525, 45, 0]]


def test_bus_routes_skipped_on_train_corridors_but_kept_on_bus_ones():
    routes = "route_id,agency_id,route_short_name,route_long_name,route_type\nR,AG,BUS,Autobus,3"
    st = "T1,08:00:00,08:00:00,A,1,0,0\nT1,09:00:00,09:00:00,B,2,0,0"
    assert build(feed(st, routes=routes)) is None
    e = build(feed(st, routes=routes), corridor(mode="bus", product="name:Coach Co"))
    assert e["out"]["p"] == ["Coach Co"]


def test_agency_filter():
    st = "T1,08:00:00,08:00:00,A,1,0,0\nT1,09:00:00,09:00:00,B,2,0,0"
    assert build(feed(st), corridor(agency="Other")) is None
    assert build(feed(st), corridor(agency="Agen"))["out"]["wk"]


def test_frequencies_expand():
    z = feed("T1,08:00:00,08:00:00,A,1,0,0\nT1,08:30:00,08:30:00,B,2,0,0",
             extra={"frequencies.txt": "trip_id,start_time,end_time,headway_secs\nT1,08:00:00,10:00:00,3600"})
    assert build(z)["out"]["wk"] == [[480, 30, 0], [540, 30, 0]]


def test_frequencies_count_from_the_trips_first_stop_not_the_pinned_one():
    # The trip starts at C (07:30); the headways are for C, so A is reached 30 min after each start.
    z = feed("T1,07:30:00,07:30:00,C,1,0,0\nT1,08:00:00,08:00:00,A,2,0,0\nT1,08:30:00,08:30:00,B,3,0,0",
             extra={"frequencies.txt": "trip_id,start_time,end_time,headway_secs\nT1,07:30:00,09:30:00,3600"})
    assert build(z)["out"]["wk"] == [[480, 30, 0], [540, 30, 0]]


def test_service_day_arithmetic_is_elapsed_time_on_dst_days():
    # 2026-10-25: Europe/Madrid falls back at 03:00. 01:30 elapsed from noon-minus-12h (23:00 UTC
    # the day before) is 00:30 UTC = 02:30 CEST, not a wall-clock 01:30.
    c = corridor()
    z = feed("T1,01:30:00,01:30:00,A,1,0,0\nT1,02:30:00,02:30:00,B,2,0,0",
             calendar="service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
                      "S,0,0,0,0,0,0,1,20261025,20261025")
    runs = bg.load_feed(z, [c], LO, HI)[c["key"]]["out"]
    assert [(r[0].hour, r[0].minute) for r in runs] == [(2, 30)]


def test_missing_pinned_stop_fails_loudly():
    z = feed("T1,08:00:00,08:00:00,A,1,0,0\nT1,09:00:00,09:00:00,B,2,0,0")
    c = corridor(b={"stops": ["GONE"], "name": "Gone", "tz": "Europe/Madrid"})
    with pytest.raises(bg.PinnedStopMissing, match="GONE"):
        bg.load_feed(z, [c], LO, HI)


def test_products_from_stop_prefix_and_first_word():
    assert bg.stop_product("StopPoint:OCETGV INOUI-87271494") == "TGV INOUI"
    assert bg.stop_product("StopArea:OCE87271494") == ""
    c = {"mode": "train", "product": "stop", "rename": {"Train TER": "TER"}}
    assert bg.product_of(c, "", "", "StopPoint:OCETrain TER-1") == "TER"
    assert bg.product_of(c, "", "", "StopPoint:OCECar TER-1") is None
    assert bg.product_of({"mode": "train", "product": "word"}, "ICE 41", "", "") == "ICE"
    assert bg.product_of({"mode": "train", "product": "long"}, "FR", "Frecciarossa", "") == "Frecciarossa"


# ── Typical days and validity ───────────────────────────────────────────────

def test_departure_kept_when_it_runs_on_at_least_half_of_the_days():
    from datetime import datetime, timedelta
    runs = []
    for i in range(1, 29):
        d = TODAY + timedelta(days=i)
        runs.append((datetime(d.year, d.month, d.day, 8), 60, "X"))
        if i % 3 == 0:  # a third of days only
            runs.append((datetime(d.year, d.month, d.day, 12), 60, "X"))
    t = bg.typical(bg.by_local_date(runs), TODAY)
    assert [m for m, _, _ in t["wk"]] == [480]


def test_retimed_departures_one_minute_apart_merge():
    from datetime import datetime, timedelta
    runs = []
    for i in range(1, 29):
        d = TODAY + timedelta(days=i)
        runs.append((datetime(d.year, d.month, d.day, 7, 3 if i <= 14 else 4), 24, "TER"))
    t = bg.typical(bg.by_local_date(runs), TODAY)
    assert len(t["wk"]) == 1


def test_validity_ignores_a_thin_tail_and_lists_empty_dates():
    from datetime import datetime, timedelta
    runs = []
    d = TODAY
    while d <= date(2027, 3, 1):
        n = 10 if d <= date(2026, 12, 12) else 1  # a calendar that runs on with one train
        if d != date(2026, 12, 25):
            for k in range(n):
                runs.append((datetime(d.year, d.month, d.day, 6 + k), 60, "X"))
        d += timedelta(days=1)
    out = bg.build_direction(runs, TODAY, {"src": "t"})
    assert out["validFrom"] == "2026-10-02" and out["validTo"] == "2026-12-12"
    assert out.get("x") is None
    runs2 = [r for r in runs if r[0].date() != date(2026, 11, 11)]
    assert bg.build_direction(runs2, TODAY, {"src": "t"})["x"] == ["2026-11-11"]


def test_validity_ends_where_the_times_change_and_lists_holiday_services():
    from datetime import datetime, timedelta
    runs = []
    d = TODAY
    while d <= date(2027, 3, 1):
        # Same number of trains all along, but retimed by 30 min from Dec 13 (a new timetable).
        shift = 30 if d >= date(2026, 12, 13) else 0
        hours = [6, 9] if d == date(2026, 11, 11) else range(6, 16)  # a holiday with a reduced service
        for k in hours:
            runs.append((datetime(d.year, d.month, d.day, k) + timedelta(minutes=shift), 60, "X"))
        d += timedelta(days=1)
    out = bg.build_direction(runs, TODAY, {"src": "t"})
    assert out["validTo"] == "2026-12-12"
    assert out["x"] == ["2026-11-11"]


def test_more_no_service_dates_than_listed_cut_validity():
    from datetime import datetime, timedelta
    runs = []
    d = TODAY
    while d <= date(2027, 6, 1):
        closed = date(2027, 1, 10) <= d <= date(2027, 3, 10)  # a seasonal closure, 60 days
        if not closed:
            runs.append((datetime(d.year, d.month, d.day, 8), 60, "X"))
        d += timedelta(days=1)
    out = bg.build_direction(runs, TODAY, {"src": "t"})
    assert len(out["x"]) == bg.MAX_NO_SERVICE
    assert out["validTo"] == "2027-02-08"  # the day before the first date that could not be listed
    assert out["x"][-1] == "2027-02-08"


def test_nothing_in_the_scan_window_gives_none():
    from datetime import datetime
    assert bg.build_direction([(datetime(2027, 6, 1, 8), 60, "X")], TODAY, {}) is None


# ── Assemble and write ──────────────────────────────────────────────────────

def entry(src, valid_to):
    d = {"src": src, "validFrom": "2026-01-01", "validTo": valid_to, "p": [], "wk": [], "sat": [], "sun": []}
    return {"mode": "train", "out": d}


def test_failed_feed_keeps_previous_corridors_while_valid():
    prev = {"sources": {"old": {"name": "Old"}, "gone": {"name": "Gone"}},
            "corridors": {"K1": entry("old", "2026-12-01"), "K2": entry("gone", "2026-09-01")}}
    doc = bg.assemble({"K3": entry("renfe", "2026-12-20")}, {"renfe": "2026-10-01"}, prev, {"old", "gone"}, TODAY)
    assert set(doc["corridors"]) == {"K1", "K3"}
    assert set(doc["sources"]) == {"old", "renfe"}
    assert doc["license"] == "ODbL-1.0" and doc["v"] == 1
    assert doc["sources"]["renfe"]["licence"] == "CC BY 4.0"


def test_same_content_ignores_dates():
    a = {"builtAt": "2026-10-01", "sources": {"s": {"fetched": "2026-10-01", "name": "S"}}, "corridors": {}}
    b = {"builtAt": "2026-10-02", "sources": {"s": {"fetched": "2026-10-02", "name": "S"}}, "corridors": {}}
    assert bg.same_content(a, b)
    b["corridors"] = {"K": {}}
    assert not bg.same_content(a, b)


def test_optional_feeds_need_include():
    assert "cp" not in bg.selected_feeds([], [], [])
    assert "trenitalia" in bg.selected_feeds([], ["trenitalia"], [])
    assert bg.selected_feeds(["renfe"], [], []) == ["renfe"]
    assert "flix" not in bg.selected_feeds([], [], ["flix"])
    with pytest.raises(SystemExit):
        bg.selected_feeds(["nope"], [], [])


def test_main_offline_writes_a_file(tmp_path, monkeypatch):
    z = tmp_path / "cache" / "t.zip"
    z.parent.mkdir()
    src = feed("T1,08:00:00,08:00:00,A,1,0,0\nT1,09:00:00,09:00:00,B,2,0,0")
    with zipfile.ZipFile(z, "w") as w:
        for n in src.namelist():
            w.writestr(n, src.read(n))
    monkeypatch.setitem(bg.FEEDS, "t", {"name": "T", "url": "", "page": "", "licence": "CC BY 4.0",
                                        "licenceUrl": bg.CC_BY, "credit": "T", "optional": True})
    monkeypatch.setattr(bg, "CORRIDORS", [corridor()])
    out = tmp_path / "ground.json"
    assert bg.main(["--offline", "--cache", str(z.parent), "--only", "t", "--out", str(out),
                    "--today", "2026-10-02"]) == 0
    doc = json.loads(out.read_text())
    assert doc["corridors"]["AAA-1"]["out"]["wk"] == [[480, 60, 0]]
    mtime = out.stat().st_mtime_ns
    assert bg.main(["--offline", "--cache", str(z.parent), "--only", "t", "--out", str(out),
                    "--today", "2026-10-03"]) == 0
    assert out.stat().st_mtime_ns == mtime  # only dates changed: left as is


# ── The committed file ──────────────────────────────────────────────────────

@pytest.mark.skipif(not GROUND_JSON.exists(), reason="ground.json not built")
def test_committed_file_shape():
    doc = json.loads(GROUND_JSON.read_text(encoding="utf-8"))
    assert doc["v"] == 1 and doc["license"] == "ODbL-1.0"
    assert len(GROUND_JSON.read_bytes()) <= bg.MAX_BYTES
    keys = {c["key"] for c in bg.CORRIDORS}
    for key, e in doc["corridors"].items():
        assert key in keys
        for d in ("out", "back"):
            if d not in e:
                continue
            x = e[d]
            assert x["src"] in doc["sources"]
            assert x["validFrom"] <= x["validTo"]
            for g in ("wk", "sat", "sun"):
                assert all(0 <= m < 1440 and r > 0 and 0 <= p < len(x["p"]) for m, r, p in x[g])
                assert [m for m, _, _ in x[g]] == sorted(m for m, _, _ in x[g])
    for s in doc["sources"].values():
        assert s["licence"] and s["credit"] and s["url"]
