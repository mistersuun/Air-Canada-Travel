"""Tests for build-visa.py (fixtures, no network)."""

import datetime as dt
import importlib.util
import json
import pathlib
import sys

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


visa = _load("build_visa", "build-visa.py")

NOW = dt.datetime(2026, 10, 6, 12, 0, tzinfo=dt.timezone.utc)
README = "# Passport index\n\nLast updated: **17 February 2026**.\n"
WANTED = ["CA", "ES", "JP", "MX", "PT"]


def _csv(rows):
    return "Passport,Destination,Requirement\n" + "".join(f"{p},{d},{r}\n" for p, d, r in rows)


def _big(extra=()):
    """A fixture passing the gates: 160 passports x the wanted destinations, plus extra rows."""
    rows = []
    for i in range(160):
        p = chr(65 + i // 26) + chr(65 + i % 26)
        rows += [(p, d, "90") for d in WANTED if d != p]
    rows += list(extra)
    return rows


def _build(rows, wanted=WANTED, readme=README, monkeypatch=None):
    if monkeypatch:
        monkeypatch.setattr(visa, "MIN_COLS", 4)
        monkeypatch.setattr(visa, "MIN_HOME_CELLS", 4)
    return visa.build(_csv(rows), readme, wanted, now=NOW)


def test_code_mapping_covers_vocabulary():
    cases = {
        "visa free": "F", "VISA FREE": "F", "visa on arrival": "A", "eta": "T", "e-visa": "E",
        "visa required": "V", "no admission": "N", "-1": "O",
        "90": "F90", "180": "F180", " 30 ": "F30", "0": "F",
    }
    for raw, code in cases.items():
        assert visa.code_for(raw) == code, raw
    for raw in ("", "banana", "90 days", "-5", "1.5"):
        assert visa.code_for(raw) is None, raw


def test_build_shape_columns_and_cells(monkeypatch):
    rows = _big([
        ("CA", "ES", "visa free"), ("CA", "MX", "180"), ("CA", "JP", "eta"), ("CA", "PT", "e-visa"),
        ("CA", "CA", "-1"), ("ZZ", "ES", "visa on arrival"), ("ZZ", "MX", "no admission"),
        ("ZZ", "JP", "visa required"),
    ])
    out, counts, unknown = _build(rows, monkeypatch=monkeypatch)
    assert list(out) == ["v", "source", "license", "licenseUrl", "attribution", "asOf", "generatedAt", "cols", "rows"]
    assert out["v"] == 1 and out["license"] == "MIT"
    assert out["licenseUrl"] == "https://github.com/imorte/passport-index-data/blob/main/LICENSE"
    assert out["attribution"] == "Passport Index data (passportindex.org), compiled by imorte/passport-index-data (MIT licence)"
    assert out["asOf"] == "2026-02-17" and out["generatedAt"] == "2026-10-06T12:00:00Z"
    assert out["cols"] == ["CA", "ES", "JP", "MX", "PT"]
    # CA is overwritten by the explicit rows above (later rows win); own country is O.
    ca = dict(zip(out["cols"], out["rows"]["CA"].split(",")))
    assert ca == {"CA": "O", "ES": "F", "JP": "T", "MX": "F180", "PT": "E"}
    zz = dict(zip(out["cols"], out["rows"]["ZZ"].split(",")))
    assert zz == {"CA": "", "ES": "A", "JP": "V", "MX": "N", "PT": ""}
    assert all(len(r.split(",")) == len(out["cols"]) for r in out["rows"].values())
    assert not unknown and counts["O"] == 1


def test_unknown_value_is_empty_and_counted(monkeypatch):
    out, counts, unknown = _build(_big([("ZZ", "ES", "mystery"), ("ZZ", "MX", "mystery"), ("ZZ", "JP", "")]), monkeypatch=monkeypatch)
    zz = dict(zip(out["cols"], out["rows"]["ZZ"].split(",")))
    assert zz["ES"] == "" and zz["MX"] == "" and zz["JP"] == ""
    assert unknown == {"mystery": 2, "": 1}


def test_only_wanted_destinations_and_valid_passports(monkeypatch):
    rows = _big([("ZZ", "FR", "visa free"), ("ZZ", "ES", "visa free"), ("ZZZ", "ES", "visa free"), ("", "ES", "visa free")])
    out, _, _ = _build(rows, monkeypatch=monkeypatch)
    assert "FR" not in out["cols"]
    assert "ZZZ" not in out["rows"] and "" not in out["rows"]
    assert out["rows"]["ZZ"].count("F") == 1
    assert list(out["rows"]) == sorted(out["rows"])


def test_passport_keys_uppercased(monkeypatch):
    out, _, _ = _build(_big([("zz", "es", "visa free")]), monkeypatch=monkeypatch)
    assert "ZZ" in out["rows"] and "zz" not in out["rows"]


def test_gate_too_few_passports(monkeypatch):
    rows = [(f"A{chr(65 + i)}", d, "90") for i in range(20) for d in WANTED]
    with pytest.raises(ValueError, match="passports"):
        _build(rows, monkeypatch=monkeypatch)


def test_gate_too_few_columns():
    # Real thresholds: five destination columns are under 40.
    with pytest.raises(ValueError, match="destination columns"):
        _build(_big())


def test_gate_home_row(monkeypatch):
    rows = [r for r in _big() if r[0] != "CA"]
    with pytest.raises(ValueError, match="CA row"):
        _build(rows, monkeypatch=monkeypatch)
    monkeypatch.setattr(visa, "MIN_HOME_CELLS", 40)
    with pytest.raises(ValueError, match="CA row"):
        _build(_big(), monkeypatch=None)


def test_readme_date_parsing():
    assert visa.parse_as_of("Last updated 17 February 2026") == "2026-02-17"
    assert visa.parse_as_of("Last updated: **3 march 2027**.") == "2027-03-03"
    for bad in ("", "no date here", "Last updated 31 Februar 2026", "Last updated 31 February 2026"):
        with pytest.raises(ValueError):
            visa.parse_as_of(bad)


def test_build_fails_without_readme_date(monkeypatch):
    with pytest.raises(ValueError, match="data date"):
        _build(_big(), readme="nothing", monkeypatch=monkeypatch)


def test_main_writes_compact_json_with_trailing_newline(tmp_path, monkeypatch):
    monkeypatch.setattr(visa, "MIN_COLS", 4)
    monkeypatch.setattr(visa, "MIN_HOME_CELLS", 4)
    monkeypatch.setattr(rd, "destination_countries", lambda: ["ES", "JP", "MX", "PT"])
    c, r, out = tmp_path / "in.csv", tmp_path / "in.md", tmp_path / "out" / "visa.json"
    c.write_text(_csv(_big()), encoding="utf-8")
    r.write_text(README, encoding="utf-8")
    assert visa.main(["--csv", str(c), "--readme", str(r), "--out", str(out)]) == 0
    text = out.read_text(encoding="utf-8")
    assert text.endswith("}\n") and '", "' not in text and '": ' not in text
    data = json.loads(text)
    assert data["cols"] == ["CA", "ES", "JP", "MX", "PT"] and data["asOf"] == "2026-02-17"


def test_main_failure_writes_nothing(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(rd, "destination_countries", lambda: ["ES", "JP", "MX", "PT"])
    c, r, out = tmp_path / "in.csv", tmp_path / "in.md", tmp_path / "visa.json"
    c.write_text(_csv(_big()), encoding="utf-8")
    r.write_text("no date", encoding="utf-8")
    assert visa.main(["--csv", str(c), "--readme", str(r), "--out", str(out)]) == 1
    assert not out.exists()
    assert "error:" in capsys.readouterr().err


def test_get_text_retries_and_final():
    import urllib.error

    class Res:
        status = 200

        def __init__(self, body):
            self.body = body

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return self.body.encode()

    calls = []

    def opener(req, timeout):
        calls.append(1)
        if len(calls) == 1:
            raise urllib.error.HTTPError("http://x", 503, "x", {}, None)
        return Res("hello")

    assert rd.get_text("http://x", opener=opener, sleep=lambda s: None) == "hello"

    def nf(req, timeout):
        raise urllib.error.HTTPError("http://x", 404, "x", {}, None)

    with pytest.raises(rd.Final):
        rd.get_text("http://x", opener=nf, sleep=lambda s: None)
