"""Tests for scripts/fetch-route-network.py. No network: the opener is injected."""

import importlib.util
import io
import json
import pathlib
import sys
import urllib.parse
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import pytest

SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
FIX = pathlib.Path(__file__).resolve().parent / "fixtures" / "route_network"
REPO = SCRIPTS.parent


def _load():
    name = "fetch_route_network"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / "fetch-route-network.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


rn = _load()
HALIFAX = (FIX / "halifax.wikitext").read_text(encoding="utf-8")
VANCOUVER = (FIX / "vancouver.wikitext").read_text(encoding="utf-8")
TODAY = date(2026, 10, 2)

OA_HEADER = ('"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent",'
             '"iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code",'
             '"gps_code","local_code","home_link","wikipedia_link","keywords"')


def oa_row(code, name, lat, lng, cc, region, town, title):
    link = f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}" if title else ""
    return f'1,"X{code}","medium_airport","{name}",{lat},{lng},0,"NA","{cc}","{region}","{town}","yes",,"{code}",,,,"{link}",'


OA_CSV = "\n".join([
    OA_HEADER,
    oa_row("BOS", "Logan International Airport", 42.36, -71.01, "US", "US-MA", "Boston", "Logan International Airport"),
    oa_row("YDF", "Deer Lake Regional Airport", 49.21, -57.39, "CA", "CA-NL", "Deer Lake", "Deer Lake Regional Airport"),
    oa_row("YQX", "Gander International Airport", 48.94, -54.57, "CA", "CA-NL", "Gander", "Gander International Airport"),
    oa_row("YYR", "Goose Bay Airport", 53.32, -60.43, "CA", "CA-NL", "Goose Bay", "CFB Goose Bay"),
    oa_row("EWR", "Newark Liberty International Airport", 40.69, -74.17, "US", "US-NJ", "Newark", "Newark Liberty International Airport"),
    oa_row("YOW", "Ottawa Macdonald-Cartier International Airport", 45.32, -75.67, "CA", "CA-ON", "Ottawa", "Ottawa Macdonald–Cartier International Airport"),
    oa_row("YYT", "St. John's International Airport", 47.62, -52.75, "CA", "CA-NL", "St. John's", "St. John's International Airport"),
    oa_row("BGI", "Grantley Adams International Airport", 13.07, -59.49, "BB", "BB-01", "Bridgetown", "Grantley Adams International Airport"),
    oa_row("CUN", "Cancún International Airport", 21.04, -86.87, "MX", "MX-ROO", "Cancún", "Cancún International Airport"),
    oa_row("LHR", "London Heathrow Airport", 51.47, -0.46, "GB", "GB-ENG", "London", "Heathrow Airport"),
    oa_row("YUL", "Montreal Trudeau", 45.47, -73.74, "CA", "CA-QC", "Montréal", "Montréal–Trudeau International Airport"),
    oa_row("YYZ", "Toronto Pearson", 43.68, -79.62, "CA", "CA-ON", "Toronto", "Toronto Pearson International Airport"),
    oa_row("BRU", "Brussels Airport", 50.90, 4.48, "BE", "BE-VLG", "Brussels", "Brussels Airport"),
    oa_row("MBJ", "Sangster International Airport", 18.50, -77.91, "JM", "JM-08", "Montego Bay", "Sangster International Airport"),
    oa_row("NAS", "Lynden Pindling International Airport", 25.04, -77.47, "BS", "BS-NP", "Nassau", "Lynden Pindling International Airport"),
    oa_row("YVR", "Vancouver International Airport", 49.19, -123.18, "CA", "CA-BC", "Vancouver", "Vancouver International Airport"),
    oa_row("YXE", "Saskatoon Airport", 52.17, -106.70, "CA", "CA-SK", "Saskatoon", ""),
    oa_row("ZZZ", "No Wiki Airport", 10, 10, "FR", "FR-X", "Nowhere", ""),
]) + "\n"

CITIES = [(44.65, -63.57, "America/Halifax"), (42.36, -71.06, "America/New_York"),
          (51.51, -0.13, "Europe/London"), (49.0, -57.0, "America/Glace_Bay"),
          (13.1, -59.6, "America/Barbados")]


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------
def test_halifax_express_rows():
    rows = rn.parse_dest_list(HALIFAX)
    express = [r.title for r in rows if r.brand == "X"]
    assert express == ["Logan International Airport", "Deer Lake Regional Airport", "Gander International Airport",
                       "CFB Goose Bay", "Newark Liberty International Airport", "Ottawa International Airport",
                       "St. John's International Airport"]
    assert all(not r.seasonal for r in rows if r.brand == "X")


def test_non_air_canada_airlines_ignored():
    titles = {r.title for r in rn.parse_dest_list(HALIFAX)}
    # WestJet / Porter / United Express / BermudAir destinations not served by AC from YHZ:
    assert "L.F. Wade International Airport" not in titles
    assert "Detroit Metropolitan Airport" not in titles
    assert "Washington–Dulles" not in titles


def test_seasonal_and_notes():
    rows = {(r.brand, r.title): r for r in rn.parse_dest_list(HALIFAX)}
    bgi = rows[("R", "Grantley Adams International Airport")]
    assert bgi.seasonal and bgi.begins == "2026-12-17"
    assert rows[("A", "London–Heathrow")].resumes == "2026-12-01"
    assert rows[("R", "London–Heathrow")].ends == "2026-11-30"
    assert rows[("A", "Brussels Airport")].seasonal
    assert not rows[("A", "Toronto–Pearson")].seasonal


def test_three_column_template_with_comments_and_refs():
    rows = rn.parse_dest_list(VANCOUVER)
    titles = [r.title for r in rows]
    assert "Fake Airport" not in titles  # inside an HTML comment
    assert "Tokyo–Haneda" in titles and "Kamloops Airport" in titles
    by = {r.title: r for r in rows}
    assert by["Penticton Regional Airport"].begins == "2026-12-13"
    assert by["Kahului Airport"].ends == "2027-01-26" and by["Kahului Airport"].seasonal
    assert by["Cancún International Airport"].brand == "R"
    assert by["Cancún International Airport"].resumes == "2026-12-03"  # suspended until
    assert all(r.brand in "AXR" for r in rows)
    assert sum(1 for r in rows if r.title == "Calgary International Airport") == 1  # WestJet's ignored


def test_no_template_returns_none():
    assert rn.parse_dest_list("==History==\nNo table here.") is None


@pytest.mark.parametrize("text,iso", [
    ("1 December 2026", "2026-12-01"), ("December 1, 2026", "2026-12-01"), ("December 1 2026", "2026-12-01"),
    ("May 2027", "2027-05-01"), ("31 February 2026", None), ("Smarch 3, 2026", None),
])
def test_parse_date_formats(text, iso):
    assert rn.parse_date(text) == iso


def test_parse_notes_kinds():
    assert rn.parse_notes("(begins May 6, 2027)") == {"begins": "2027-05-06"}
    assert rn.parse_notes("(Ends October 24, 2026)") == {"ends": "2026-10-24"}
    assert rn.parse_notes("(suspended until January 18, 2027)") == {"resumes": "2027-01-18"}
    assert rn.parse_notes("(resumes 3 December 2026)") == {"resumes": "2026-12-03"}


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------
def test_ourairports_parse():
    by_title, by_iata = rn.parse_ourairports(OA_CSV)
    assert by_title["Logan International Airport"] == "BOS"
    assert by_title["CFB Goose Bay"] == "YYR"
    assert by_iata["YDF"].municipality == "Deer Lake" and by_iata["YDF"].region == "CA-NL"


def test_resolve_through_redirects_and_wikidata():
    by_title, _ = rn.parse_ourairports(OA_CSV)
    calls = []

    def fake_api(base, params):
        calls.append((base, params))
        if base == rn.WIKI_API:
            return {"query": {
                "redirects": [{"from": "London–Heathrow", "to": "Heathrow Airport"},
                              {"from": "Ottawa International Airport",
                               "to": "Ottawa Macdonald–Cartier International Airport"}],
                "pages": [{"title": "Heathrow Airport"}, {"title": "Tokyo–Haneda", "pageprops": {"wikibase_item": "Q1"}},
                          {"title": "Nowhere Field"}]}}
        return {"entities": {"Q1": {"claims": {"P238": [{"mainsnak": {"datavalue": {"value": "HND"}}}]}}}}

    out = rn.resolve_titles(["Logan International Airport", "London–Heathrow", "Ottawa International Airport",
                             "Tokyo–Haneda", "Nowhere Field"], by_title, fake_api)
    assert out == {"Logan International Airport": "BOS", "London–Heathrow": "LHR",
                   "Ottawa International Airport": "YOW", "Tokyo–Haneda": "HND", "Nowhere Field": None}
    assert len(calls) == 2  # one query batch, one Wikidata lookup


def test_tz_overrides_and_nearest():
    _, by_iata = rn.parse_ourairports(OA_CSV)
    assert rn.airport_tz(by_iata["YYR"], CITIES) == "America/Goose_Bay"  # Labrador, not Newfoundland time
    assert rn.airport_tz(by_iata["YDF"], CITIES) == "America/St_Johns"  # region override beats nearest city
    assert rn.airport_tz(by_iata["YXE"], CITIES) == "America/Regina"
    assert rn.airport_tz(by_iata["BOS"], CITIES) == "America/New_York"
    assert rn.nearest_tz(51.4, 0.1, CITIES) == "Europe/London"
    for tz in list(rn.TZ_BY_CODE.values()) + list(rn.TZ_BY_REGION.values()):
        ZoneInfo(tz)  # every override is a real IANA zone


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------
HUBS = ["YYZ", "YUL", "YVR", "YYC", "YOW", "YHZ", "YEG", "YQB", "YWG", "YTZ"]


def test_merge_undirected_and_past_dropped():
    R = rn.Row
    rows = {
        "YHZ": [R("X", "Boston", False), R("A", "Toronto", False), R("A", "Old", True, ends="2026-01-01"),
                R("R", "Barbados", True, begins="2026-12-17"), R("A", "Heathrow", False, resumes="2026-12-01"),
                R("R", "Heathrow", True, ends="2026-11-30"), R("A", "Bay", True, resumes="2026-05-01")],
        "YYZ": [R("A", "Halifax", False), R("X", "Halifax", False)],
    }
    codes = {"Boston": "BOS", "Toronto": "YYZ", "Old": "OLD", "Barbados": "BGI", "Heathrow": "LHR",
             "Halifax": "YHZ", "Bay": "MBJ"}
    out = rn.merge_routes(rows, codes, HUBS, TODAY)
    assert "YHZ-OLD" not in out  # ended in the past
    assert out["YHZ-BOS"] == ["X", 0, None, None, None]
    assert out["YHZ-BGI"] == ["R", 1, "2026-12-17", None, None]
    assert out["YHZ-LHR"] == ["AR", 0, None, None, None]  # Rouge flies now, mainline resumes later
    assert out["YHZ-MBJ"] == ["A", 1, None, None, None]  # past "resumes" means flying again
    assert out["YHZ-YYZ"] == ["AX", 0, None, None, None]  # both hub articles, one undirected key
    assert "YYZ-YHZ" not in out


def test_route_key():
    assert rn.route_key("YHZ", "BOS", HUBS) == "YHZ-BOS"
    assert rn.route_key("BOS", "YHZ", HUBS) == "YHZ-BOS"
    assert rn.route_key("YYZ", "YHZ", HUBS) == "YHZ-YYZ"


# ---------------------------------------------------------------------------
# Gates
# ---------------------------------------------------------------------------
def _gates(**kw):
    base = dict(hub_rows={h: [] for h in rn.HUB_ARTICLES}, fetch_errors=[], unresolved=0, linked=100,
                hub_counts={h: 60 for h in rn.HUB_ARTICLES}, prev=None, total=400)
    base.update(kw)
    return rn.check_gates(**base)


def test_gates_pass():
    assert _gates() == ([], [])


def test_gate_missing_table_and_fetch_error():
    rows = {h: [] for h in rn.HUB_ARTICLES}
    rows["YHZ"] = None
    errors, _ = _gates(hub_rows=rows)
    assert any("YHZ: no destinations table" in e for e in errors)
    errors, _ = _gates(fetch_errors=["YYZ: fetch failed: boom"])
    assert errors == ["YYZ: fetch failed: boom"]


def test_gate_unresolved_ratio():
    errors, _ = _gates(unresolved=6, linked=100)
    assert any("unresolved" in e for e in errors)
    errors, warnings = _gates(unresolved=5, linked=100)
    assert not errors and warnings


def test_gate_big_hubs():
    counts = {h: 60 for h in rn.HUB_ARTICLES}
    counts["YVR"] = 49
    errors, _ = _gates(hub_counts=counts)
    assert errors == ["YVR: only 49 routes (< 50)"]


def test_gate_drops_and_override():
    prev = {"meta": {"routeCount": 600, "sources": [{"hub": "YHZ", "routes": 100}]}}
    counts = {h: 60 for h in rn.HUB_ARTICLES}
    errors, _ = _gates(prev=prev, hub_counts=counts, total=400)
    assert len(errors) == 2  # YHZ per-hub drop and total drop
    errors, warnings = _gates(prev=prev, hub_counts=counts, total=400, allow_drop=True)
    assert not errors and len(warnings) == 2


# ---------------------------------------------------------------------------
# Output and run()
# ---------------------------------------------------------------------------
def test_generate_json_deterministic():
    routes = {"YHZ-BOS": ["X", 0, None, None, None], "YHZ-BGI": ["R", 1, "2026-12-17", None, None]}
    airports = {"YDF": ["Deer Lake", "CA", "America/St_Johns", 49.21, -57.39]}
    src = [{"hub": "YHZ", "title": "T", "revid": 1, "url": "u", "routes": 2}]
    a = rn.generate_json(routes, airports, src, "2026-10-02T00:00:00Z")
    b = rn.generate_json(dict(reversed(list(routes.items()))), airports, src, "2026-10-02T00:00:00Z")
    assert a == b
    d = json.loads(a)
    assert d["license"] == "CC BY-SA 4.0" and "Wikipedia" in d["attribution"]
    assert d["meta"]["builtAt"] == "2026-10-02T00:00:00Z" and d["meta"]["routeCount"] == 2
    assert list(d["routes"]) == ["YHZ-BGI", "YHZ-BOS"]


def test_comparable_ignores_built_at_and_revid():
    src = [{"hub": "YHZ", "title": "T", "revid": 1, "url": "u1", "routes": 1}]
    src2 = [{"hub": "YHZ", "title": "T", "revid": 2, "url": "u2", "routes": 1}]
    r = {"YHZ-BOS": ["X", 0, None, None, None]}
    assert rn.comparable(rn.generate_json(r, {}, src, "a")) == rn.comparable(rn.generate_json(r, {}, src2, "b"))
    assert rn.comparable(rn.generate_json(r, {}, src, "a")) != rn.comparable(
        rn.generate_json({"YHZ-EWR": ["X", 0, None, None, None]}, {}, src, "a"))


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def make_opener(pages: dict[str, str]):
    def opener(req, timeout=None):
        url = req.full_url
        if url == rn.OURAIRPORTS_CSV:
            return FakeResp(OA_CSV.encode())
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
        if q.get("action") == "parse":
            hub = next(h for h, t in rn.HUB_ARTICLES.items() if t == q["page"])
            text = pages.get(hub, "{{Airport-dest-list\n| [[WestJet]] | [[Calgary International Airport|Calgary]]\n}}")
            return FakeResp(json.dumps({"parse": {"title": q["page"], "revid": 7, "wikitext": text}}).encode())
        if q.get("action") == "query":
            titles = q["titles"].split("|")
            redirects = [{"from": t, "to": "Heathrow Airport"} for t in titles if t == "London–Heathrow"]
            redirects += [{"from": "Ottawa International Airport", "to": "Ottawa Macdonald–Cartier International Airport"}]
            hubs = {"Montréal–Trudeau": "Montréal–Trudeau International Airport",
                    "Toronto–Pearson": "Toronto Pearson International Airport"}
            redirects += [{"from": t, "to": hubs[t]} for t in titles if t in hubs]
            return FakeResp(json.dumps({"query": {"redirects": redirects, "pages": []}}).encode())
        return FakeResp(b'{"entities": {}}')
    return opener


@pytest.fixture
def env(tmp_path):
    dest_ts = tmp_path / "destinations.ts"
    dest_ts.write_text("export const HUBS: Hub[] = [\n" + "".join(f"  {{ code: '{h}' }},\n" for h in HUBS)
                       + "];\nexport const DESTINATIONS = [ { code: 'CUN' }, { code: 'BGI' } ];\n")
    cities = tmp_path / "cities.json"
    cities.write_text(json.dumps({"tz": ["America/Halifax", "America/New_York", "Europe/London"],
                                  "cols": {"lat": [4465, 4236, 5151], "lng": [-6357, -7106, -13], "tz": [0, 1, 2]}}))
    return tmp_path, dest_ts, cities


def _run(env, argv=(), pages=None, out=None):
    tmp, dest_ts, cities = env
    out = out or tmp / "route-network.json"
    pages = pages if pages is not None else {"YHZ": HALIFAX}
    code = rn.run(list(argv), opener=make_opener(pages), sleep=lambda s: None, out_path=str(out),
                  destinations_ts=str(dest_ts), cities_json=str(cities),
                  now=lambda: datetime(2026, 10, 2, 6, 0, tzinfo=timezone.utc))
    return code, out


def test_run_fails_gates_without_big_hubs(env):
    code, out = _run(env)
    assert code == 1 and not out.exists()  # YUL/YYZ/YVR have no AC rows in this fake


def test_run_writes_and_noops(env, monkeypatch):
    monkeypatch.setattr(rn, "BIG_HUBS", ())
    code, out = _run(env)
    assert code == 0
    d = json.loads(out.read_text())
    assert d["routes"]["YHZ-BOS"] == ["X", 0, None, None, None]
    assert d["routes"]["YHZ-EWR"] == ["X", 0, None, None, None]
    assert d["routes"]["YHZ-YOW"] == ["X", 0, None, None, None]
    assert d["routes"]["YHZ-BGI"] == ["R", 1, "2026-12-17", None, None]
    assert d["airports"]["YDF"] == ["Deer Lake", "CA", "America/St_Johns", 49.21, -57.39]
    assert d["airports"]["YYR"][2] == "America/Goose_Bay"
    assert "CUN" not in d["airports"] and "YHZ" not in d["airports"]  # known to the app already
    assert d["meta"]["builtAt"] == "2026-10-02T06:00:00Z"
    assert all(s["revid"] == 7 for s in d["meta"]["sources"])
    before = out.read_text()
    # A second run at a later time with the same data leaves the file alone.
    tmp, dest_ts, cities = env
    code = rn.run([], opener=make_opener({"YHZ": HALIFAX}), sleep=lambda s: None, out_path=str(out),
                  destinations_ts=str(dest_ts), cities_json=str(cities),
                  now=lambda: datetime(2026, 10, 9, 6, 0, tzinfo=timezone.utc))
    assert code == 0 and out.read_text() == before


def test_run_dry_run_and_drop_gate(env, monkeypatch):
    monkeypatch.setattr(rn, "BIG_HUBS", ())
    code, out = _run(env, argv=["--dry-run"])
    assert code == 0 and not out.exists()
    _run(env)
    before = out.read_text()
    code, _ = _run(env, pages={})  # YHZ article lost its AC rows
    assert code == 1 and out.read_text() == before
    code, _ = _run(env, argv=["--allow-route-drop"], pages={})
    assert code == 0


def test_committed_file_shape():
    path = REPO / "public" / "data" / "route-network.json"
    if not path.exists():
        pytest.skip("no committed route-network.json")
    d = json.loads(path.read_text(encoding="utf-8"))
    assert d["version"] == 1 and d["license"] == "CC BY-SA 4.0" and d["attribution"]
    assert d["meta"]["builtAt"] and len(d["meta"]["sources"]) == len(rn.HUB_ARTICLES)
    for key, v in d["routes"].items():
        assert len(key) == 7 and key[3] == "-"
        assert set(v[0]) <= set("AXR") and v[1] in (0, 1) and len(v) == 5
    for code, a in d["airports"].items():
        ZoneInfo(a[2])
