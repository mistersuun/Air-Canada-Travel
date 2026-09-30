"""Pipeline tests: discovery, download, gates and file writing, all stubbed."""
import io
import json
import urllib.error

import pytest

from conftest import load_pages

BASE = "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/"
HUBS = ["YYZ", "YUL", "YVR", "YWG"]


def prev_json(routes: dict) -> str:
    """A previously generated schedules.json: {'YUL-CDG': [[from, to, mask, flight, dep, arr, ac]]}."""
    return json.dumps({"version": 1, "meta": {}, "routes": routes})


def load_out(path) -> dict:
    return json.loads(path.read_text())


def many_routes(n=40) -> str:
    return prev_json({f"YUL-X{i:02d}": [] for i in range(n)})


PREVIOUS = prev_json({"YUL-CDG": []})


# --- discovery ------------------------------------------------------------------

def test_parse_pdf_links_filters_and_absolutises(fs):
    html = """
      <a href="/en/travel-info/where-we-fly/files/EN-EUROPE-France.pdf">France</a>
      <a href='https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-ASIA-Asia.PDF?v=2'>Asia</a>
      <a href="https://evil.example.com/where-we-fly/files/EN-X.pdf">bad host</a>
      <a href="https://aircanada.com.evil.net/where-we-fly/x.pdf">lookalike</a>
      <a href="http://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-HTTP.pdf">http</a>
      <a href="/en/travel-info/where-we-fly/files/EN-EUROPE-France.pdf">dupe</a>
      <a href="/en/terms.pdf">not a schedule</a>
      <a href="/en/travel-info/where-we-fly/page.html">html</a>
    """
    urls = fs.parse_pdf_links(html, "https://vacations.aircanada.com/en/plan-your-trip/travel-info/where-we-fly")
    assert urls == [
        "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-ASIA-Asia.PDF?v=2",
        "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-EUROPE-France.pdf",
    ]


def test_is_domestic_case_insensitive(fs):
    assert fs.is_domestic(BASE + "EN-CANADA-EasternCanada.pdf")
    assert fs.is_domestic(BASE + "en-canada-westerncanada.pdf")
    assert not fs.is_domestic(BASE + "EN-EUROPE-France.pdf")


# --- download -------------------------------------------------------------------

class FakeResp:
    def __init__(self, body, headers=None):
        self._body = body
        self.headers = headers or {}

    def read(self, n=-1):
        return self._body if n < 0 else self._body[:n]

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_fetch_pdf_retries_with_backoff(fs):
    calls, sleeps = [], []

    def opener(req, timeout):
        calls.append(timeout)
        if len(calls) < 3:
            raise urllib.error.URLError("boom")
        return FakeResp(b"%PDF-1.7 ...", {"Last-Modified": "Wed, 30 Sep 2026 08:00:15 GMT"})

    body, published = fs.fetch_pdf(BASE + "a.pdf", opener=opener, sleep=sleeps.append)
    assert body.startswith(b"%PDF-")
    assert published > 0
    assert sleeps == [1, 2]
    assert calls == [60, 60, 60]


def test_fetch_pdf_gives_up_after_four_attempts(fs):
    sleeps = []

    def opener(req, timeout):
        raise urllib.error.URLError("down")

    with pytest.raises(RuntimeError):
        fs.fetch_pdf(BASE + "a.pdf", opener=opener, sleep=sleeps.append)
    assert sleeps == [1, 2, 4]


def test_fetch_pdf_retries_non_pdf_bodies(fs):
    calls, sleeps = [], []

    def opener(req, timeout):
        calls.append(1)
        return FakeResp(b"<html>error</html>" if len(calls) < 2 else b"%PDF-1.7")

    body, _ = fs.fetch_pdf(BASE + "a.pdf", opener=opener, sleep=sleeps.append)
    assert body.startswith(b"%PDF-") and sleeps == [1]
    with pytest.raises(RuntimeError, match="not a PDF"):
        fs.fetch_pdf(BASE + "a.pdf", opener=lambda r, timeout: FakeResp(b"<html>"), sleep=lambda s: None)


def test_fetch_pdf_does_not_retry_http_4xx(fs):
    calls, sleeps = [], []

    def opener(req, timeout):
        calls.append(1)
        raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)

    with pytest.raises(RuntimeError, match="404"):
        fs.fetch_pdf(BASE + "a.pdf", opener=opener, sleep=sleeps.append)
    assert calls == [1] and sleeps == []

    calls.clear()

    def flaky(req, timeout):
        calls.append(1)
        if len(calls) < 2:
            raise urllib.error.HTTPError(req.full_url, 503, "Unavailable", {}, None)
        return FakeResp(b"%PDF-1.7")

    assert fs.fetch_pdf(BASE + "a.pdf", opener=flaky, sleep=sleeps.append)[0].startswith(b"%PDF-")


def test_fetch_pdf_rejects_foreign_hosts_and_huge_files(fs):
    with pytest.raises(ValueError):
        fs.fetch_pdf("https://example.com/a.pdf", opener=None, sleep=lambda s: None)
    big = FakeResp(b"%PDF-", {"Content-Length": str(31 * 1024 * 1024)})
    with pytest.raises(ValueError):
        fs.fetch_pdf(BASE + "a.pdf", opener=lambda r, timeout: big, sleep=lambda s: None)


# --- hubs -----------------------------------------------------------------------

def test_load_hub_codes_reads_destinations(fs, tmp_path):
    p = tmp_path / "destinations.ts"
    p.write_text("export const HUBS: Hub[] = [\n  { name: 'A', code: 'YYZ' },\n  { name: 'B', code: \"YUL\" },\n];\n"
                 "export const DESTINATIONS = [{ code: 'CDG' }];\n")
    assert fs.load_hub_codes(str(p)) == ["YYZ", "YUL"]
    assert fs.load_hub_codes(str(tmp_path / "missing.ts")) == list(fs.FALLBACK_HUBS)


def test_previous_route_count_reads_json_and_legacy_ts(fs, tmp_path):
    p = tmp_path / "s.json"
    p.write_text(PREVIOUS)
    assert fs.previous_route_count(str(p)) == 1
    legacy = tmp_path / "s.ts"
    legacy.write_text("export interface RouteSchedule {\n  originCode: string;\n}\n"
                      '  { originCode: "YUL", destinationCode: "CDG", schedules: [] },\n')
    assert fs.previous_route_count(str(legacy)) == 1
    assert fs.previous_route_count(str(tmp_path / "missing.json")) == 0


# --- gates ----------------------------------------------------------------------

def _routes(n_per_hub=1, hubs=("YYZ", "YUL", "YVR")):
    rec = {"fromDate": "2026-10-01", "toDate": "2026-10-31", "days": "Mon", "flightNumber": "AC1",
           "departure": "10:00", "arrival": "12:00", "aircraft": "320"}
    return {(h, f"D{i:02d}"): [dict(rec)] for h in hubs for i in range(n_per_hub)}


def gates(fs, **kw):
    args = dict(pdf_count=3, download_errors=[], routes=_routes(), prev_routes=0,
                hubs=["YYZ", "YUL", "YVR"], accepted_rows=10, rejected_rows=0)
    args.update(kw)
    return fs.check_gates(**args)


def test_gates_pass(fs, monkeypatch):
    monkeypatch.setattr(fs, "MIN_RECORDS", 1)
    assert gates(fs) == ([], [])


def test_gates_fail_on_zero_pdfs_and_download_errors(fs, monkeypatch):
    monkeypatch.setattr(fs, "MIN_RECORDS", 1)
    errors, _ = gates(fs, pdf_count=0, download_errors=[("x.pdf", "timeout")])
    assert any("no schedule PDFs" in e for e in errors)
    assert any("x.pdf" in e for e in errors)


def test_gate_route_ratio_and_record_floor(fs, monkeypatch):
    monkeypatch.setattr(fs, "MIN_RECORDS", 1)
    assert gates(fs, prev_routes=3)[0] == []
    errors, _ = gates(fs, prev_routes=4)       # 3 < 0.8 * 4
    assert any("route count dropped" in e for e in errors)
    monkeypatch.setattr(fs, "MIN_RECORDS", 5000)
    assert any("too few records" in e for e in gates(fs)[0])


def test_gate_required_vs_optional_hubs(fs, monkeypatch):
    monkeypatch.setattr(fs, "MIN_RECORDS", 1)
    errors, warnings = gates(fs, routes=_routes(hubs=("YYZ", "YUL")), hubs=["YYZ", "YUL", "YVR", "YEG"])
    assert any("YVR" in e for e in errors)
    assert any("YEG" in w for w in warnings) and not any("YEG" in e for e in errors)


def test_gate_reject_ratio(fs, monkeypatch):
    monkeypatch.setattr(fs, "MIN_RECORDS", 1)
    assert any("rejected rows" in e for e in gates(fs, accepted_rows=90, rejected_rows=10)[0])
    errors, warnings = gates(fs, accepted_rows=99, rejected_rows=1)
    assert errors == [] and any("rejected" in w for w in warnings)


# --- end-to-end run() -----------------------------------------------------------

FIXTURE_PDFS = {
    BASE + "EN-AFRICA-NorthernAfrica.pdf": "page_break.txt",
    BASE + "EN-ASIA-Asia.pdf": "return_first.txt",
    BASE + "EN-SOUTH-America.pdf": "accented.txt",
}
# page_break: YUL; return_first: YYZ; add a YVR fixture inline so all required hubs exist.
YVR_TEXT = ("Vancouver (YVR)\nVancouver to Tokyo, Japan\nHaneda Airport (HND)\nto ...\n"
            "2026-10-01 2026-10-31 MTWRFSU AC7 13:00 15:30 789\n")


def _extract(pdf_bytes):
    key = pdf_bytes.decode()[len("%PDF-"):]
    if key == "YVR":
        return [YVR_TEXT]
    return load_pages(key)


def _fetch_ok(url):
    if url.endswith("Pacific.pdf"):
        return b"%PDF-YVR", 0.0
    return ("%PDF-" + FIXTURE_PDFS[url]).encode(), 0.0


ALL_URLS = sorted(list(FIXTURE_PDFS) + [BASE + "EN-SOUTHPACIFIC-Pacific.pdf"])


@pytest.fixture
def out(tmp_path, fs, monkeypatch):
    monkeypatch.setattr(fs, "MIN_RECORDS", 1)
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    p = tmp_path / "data" / "schedules.json"
    p.parent.mkdir()
    p.write_text(PREVIOUS)
    return p


def _run(fs, out, argv=(), **kw):
    args = dict(discover=lambda: ALL_URLS, fetch=_fetch_ok, extract=_extract, out_path=str(out), hubs=HUBS)
    args.update(kw)
    return fs.run(list(argv), **args)


def test_run_zero_pdfs_fails_and_leaves_file_identical(fs, out):
    before = out.read_bytes()
    assert _run(fs, out, discover=lambda: []) == 1
    assert _run(fs, out, ["--dry-run"], discover=lambda: []) == 1
    assert out.read_bytes() == before
    assert not (out.parent / "schedules.json.tmp").exists()


def test_run_discovery_exception_fails(fs, out):
    def boom():
        raise OSError("no network")
    before = out.read_bytes()
    assert _run(fs, out, discover=boom) == 1
    assert out.read_bytes() == before


def test_run_download_failure_fails_and_leaves_file_identical(fs, out):
    def fetch(url):
        if "Asia" in url:
            raise RuntimeError("download failed after 4 attempts")
        return _fetch_ok(url)
    before = out.read_bytes()
    assert _run(fs, out, fetch=fetch) == 1
    assert _run(fs, out, ["--dry-run"], fetch=fetch) == 1
    assert out.read_bytes() == before


def test_run_dry_run_passes_without_writing(fs, out):
    before = out.read_bytes()
    assert _run(fs, out, ["--dry-run"]) == 0
    assert out.read_bytes() == before


def test_run_missing_required_hub_fails(fs, out):
    before = out.read_bytes()
    urls = [u for u in ALL_URLS if "Pacific" not in u]  # drops the only YVR data
    assert _run(fs, out, discover=lambda: urls) == 1
    assert out.read_bytes() == before


def test_run_route_count_drop_fails(fs, out):
    out.write_text(many_routes())
    before = out.read_bytes()
    assert _run(fs, out) == 1
    assert out.read_bytes() == before


DOMESTIC_TEXT = ("Toronto (YYZ)\nToronto to Montreal\nTrudeau Airport (YUL)\nto ...\n"
                 "2026-10-01 2026-10-31 MTWRFSU AC403 08:10 09:33 321\n"
                 "Toronto to Sudbury\nSudbury Airport (YSB)\nto ...\n"
                 "2026-10-01 2026-10-31 MTWRFSU AC8000 08:10 09:33 DH4\n")


def test_domestic_hub_to_hub_legs_parsed_by_default(fs, out):
    seen = []

    def fetch(url):
        seen.append(url)
        if "CANADA" in url:
            return b"%PDF-DOM", 0.0
        return _fetch_ok(url)

    def extract(b):
        return [DOMESTIC_TEXT] if b == b"%PDF-DOM" else _extract(b)

    urls = ALL_URLS + [BASE + "EN-CANADA-EasternCanada.pdf"]
    assert _run(fs, out, discover=lambda: urls, fetch=fetch, extract=extract) == 0
    routes = load_out(out)["routes"]
    assert routes["YYZ-YUL"] == [["2026-10-01", "2026-10-31", "MTWRFSU", "AC403", "08:10", "09:33", "321"]]
    assert load_out(out)["meta"]["hubToHub"] is True
    assert not any(k.endswith("-YSB") for k in routes)               # non-hub dropped
    assert any("CANADA" in u for u in seen)

    seen.clear()
    assert _run(fs, out, ["--skip-domestic"], discover=lambda: urls, fetch=fetch, extract=extract) == 0
    assert not any("CANADA" in u for u in seen)
    assert "YYZ-YUL" not in load_out(out)["routes"]
    assert load_out(out)["meta"]["hubToHub"] is False


def test_domestic_parse_failure_is_not_fatal(fs, out):
    def fetch(url):
        return (b"%PDF-DOM", 0.0) if "CANADA" in url else _fetch_ok(url)

    def extract(b):
        if b == b"%PDF-DOM":
            raise ValueError("unexpected layout")
        return _extract(b)

    urls = ALL_URLS + [BASE + "EN-CANADA-EasternCanada.pdf"]
    assert _run(fs, out, discover=lambda: urls, fetch=fetch, extract=extract) == 0


def test_run_writes_deterministic_output_with_meta(fs, out):
    from datetime import datetime, timezone
    t1 = lambda: datetime(2026, 9, 30, 12, 0, 0, tzinfo=timezone.utc)
    t2 = lambda: datetime(2026, 10, 1, 8, 30, 0, tzinfo=timezone.utc)
    assert _run(fs, out, now=t1) == 0
    first = out.read_text()
    assert _run(fs, out, now=t2) == 0
    second = out.read_text()
    # Same data: the file is left alone, generatedAt included (no empty commit/redeploy).
    assert first == second
    # Different data: rewritten with the new generatedAt.
    out.write_text(first.replace('"AC7"', '"AC9"'))
    assert _run(fs, out, now=t2) == 0
    third = out.read_text()
    assert '"generatedAt": "2026-10-01T08:30:00Z"' in third
    assert first.replace("2026-09-30T12:00:00Z", "X") == third.replace("2026-10-01T08:30:00Z", "X")

    data = json.loads(first)
    assert data["version"] == 1
    meta = data["meta"]
    assert meta["generatedAt"] == "2026-09-30T12:00:00Z"
    assert meta["coverageFrom"] == "2026-09-29" and meta["coverageTo"] == "2027-09-26"
    assert meta["coverageByHub"]["YUL"] == {"from": "2026-09-29", "to": "2027-09-06"}
    assert meta["pdfCount"] == 4
    assert meta["routeCount"] == len(data["routes"]) and meta["recordCount"] == sum(map(len, data["routes"].values()))
    assert data["routes"]["YUL-CMN"][0] == ["2026-09-30", "2026-10-04", "--W-FSU", "AC72", "19:10", "06:15", "333"]
    # One record per line keeps the weekly diff readable.
    assert '      ["2026-09-30", "2026-10-04", "--W-FSU", "AC72", "19:10", "06:15", "333"],' in first
    assert not (out.parent / "schedules.json.tmp").exists()


def test_days_mask_round_trip(fs):
    for days in ("Mon,Wed,Fri", "Thu,Sun", "Mon,Tue,Wed,Thu,Fri,Sat,Sun"):
        assert fs.decode_days(fs.encode_days(days)) == days
    assert fs.encode_days("Tue,Sat") == "-T---S-"


def test_step_summary_written(fs, out, tmp_path, monkeypatch):
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    assert _run(fs, out, ["--dry-run"]) == 0
    text = summary.read_text()
    assert "Routes: 1 ->" in text and "Coverage:" in text


# --- failed sources, ratchets, orphans -------------------------------------------

PREV_WITH_RECORDS = prev_json({
    "YUL-CDG": [["2026-09-01", "2027-03-31", "M------", "AC870", "18:00", "07:30", "333"]],
    "YUL-OLD": [["2026-01-01", "2026-03-31", "M------", "AC1", "18:00", "07:30", "333"]],
    "YUL-YYZ": [["2026-09-01", "2027-03-31", "M------", "AC400", "08:00", "09:20", "321"]],
})


def test_load_previous_routes(fs, tmp_path):
    p = tmp_path / "s.json"
    p.write_text(PREV_WITH_RECORDS)
    prev = fs.load_previous_routes(str(p))
    assert set(prev) == {("YUL", "CDG"), ("YUL", "OLD"), ("YUL", "YYZ")}
    assert prev[("YUL", "CDG")][0] == {
        "fromDate": "2026-09-01", "toDate": "2027-03-31", "days": "Mon", "flightNumber": "AC870",
        "departure": "18:00", "arrival": "07:30", "aircraft": "333"}
    assert fs.load_previous_routes(str(tmp_path / "missing.json")) == {}


def test_load_previous_routes_reads_legacy_schedules_ts(fs, tmp_path):
    p = tmp_path / "schedules.ts"
    p.write_text('export const ROUTE_SCHEDULES = [\n'
                 '  { originCode: "YUL", destinationCode: "CDG", schedules: [\n'
                 '    { fromDate: "2026-09-01", toDate: "2027-03-31", days: "Mon", flightNumber: "AC870", '
                 'departure: "18:00", arrival: "07:30", aircraft: "333" },\n'
                 '  ] },\n];\n')
    assert fs.load_previous_routes(str(p))[("YUL", "CDG")][0]["flightNumber"] == "AC870"


def test_single_failed_source_is_tolerated_and_carried_forward(fs, out, monkeypatch):
    from datetime import datetime, timezone
    monkeypatch.setattr(fs, "MAX_FAILED_FRACTION", 1.0)
    out.write_text(PREV_WITH_RECORDS)

    def fetch(url):
        if "Asia" in url:
            raise RuntimeError("HTTP 404: Not Found")
        return _fetch_ok(url)

    now = lambda: datetime(2026, 9, 30, tzinfo=timezone.utc)
    assert _run(fs, out, fetch=fetch, now=now) == 0
    routes = load_out(out)["routes"]
    assert "YUL-CDG" in routes            # carried forward
    assert "YUL-OLD" not in routes        # expired: not carried
    assert "YUL-YYZ" not in routes        # hub-to-hub: only carried for a failed domestic PDF


def test_too_many_failed_sources_still_fail(fs, out):
    # 1 of 4 sources is over MAX_FAILED_FRACTION.
    def fetch(url):
        if "Asia" in url:
            raise RuntimeError("down")
        return _fetch_ok(url)
    before = out.read_bytes()
    assert _run(fs, out, fetch=fetch) == 1
    assert out.read_bytes() == before


def test_zero_route_or_orphaned_source_is_a_failure(fs, out):
    before = out.read_bytes()

    def extract_empty(b):
        return ["nothing here"] if b"Asia" in b or b"return_first" in b else _extract(b)
    assert _run(fs, out, extract=extract_empty) == 1

    def extract_orphans(b):
        if b"return_first" in b:
            return ["2026-10-01 2026-10-31 MTWRFSU AC7 13:00 15:30 789\n" * 3
                    + "Toronto (YYZ)\nToronto to Tokyo, Japan\nHaneda Airport (HND)\nto ...\n"
                    "2026-10-01 2026-10-31 MTWRFSU AC9 13:00 15:30 789\n"]
        return _extract(b)
    assert _run(fs, out, extract=extract_orphans) == 1
    assert out.read_bytes() == before


def test_gate_orphans_count_as_rejects(fs, monkeypatch):
    monkeypatch.setattr(fs, "MIN_RECORDS", 1)
    # run() passes rejects + orphans as rejected_rows.
    assert any("rejected rows" in e for e in gates(fs, accepted_rows=90, rejected_rows=10)[0])


def test_allow_route_drop_flag(fs, out):
    out.write_text(many_routes())
    assert _run(fs, out, ["--dry-run"]) == 1
    assert _run(fs, out, ["--dry-run", "--allow-route-drop"]) == 0


def test_gate_record_count_ratchet(fs, monkeypatch):
    monkeypatch.setattr(fs, "MIN_RECORDS", 1)
    errors, _ = gates(fs, prev_records=10)    # 3 records < 80% of 10
    assert any("record count dropped" in e for e in errors)
    errors, warnings = gates(fs, prev_records=10, allow_drop=True)
    assert errors == [] and any("record count dropped" in w for w in warnings)


def test_domestic_failure_is_not_fatal_and_carries_hub_legs_forward(fs, out):
    from datetime import datetime, timezone
    out.write_text(PREV_WITH_RECORDS)

    def fetch(url):
        if "CANADA" in url:
            raise RuntimeError("down")
        return _fetch_ok(url)

    urls = ALL_URLS + [BASE + "EN-CANADA-EasternCanada.pdf"]
    now = lambda: datetime(2026, 9, 30, tzinfo=timezone.utc)
    assert _run(fs, out, discover=lambda: urls, fetch=fetch, now=now) == 0
    routes = load_out(out)["routes"]
    assert routes["YUL-YYZ"][0][3] == "AC400"   # the lost hub-to-hub leg is kept
    assert "YUL-CDG" not in routes              # nothing else is carried


def test_domestic_pdf_that_parses_to_nothing_counts_as_failed(fs, out):
    from datetime import datetime, timezone
    out.write_text(PREV_WITH_RECORDS)

    def fetch(url):
        return (b"%PDF-DOM", 0.0) if "CANADA" in url else _fetch_ok(url)

    def extract(b):
        return ["a new layout"] if b == b"%PDF-DOM" else _extract(b)

    urls = ALL_URLS + [BASE + "EN-CANADA-EasternCanada.pdf"]
    now = lambda: datetime(2026, 9, 30, tzinfo=timezone.utc)
    assert _run(fs, out, discover=lambda: urls, fetch=fetch, extract=extract, now=now) == 0
    assert "YUL-YYZ" in load_out(out)["routes"]


def test_domestic_pdf_without_hub_legs_is_fine(fs, out, capsys):
    def fetch(url):
        return (b"%PDF-DOM", 0.0) if "CANADA" in url else _fetch_ok(url)

    def extract(b):
        return ["Toronto (YYZ)\nToronto to Sudbury\nSudbury Airport (YSB)\nto ...\n"
                "2026-10-01 2026-10-31 MTWRFSU AC8000 08:10 09:33 DH4\n"] if b == b"%PDF-DOM" else _extract(b)

    urls = ALL_URLS + [BASE + "EN-CANADA-NorthernCanada.pdf"]
    assert _run(fs, out, discover=lambda: urls, fetch=fetch, extract=extract) == 0
    assert "domestic source(s) failed" not in capsys.readouterr().out


def test_domestic_baseline_excluded_when_skipped(fs, out):
    # Previous file has hub-to-hub routes (from the domestic PDFs): not counted with --skip-domestic.
    hubhub = {f"{a}-{b}": [] for a in HUBS for b in HUBS if a != b}
    out.write_text(prev_json({"YUL-CDG": [], **hubhub}))
    assert _run(fs, out, ["--dry-run", "--skip-domestic"]) == 0
