"""Pipeline tests: discovery, download, gates and file writing, all stubbed."""
import io
import urllib.error

import pytest

from conftest import load_pages

BASE = "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/"
HUBS = ["YYZ", "YUL", "YVR", "YWG"]
PREVIOUS = '// previous file\nexport const ROUTE_SCHEDULES = [\n  { originCode: "YUL", destinationCode: "CDG", schedules: [] },\n];\n'


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


def test_fetch_pdf_rejects_non_pdf_and_foreign_hosts(fs):
    with pytest.raises(ValueError):
        fs.fetch_pdf(BASE + "a.pdf", opener=lambda r, timeout: FakeResp(b"<html>"), sleep=lambda s: None)
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


def test_previous_route_count_counts_origin_code_entries(fs, tmp_path):
    p = tmp_path / "s.ts"
    p.write_text("export interface RouteSchedule {\n  originCode: string;\n}\n" + PREVIOUS)
    assert fs.previous_route_count(str(p)) == 1


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
    p = tmp_path / "schedules.ts"
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
    assert not (out.parent / "schedules.ts.tmp").exists()


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
    many = "".join(f'  {{ originCode: "YUL", destinationCode: "X{i:02d}", schedules: [] }},\n' for i in range(40))
    out.write_text(many)
    before = out.read_bytes()
    assert _run(fs, out) == 1
    assert out.read_bytes() == before


def test_domestic_pdfs_skipped_unless_opted_in(fs, out):
    seen = []

    def fetch(url):
        seen.append(url)
        if "CANADA" in url:
            return b"%PDF-DOM", 0.0
        return _fetch_ok(url)

    def extract(b):
        if b == b"%PDF-DOM":
            return ["Toronto (YYZ)\nToronto to Montreal\nTrudeau Airport (YUL)\nto ...\n"
                    "2026-10-01 2026-10-31 MTWRFSU AC403 08:10 09:33 321\n"
                    "Toronto to Sudbury\nSudbury Airport (YSB)\nto ...\n"
                    "2026-10-01 2026-10-31 MTWRFSU AC8000 08:10 09:33 DH4\n"]
        return _extract(b)

    urls = ALL_URLS + [BASE + "EN-CANADA-EasternCanada.pdf"]
    assert _run(fs, out, discover=lambda: urls, fetch=fetch, extract=extract) == 0
    assert not any("CANADA" in u for u in seen)
    assert '"YYZ", destinationCode: "YUL"' not in out.read_text()

    assert _run(fs, out, ["--include-domestic"], discover=lambda: urls, fetch=fetch, extract=extract) == 0
    text = out.read_text()
    assert 'originCode: "YYZ", destinationCode: "YUL"' in text      # hub-to-hub kept
    assert 'destinationCode: "YSB"' not in text                     # non-hub dropped


def test_domestic_parse_failure_is_not_fatal(fs, out):
    def fetch(url):
        return (b"%PDF-DOM", 0.0) if "CANADA" in url else _fetch_ok(url)

    def extract(b):
        if b == b"%PDF-DOM":
            raise ValueError("unexpected layout")
        return _extract(b)

    urls = ALL_URLS + [BASE + "EN-CANADA-EasternCanada.pdf"]
    assert _run(fs, out, ["--include-domestic"], discover=lambda: urls, fetch=fetch, extract=extract) == 0


def test_run_writes_deterministic_output_with_meta(fs, out):
    from datetime import datetime, timezone
    t1 = lambda: datetime(2026, 9, 30, 12, 0, 0, tzinfo=timezone.utc)
    t2 = lambda: datetime(2026, 10, 1, 8, 30, 0, tzinfo=timezone.utc)
    assert _run(fs, out, now=t1) == 0
    first = out.read_text()
    assert _run(fs, out, now=t2) == 0
    second = out.read_text()
    assert first.replace("2026-09-30T12:00:00Z", "X") == second.replace("2026-10-01T08:30:00Z", "X")
    assert first != second

    assert 'generatedAt: "2026-09-30T12:00:00Z"' in first
    assert "export const SCHEDULES_META = {" in first
    assert 'coverageFrom: "2026-09-29"' in first
    assert 'coverageTo: "2027-09-26"' in first
    assert 'YUL: { from: "2026-09-29", to: "2027-09-06" }' in first
    assert "pdfCount: 4," in first
    assert "export function getSchedulesForRoute(originCode: string, destinationCode: string): FlightSchedule[]" in first
    assert "export const ROUTE_SCHEDULES: RouteSchedule[] = [" in first
    assert "ROUTE_INDEX" not in first and "arrDayOffset" not in first
    assert not (out.parent / "schedules.ts.tmp").exists()


def test_step_summary_written(fs, out, tmp_path, monkeypatch):
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    assert _run(fs, out, ["--dry-run"]) == 0
    text = summary.read_text()
    assert "Routes: 1 ->" in text and "Coverage:" in text
