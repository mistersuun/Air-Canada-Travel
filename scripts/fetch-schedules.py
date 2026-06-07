#!/usr/bin/env python3
"""
Fetches Air Canada Vacations schedule PDFs and regenerates schedules.ts.
Run manually or via GitHub Actions.

Usage:
  python3 scripts/fetch-schedules.py [--dry-run]
"""

import re
import sys
import urllib.request
from collections import defaultdict

try:
    import pdfplumber
except ImportError:
    print("pdfplumber not installed. Run: pip install pdfplumber")
    sys.exit(1)

# ---------------------------------------------------------------------------
# PDF URLs
# ---------------------------------------------------------------------------
PDF_URLS = [
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-ASIA-Asia.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-SOUTHPACIFIC-Australia.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-SOUTHPACIFIC-NewZealand.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-CANADA-AtlanticCanada.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-CANADA-EasternCanada.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-CANADA-NorthernCanada.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-CANADA-WesternCanada.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-SUN-Bahamas.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-SUN-Barbados.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-SUN-DominicanRepublic.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-SUN-EasternCaribbean.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-SUN-Jamaica.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-SUN-SouthernCaribbean.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-SUN-WesternCaribbean.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-EUROPE-CentralEurope.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-EUROPE-England.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-EUROPE-France.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-EUROPE-Greece.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-EUROPE-Ireland.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-EUROPE-Italy.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-EUROPE-NorthernEurope.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-EUROPE-Portugal.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-EUROPE-Scotland.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-EUROPE-Spain.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-EUROPE-WesternEurope.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-SUN-CentralMexico.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-SUN-EastCoastMexico.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-SUN-WestCoastMexico.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-AFRICA-NorthernAfrica.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-MIDDLEEAST-MiddleEast.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-SOUTHANDCENTRALAMERICA-CentralAmerica.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-SOUTHANDCENTRALAMERICA-CostaRica.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-SOUTHANDCENTRALAMERICA-SouthAmerica.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-USA-California.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-USA-Florida.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-USA-Hawaii.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-USA-LasVegas.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-USA-MidwestUSA.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-USA-NorthEastUSA.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-USA-SouthUSA.pdf",
    "https://vacations.aircanada.com/en/travel-info/where-we-fly/files/EN-USA-WesternUSA.pdf",
]

# ---------------------------------------------------------------------------
# Day bitmask → comma-separated day names
# Format in PDF: MTWRFSU where - means absent
# ---------------------------------------------------------------------------
DAY_CHARS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
DAY_KEYS   = ['M',   'T',   'W',   'R',   'F',   'S',   'U']

def parse_days(bitmask: str) -> str:
    """Convert 'M-W-F--' → 'Mon,Wed,Fri'"""
    days = []
    for i, char in enumerate(bitmask[:7]):
        if char != '-':
            days.append(DAY_CHARS[i])
    return ','.join(days)


# ---------------------------------------------------------------------------
# Schedule row pattern
# Example: "2026-12-07 2027-03-08 M------ AC2092 08:15 16:45 7M8"
# ---------------------------------------------------------------------------
ROW_RE = re.compile(
    r'(\d{4}-\d{2}-\d{2})\s+'   # fromDate
    r'(\d{4}-\d{2}-\d{2})\s+'   # toDate
    r'([MTW-][TW-][W-]{1}[R-][F-][S-][U-])\s+'  # days (7 chars)
    r'(AC\d{3,4})\s+'           # flightNumber
    r'(\d{2}:\d{2})\s+'         # departure
    r'(\d{2}:\d{2})\s+'         # arrival
    r'(\w+)'                     # aircraft
)

# Airport code in parentheses e.g. "(MBJ)"
AIRPORT_CODE_RE = re.compile(r'\(([A-Z]{3})\)')

# City section header: short name + code, must NOT be an airport name
# "Edmonton (YEG)" ✓   "Norman Manley International Airport (KIN)" ✗
CITY_HEADER_RE = re.compile(r'^([A-Za-z /\-\'\.]{2,30})\s+\(([A-Z]{3})\)\s*$')
AIRPORT_WORDS = {'airport', 'aéroport', 'international', 'terminal', 'pearson', 'stanfield'}


def is_city_header(line: str) -> tuple:
    """Returns (city_name, code) if line is a city section header, else None."""
    m = CITY_HEADER_RE.match(line)
    if not m:
        return None
    city = m.group(1).lower()
    # Reject airport name lines
    if any(w in city for w in AIRPORT_WORDS):
        return None
    return (m.group(1), m.group(2))


def extract_routes_from_pdf(pdf_bytes: bytes) -> dict:
    """
    Returns dict: { (originCode, destCode): [schedules] }

    The PDFs use literal "to ..." and "from ..." marker lines to indicate
    outbound vs return legs. We collect only outbound rows.

    PDF structure per route block:
      [OriginCity] ([OriginCode])          ← city section header
      [OriginCity] Airport                 ← ignored
      [OriginCity] to [DestCity]           ← route direction line
      [DestCity] Airport ([DestCode])      ← dest airport with code
      to ...                               ← OUTBOUND marker
      From Date  To Date  Days  ...        ← column header (skipped)
      [schedule rows]
      [DestCity] to [OriginCity]           ← return direction line
      [DestCity] Airport ([DestCode])      ← same dest airport
      from ...                             ← RETURN marker (skip rows)
      [schedule rows — skipped]
    """
    import io
    routes = defaultdict(list)

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        full_text = '\n'.join(
            page.extract_text() or '' for page in pdf.pages
        )
        lines = full_text.split('\n')

    current_origin = None
    last_airport_code = None  # most recent (XXX) code seen
    collecting = False        # True = outbound, False = skip/return

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # 1. City section header → new origin, reset state
        city = is_city_header(line)
        if city:
            current_origin = city[1]
            collecting = False
            continue

        # 2. Any airport code line → remember it as potential dest code
        code_m = AIRPORT_CODE_RE.search(line)
        if code_m:
            last_airport_code = code_m.group(1)

        # 3. Outbound marker: literal "to ..." line
        if line == 'to ...':
            collecting = True
            current_dest = last_airport_code
            continue

        # 4. Return marker: literal "from ..." line
        if line == 'from ...':
            collecting = False
            continue

        # 5. Schedule row — only collect when in outbound mode
        if collecting and current_origin and current_dest:
            row_m = ROW_RE.search(line)
            if row_m:
                from_date, to_date, days_raw, flight_num, dep, arr, aircraft = row_m.groups()
                days = parse_days(days_raw)
                if days:
                    routes[(current_origin, current_dest)].append({
                        'fromDate': from_date,
                        'toDate': to_date,
                        'days': days,
                        'flightNumber': flight_num,
                        'departure': dep,
                        'arrival': arr,
                        'aircraft': aircraft,
                    })

    return routes


def fetch_pdf(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def generate_ts(all_routes: dict) -> str:
    lines = [
        '// Auto-generated from Air Canada Vacations flight schedule PDFs',
        '// Source: https://vacations.aircanada.com/en/plan-your-trip/travel-info/where-we-fly',
        '// DO NOT EDIT MANUALLY — run scripts/fetch-schedules.py to regenerate',
        '',
        'export interface FlightSchedule {',
        '  fromDate: string;',
        '  toDate: string;',
        '  days: string;',
        '  flightNumber: string;',
        '  departure: string;',
        '  arrival: string;',
        '  aircraft: string;',
        '}',
        '',
        'export interface RouteSchedule {',
        '  originCode: string;',
        '  destinationCode: string;',
        '  schedules: FlightSchedule[];',
        '}',
        '',
        'export function getSchedulesForRoute(originCode: string, destinationCode: string): FlightSchedule[] {',
        '  const route = ROUTE_SCHEDULES.find(',
        '    r => r.originCode === originCode && r.destinationCode === destinationCode',
        '  );',
        '  return route?.schedules ?? [];',
        '}',
        '',
        'export const ROUTE_SCHEDULES: RouteSchedule[] = [',
    ]

    for (origin, dest), schedules in sorted(all_routes.items()):
        if not schedules:
            continue
        lines.append(f'  {{ originCode: "{origin}", destinationCode: "{dest}", schedules: [')
        for s in schedules:
            lines.append(
                f'    {{ fromDate: "{s["fromDate"]}", toDate: "{s["toDate"]}", '
                f'days: "{s["days"]}", flightNumber: "{s["flightNumber"]}", '
                f'departure: "{s["departure"]}", arrival: "{s["arrival"]}", '
                f'aircraft: "{s["aircraft"]}" }},'
            )
        lines.append('  ] },')

    lines.append('];')
    return '\n'.join(lines) + '\n'


def main():
    dry_run = '--dry-run' in sys.argv
    all_routes = defaultdict(list)
    errors = []

    for url in PDF_URLS:
        name = url.split('/')[-1]
        print(f"Fetching {name}...", end=' ', flush=True)
        try:
            pdf_bytes = fetch_pdf(url)
            routes = extract_routes_from_pdf(pdf_bytes)
            count = sum(len(v) for v in routes.values())
            print(f"{len(routes)} routes, {count} schedule entries")
            for key, schedules in routes.items():
                all_routes[key].extend(schedules)
        except Exception as e:
            print(f"ERROR: {e}")
            errors.append((name, str(e)))

    print(f"\nTotal: {len(all_routes)} routes")

    ts_content = generate_ts(all_routes)

    if dry_run:
        print("\n--- DRY RUN: not writing file ---")
        print(ts_content[:500])
        return

    out_path = 'src/app/data/schedules.ts'
    with open(out_path, 'w') as f:
        f.write(ts_content)
    print(f"Written to {out_path}")

    if errors:
        print(f"\nWarnings — {len(errors)} PDF(s) failed:")
        for name, err in errors:
            print(f"  {name}: {err}")
        sys.exit(1)


if __name__ == '__main__':
    main()
