"""Tests for scripts/build-cities.py (pure parsing/compaction plus the committed file's budget)."""

import gzip
import importlib.util
import json
import pathlib
import sys

import pytest

SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
CITIES_JSON = SCRIPTS.parent / "public" / "data" / "cities.json"


def _load():
    name = "build_cities"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / "build-cities.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


bc = _load()

CITIES_TXT = "\n".join([
    # geonameid name ascii alternatenames lat lng fclass fcode cc cc2 a1 a2 a3 a4 pop elev dem tz mod
    "2510911\tSevilla\tSevilla\tSeville,Séville\t37.38283\t-5.97317\tP\tPPLA\tES\t\t51\tSE\t41091\t\t686741\t\t16\tEurope/Madrid\t2026-03-23",
    "2267057\tLisbon\tLisbon\tLisboa\t38.72509\t-9.1498\tP\tPPLC\tPT\t\t14\t1106\t\t\t517802\t\t45\tEurope/Lisbon\t2026-01-01",
    "6077243\tMontréal\tMontreal\t\t45.50884\t-73.58781\tP\tPPLA2\tCA\t\t10\t06\t\t\t1762949\t\t216\tAmerica/Toronto\t2026-01-01",
    "3094802\tKraków\tKrakow\t\t50.06143\t19.93658\tP\tPPLA\tPL\t\t72\t1261\t\t\t804237\t\t219\tEurope/Warsaw\t2026-01-01",
    "9999999\tTinyville\tTinyville\t\t10.0\t10.0\tP\tPPL\tFR\t\t\t\t\t\t15500\t\t\tEurope/Paris\t2026-01-01",
    "bad\trow",
    "8888888\tNo Zone\tNo Zone\t\t1\t1\tP\tPPL\tFR\t\t\t\t\t\t20000\t\t\t\t2026-01-01",
])

ADMIN1_TXT = "ES.51\tAndalusia\tAndalusia\t2593109\nPT.14\tLisbon\tLisbon\t2267056\nCA.10\tQuebec\tQuebec\t6115047\n"

ALT_TXT = "\n".join([
    "1\t2510911\ten\tSeville\t1\t1\t\t\t\t",
    "2\t2510911\tes\tSevilla\t1\t1\t\t\t\t",
    "3\t2510911\tfr\tSéville\t\t\t\t\t\t",
    "4\t2510911\tpt\tSevilha\t\t\t\t\t\t",
    "5\t2510911\tit\tSiviglia\t\t\t\t\t\t",
    "6\t2510911\tla\tHispalis\t\t\t\t1\t\t",
    "7\t2510911\tru\tСевилья\t\t\t\t\t\t",
    "8\t2267057\ten\tLisbon\t1\t\t\t\t\t",
    "9\t2267057\tpt\tLisboa\t1\t\t\t\t\t",
    "10\t2267057\tfr\tLisbonne\t\t\t\t\t\t",
    "11\t2267057\tde\tLissabon\t\t\t\t\t\t",
    "12\t2267057\tit\tLisbona\t\t\t\t\t\t",
    "13\t2267057\tnl\tLissabon\t\t\t\t\t\t",
    "14\t6077243\ten\tMontreal\t1\t\t\t\t\t",
    "15\t6077243\ten\tMontreal City\t\t\t\t\t\t",
    "16\t3094802\ten\tKrakow\t1\t\t\t\t\t",
    "17\t3094802\ten\tCracow\t\t\t\t1\t\t",
    "18\t3094802\tfr\tCracovie\t1\t\t\t\t\t",
    "19\t3094802\tde\tKrakau\t1\t\t\t\t\t",
    "20\t9999999\ten\tTiny Town\t1\t\t\t\t\t",
    "21\t9999999\tfr\tPetiteville\t\t\t\t\t\t",
    "22\t1234\ten\tElsewhere\t1\t\t\t\t\t",
    "23\t2510911\ten\tSevilla the Very Long Colloquial Name\t\t\t1\t\t\t",
])


@pytest.fixture
def built():
    cities = bc.parse_cities(CITIES_TXT.splitlines())
    alts = bc.parse_alt_names(ALT_TXT.splitlines(), {c["id"] for c in cities})
    admin1 = bc.parse_admin1(ADMIN1_TXT.splitlines())
    return bc.build_file(cities, alts, admin1, "2026-10-01T00:00:00Z")


def by_name(rows, name):
    return next(r for r in rows if r["name"] == name)


def test_fold_and_latin():
    assert bc.fold("Séville") == "seville"
    assert bc.fold("  KRAKÓW ") == "krakow"
    assert bc.is_latin("Kraków")
    assert bc.is_latin("Cidade do México")
    assert not bc.is_latin("Севилья")
    assert not bc.is_latin("123")


def test_parse_cities_skips_bad_rows():
    cities = bc.parse_cities(CITIES_TXT.splitlines())
    assert [c["id"] for c in cities] == [2510911, 2267057, 6077243, 3094802, 9999999]
    sev = cities[0]
    assert sev["cc"] == "ES" and sev["tz"] == "Europe/Madrid" and sev["pop"] == 686741


def test_parse_alt_names_filters_language_wanted_and_flags():
    alts = bc.parse_alt_names(ALT_TXT.splitlines(), {2510911})
    names = [a["name"] for a in alts[2510911]]
    assert "Hispalis" not in names  # Latin, but historic and not in ALT_LANGS
    assert "Севилья" not in names  # ru not kept
    assert all("Colloquial" not in n for n in names)
    assert 1234 not in alts


def test_display_name_prefers_english_but_keeps_accents(built):
    rows = bc.decode_rows(built)
    names = [r["name"] for r in rows]
    assert "Seville" in names  # en preferred over 'Sevilla'
    assert "Montréal" in names  # 'Montreal' only differs by accents
    assert "Kraków" in names
    assert "Tiny Town" in names


def test_alternate_names(built):
    rows = bc.decode_rows(built)
    assert by_name(rows, "Seville")["alt"] == ["Sevilla", "Sevilha", "Siviglia"]  # Séville folds to Seville
    lis = by_name(rows, "Lisbon")["alt"]
    assert lis == ["Lisbonne", "Lisboa", "Lissabon", "Lisbona"]
    assert len(lis) <= bc.MAX_ALTS
    assert by_name(rows, "Kraków")["alt"] == ["Cracovie", "Krakau"]
    assert by_name(rows, "Tiny Town")["alt"] == []  # under 100k people


def test_columns_round_trip(built):
    cols = built["cols"]
    n = len(cols["id"])
    assert all(len(v) == n for v in cols.values())
    assert built["license"] == "CC BY 4.0"
    assert built["attribution"] == "GeoNames (geonames.org)"
    rows = bc.decode_rows(built)
    ids = [r["id"] for r in rows]
    assert ids == sorted(ids)
    sev = by_name(rows, "Seville")
    assert sev["id"] == 2510911
    assert sev["cc"] == "ES" and sev["admin1"] == "Andalusia"
    assert sev["lat"] == 37.38 and sev["lng"] == -5.97
    assert sev["pop"] == 687 and sev["tz"] == "Europe/Madrid"
    assert by_name(rows, "Tiny Town")["admin1"] is None


@pytest.mark.skipif(not CITIES_JSON.exists(), reason="public/data/cities.json not generated")
def test_committed_file_budget_and_contents():
    raw = CITIES_JSON.read_bytes()
    assert len(raw) <= bc.SIZE_CAP
    assert len(gzip.compress(raw, 9)) <= bc.GZIP_CAP
    file = json.loads(raw)
    assert file["v"] == 1 and file["license"] == "CC BY 4.0"
    rows = {r["id"]: r for r in bc.decode_rows(file)}
    assert len(rows) > 20_000
    assert rows[2510911]["name"] == "Seville" and "Sevilla" in rows[2510911]["alt"]
    assert rows[2267057]["name"] == "Lisbon" and "Lisboa" in rows[2267057]["alt"]
    assert rows[6077243]["name"] == "Montréal"
    assert rows[3094802]["name"] == "Kraków"
