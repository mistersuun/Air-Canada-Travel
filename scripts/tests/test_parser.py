"""Parser tests: pure text fixtures, no PDFs and no network."""


def recs(result, origin, dest):
    return result.routes.get((origin, dest), [])


def flights(result, origin, dest):
    return [r["flightNumber"] for r in recs(result, origin, dest)]


# --- day mask / row validation -------------------------------------------------

def test_parse_days_uses_mtwrfsu(fs):
    assert fs.parse_days("M-W-F--") == "Mon,Wed,Fri"
    assert fs.parse_days("---R--U") == "Thu,Sun"
    assert fs.parse_days("MTWRFSU") == "Mon,Tue,Wed,Thu,Fri,Sat,Sun"


def test_parse_days_rejects_wrong_letter_in_position(fs):
    assert fs.parse_days("MTWTFSS") is None   # T/S in R/U slots
    assert fs.parse_days("TTW----") is None   # T in the Monday slot
    assert fs.parse_days("W------") is None
    assert fs.parse_days("MTWRF-") is None    # 6 chars
    assert fs.parse_days("-------") is None   # no days at all


def test_parse_time_range(fs):
    assert fs.parse_time("00:00") == "00:00"
    assert fs.parse_time("23:59") == "23:59"
    assert fs.parse_time("7:05") == "07:05"
    assert fs.parse_time("24:00") is None
    assert fs.parse_time("12:60") is None


# --- structure ------------------------------------------------------------------

def test_page_break_mid_section_keeps_state(fs, pages):
    res = fs.parse_pages(pages("page_break.txt"), "page_break")
    out = recs(res, "YUL", "CMN")
    assert [r["fromDate"] for r in out] == ["2026-09-30", "2026-10-05", "2027-06-17"]
    assert out[0] == {
        "fromDate": "2026-09-30", "toDate": "2026-10-04", "days": "Wed,Fri,Sat,Sun",
        "flightNumber": "AC72", "departure": "19:10", "arrival": "06:15", "aircraft": "333",
    }
    assert flights(res, "CMN", "YUL") == ["AC73"]
    assert set(res.routes) == {("YUL", "CMN"), ("CMN", "YUL")}
    assert res.orphans == [] and res.rejects == []


def test_return_marker_before_outbound_uses_its_own_airport(fs, pages):
    res = fs.parse_pages(pages("return_first.txt"), "return_first")
    assert flights(res, "YYZ", "ICN") == ["AC63"]
    # The 'from ...' block must not inherit the previous block's ICN.
    assert flights(res, "NRT", "YYZ") == ["AC10"]
    assert flights(res, "YYZ", "NRT") == ["AC9"]
    assert ("ICN", "YYZ") not in res.routes


def test_marker_before_airport_line_after_page_break(fs, pages):
    res = fs.parse_pages(pages("return_first.txt"), "return_first")
    assert flights(res, "GRU", "YYZ") == ["AC91"]


def test_marker_and_airport_on_same_line(fs, pages):
    res = fs.parse_pages(pages("return_first.txt"), "return_first")
    assert flights(res, "YYZ", "MBJ") == ["AC1804"]
    assert res.orphans == [] and res.rejects == []


def test_accented_headers_are_recognised(fs, pages):
    res = fs.parse_pages(pages("accented.txt"), "accented")
    assert fs.is_city_header("Montréal (YUL)") == ("Montréal", "YUL")
    assert fs.is_city_header("Bogotá (BOG)") == ("Bogotá", "BOG")
    assert flights(res, "YUL", "BOG") == ["AC984"]
    assert flights(res, "BOG", "YUL") == ["AC985"]


def test_airport_line_that_looks_like_header_is_a_destination(fs, pages):
    res = fs.parse_pages(pages("accented.txt"), "accented")
    # "Timmins/Victor M. Power (YTS)" follows a direction line: it is the
    # destination airport, not a new origin section.
    assert flights(res, "YYZ", "YTS") == ["AC8435"]
    assert not any(o == "YTS" for (o, _d) in res.routes)


def test_backtick_apostrophe_header_starts_a_new_section(fs, pages):
    # 'St. John`s (YYT)' (backtick apostrophe, as printed in EasternCanada.pdf)
    # must open a new origin; before the fix its rows were filed under the
    # previous section, Sept-Iles (YZV).
    res = fs.parse_pages(pages("st_johns.txt"), "st_johns")
    assert flights(res, "YZV", "YUL") == ["AC8911"]
    assert flights(res, "YYT", "YYZ") == ["AC691"]
    assert flights(res, "YYZ", "YYT") == ["AC690"]
    assert not any("YZV" in k and "YYZ" in k for k in res.routes)
    assert fs.is_city_header("St. John\u2019s (YYT)") == ("St. John\u2019s", "YYT")
    assert fs.is_city_header("Chicago O`Hare International Airport (ORD)") is None


def test_malformed_rows_are_rejected_with_reasons(fs, pages):
    res = fs.parse_pages(pages("malformed.txt"), "malformed")
    assert flights(res, "YOW", "FLL") == ["AC1612"]
    reasons = {r["text"].split()[3]: r["reason"] for r in res.rejects}
    assert reasons["AC1614"].startswith("malformed day mask")
    assert reasons["AC1616"].startswith("malformed day mask")
    assert reasons["AC1618"].startswith("malformed day mask")
    assert reasons["AC1620"].startswith("malformed day mask")
    assert reasons["AC1622"] == "invalid time"
    assert reasons["AC1624"] == "fromDate after toDate"
    assert reasons["AC1626"] == "invalid date"
    assert reasons["XX1628"] == "unparseable row"
    for r in res.rejects:
        assert r["source"] == "malformed" and r["page"] == 1 and r["line"] > 0


def test_rows_without_origin_or_direction_are_orphans(fs, pages):
    res = fs.parse_pages(pages("malformed.txt"), "malformed")
    assert [o["text"].split()[3] for o in res.orphans] == ["AC999"]
    assert res.orphans[0]["line"] == 2


def test_parse_text_splits_on_form_feed(fs):
    text = "Montreal (YUL)\nMontreal to Paris\nCDG Airport (CDG)\nto ...\n\f" \
           "2026-10-01 2026-10-31 MTWRFSU AC870 18:30 07:45 333\n"
    res = fs.parse_text(text, "ff")
    assert flights(res, "YUL", "CDG") == ["AC870"]
    assert res.orphans[:] == []


# --- merge / dedupe / conflicts -------------------------------------------------

def _merge(fs, pages, a_published, b_published):
    a = fs.parse_pages(pages("conflict_a.txt"), "a")
    b = fs.parse_pages(pages("conflict_b.txt"), "b")
    logs = []
    routes, conflicts = fs.merge_routes(
        [(fs.Source("a.pdf", published=a_published), a),
         (fs.Source("b.pdf", published=b_published), b)], log=logs.append)
    return routes, conflicts, logs


def test_exact_duplicates_are_collapsed(fs, pages):
    routes, _, _ = _merge(fs, pages, 1.0, 2.0)
    ac870 = [r for r in routes[("YUL", "CDG")] if r["flightNumber"] == "AC870"]
    assert len(ac870) == 1


def test_conflict_keeps_latest_published_pdf(fs, pages):
    routes, conflicts, logs = _merge(fs, pages, 1.0, 2.0)
    ac872 = [r for r in routes[("YUL", "CDG")] if r["flightNumber"] == "AC872"]
    assert [(r["departure"], r["arrival"]) for r in ac872] == [("21:30", "10:30")]
    assert any("CONFLICT" in c and "AC872" in c and "b.pdf" in c for c in conflicts)
    assert logs == conflicts

    routes, _, _ = _merge(fs, pages, 2.0, 1.0)
    ac872 = [r for r in routes[("YUL", "CDG")] if r["flightNumber"] == "AC872"]
    assert [(r["departure"], r["arrival"]) for r in ac872] == [("21:00", "10:00")]


def test_conflict_tie_break_is_deterministic(fs, pages):
    first = _merge(fs, pages, 0.0, 0.0)[0]
    second = _merge(fs, pages, 0.0, 0.0)[0]
    assert first == second
    ac872 = [r for r in first[("YUL", "CDG")] if r["flightNumber"] == "AC872"]
    assert ac872[0]["departure"] == "21:00"  # a.pdf wins on name when undated


def test_overlapping_ranges_with_shared_days_are_logged(fs, pages):
    routes, conflicts, _ = _merge(fs, pages, 1.0, 2.0)
    # AC874 11-01..11-15 M-W-F vs 11-09..11-20 M: both fly Monday 11-09, different times.
    assert any("AC874 on 2026-11-09" in c and "overlapping" in c for c in conflicts)
    assert len([r for r in routes[("YUL", "CDG")] if r["flightNumber"] == "AC874"]) == 2


def _conflicts_for(fs, rows):
    text = "Montreal (YUL)\nMontreal to Paris\nCDG (CDG)\nto ...\n" + "".join(r + "\n" for r in rows)
    _, conflicts = fs.merge_routes([(fs.Source("x"), fs.parse_text(text))], log=lambda m: None)
    return conflicts


def test_overlap_without_a_common_operating_date_is_not_a_conflict(fs):
    # Real false alarm from the log (YUL-LHR AC864): ranges and weekday sets both
    # overlap, but 05-19..05-23 Wed,Sun and 05-21..05-29 Mon,Tue,Wed,Fri,Sat
    # share no date (the only Wednesday in 05-21..05-23 is none: 05-21 is a Friday).
    assert _conflicts_for(fs, [
        "2027-05-19 2027-05-23 --W---U AC864 20:40 08:10 333",
        "2027-05-21 2027-05-29 MTW-FS- AC864 20:50 08:20 333",
    ]) == []


def test_overlap_on_a_real_common_date_is_a_conflict_naming_it(fs):
    # BOS-YUL AC8611 shape: a one-day retime inside a longer filing.
    conflicts = _conflicts_for(fs, [
        "2026-10-08 2026-10-08 ---R--- AC8611 18:50 20:19 E75",
        "2026-10-08 2026-10-15 M--RF-U AC8611 19:00 20:29 E75",
    ])
    assert len(conflicts) == 1 and "on 2026-10-08" in conflicts[0]


def test_shared_operating_date(fs):
    a = {"fromDate": "2026-10-01", "toDate": "2026-10-31", "days": "Mon"}
    b = {"fromDate": "2026-10-10", "toDate": "2026-12-31", "days": "Mon,Tue"}
    assert fs.shared_operating_date(a, b) == "2026-10-12"
    assert fs.shared_operating_date(a, {**b, "days": "Tue"}) is None
    assert fs.shared_operating_date(a, {**b, "fromDate": "2026-11-01"}) is None


def test_records_sorted_by_flight_then_date(fs):
    res = fs.parse_text(
        "Montreal (YUL)\nMontreal to Paris\nCDG (CDG)\nto ...\n"
        "2026-11-01 2026-11-30 MTWRFSU AC870 18:30 07:45 333\n"
        "2026-10-01 2026-10-31 MTWRFSU AC870 18:30 07:45 333\n"
        "2026-10-01 2026-10-31 MTWRFSU AC1870 18:30 07:45 333\n"
        "2026-10-01 2026-10-31 MTWRFSU AC88 18:30 07:45 333\n")
    routes, _ = fs.merge_routes([(fs.Source("x"), res)], log=lambda m: None)
    got = [(r["flightNumber"], r["fromDate"]) for r in routes[("YUL", "CDG")]]
    assert got == [("AC88", "2026-10-01"), ("AC870", "2026-10-01"),
                   ("AC870", "2026-11-01"), ("AC1870", "2026-10-01")]
