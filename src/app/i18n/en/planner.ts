/**
 * Round-trip planner (planner/round-trip.ts, the picker, /plan, the Dates bar
 * on Destination, the Flight page's return card, Home's button and the shared
 * DayCountStrip / StayChips). Keys start with 'planner.'. The words are the
 * spec's (dates-spec §3): "ways home" / « retours », counts of scheduled
 * flights only, never seats.
 */
export const planner = {
  /** Route title (app.routes.ts, /plan/:code). */
  'planner.title': 'Round trip · Routes',

  // ── Shared counts and words ────────────────────────────────────────────────
  'planner.nights': '{n, plural, one {# night} other {# nights}}',
  'planner.flights': '{n, plural, one {# flight} other {# flights}}',
  'planner.count.home': '{n} home',
  'planner.count.waysHome': '{n, plural, one {# way home} other {# ways home}}',
  'planner.count.nonstop': '{n} nonstop',
  'planner.count.connOnly': 'connections only',
  'planner.unpublished': 'Not yet published',
  'planner.go': 'Go',
  'planner.next': 'next: {date}',
  'planner.dayTrip': 'Day trip',
  'planner.conn.nonstopsOnly': 'Nonstops only',
  'planner.conn.included': 'Incl. connections',
  'planner.conn.include': 'Include connections',
  'planner.conn.hidden': '{n, plural, one {# with a connection hidden} other {# with a connection hidden}}',
  'planner.after.earliest': 'after the earliest arrival ({when})',
  'planner.after.picked': 'after {flight} lands ({when})',
  'planner.after.this': 'after this flight lands ({when})',
  'planner.after.youLand': 'after you land ({when})',

  // ── Picker (/calendar/:code) ───────────────────────────────────────────────
  'planner.picker.cancel': 'Cancel',
  'planner.picker.clear': 'Clear',
  'planner.picker.cleared': 'Dates cleared',
  'planner.picker.leave': 'Leave',
  'planner.picker.home': 'Home',
  'planner.picker.pickDay': 'Pick a day',
  'planner.picker.step1': '1 of 2 · Tap the day you leave',
  'planner.picker.step2': '2 of 2 · Now tap the day you fly home',
  'planner.picker.step2Sub': 'Tap an earlier day to change your departure',
  'planner.picker.stepDone': 'Dates set · tap See flights, or tap another day',
  'planner.picker.seasonal': 'First flights: {date}',
  'planner.picker.jump': 'Jump',
  'planner.picker.bannerOut': 'Flights out · {from} → {to}',
  'planner.picker.bannerHome': 'Flights home · {from} → {to}',
  'planner.picker.countedAfter': 'Counted after the earliest arrival ({when})',
  'planner.picker.viewCalendar': 'Calendar',
  'planner.picker.viewList': 'List',
  'planner.picker.viewAria': 'Show days as',
  'planner.picker.noOut': 'No flights out on {date}',
  'planner.picker.noHome': 'No flights home on {date}',
  'planner.picker.unpublishedPeek': 'Not yet published · schedules end {date}',
  'planner.picker.noSameDay': 'No way home the same day',
  'planner.picker.monthNonstops': 'Nonstops: {days}',
  'planner.picker.peekIdle': 'Counts are scheduled flights, not seats',
  'planner.picker.peekDep': 'Leave {date} · {summary}',
  'planner.picker.peekRet': 'Home {date} · {nights} · {summary}',
  'planner.picker.btnNone': 'Tap the day you leave',
  'planner.picker.btnOneWay': 'See flights · one way · {date}',
  'planner.picker.btnRange': 'See flights · {range} · {nights}',
  'planner.picker.loading': 'Loading schedules…',
  'planner.picker.noHomeAfter': 'No published ways home after {date}',
  'planner.picker.droppedDep': 'No flights to {city} on {date} · pick a day',

  // ── Day cells (aria) ───────────────────────────────────────────────────────
  'planner.cell.out': '{n, plural, one {# flight out} other {# flights out}}',
  'planner.cell.split': '{direct} nonstop and {connecting} with a connection',
  'planner.cell.none': 'no flights',
  'planner.cell.past': 'past',
  'planner.cell.unpublished': 'not yet published',
  'planner.cell.loading': 'loading',
  'planner.cell.beforeDep': 'before you leave',

  // ── Legend ─────────────────────────────────────────────────────────────────
  'planner.legend.title': 'Key',
  'planner.legend.out': 'Flights out each day',
  'planner.legend.home': 'Ways home each day',
  'planner.legend.nonstop': 'has a nonstop',
  'planner.legend.conn': 'connections only',
  'planner.legend.none': 'no flights',
  'planner.legend.unpublished': 'not yet published',
  'planner.legend.holiday': 'holiday',
  'planner.legend.break': 'school break',

  // ── Round trip page (/plan/:code) ──────────────────────────────────────────
  'planner.plan.title': 'Round trip',
  'planner.plan.pickHome': '{dep} → pick a day home',
  'planner.plan.change': 'Change',
  'planner.plan.pick': 'Pick',
  'planner.plan.notices': 'Notices',
  'planner.plan.outHeading': 'Flights out · {date}',
  'planner.plan.homeHeading': 'Ways home · {date}',
  'planner.plan.outAria': 'Flights out on {date}',
  'planner.plan.homeAria': 'Ways home on {date}',
  'planner.plan.showAll': 'Show all {n}',
  'planner.plan.noOut': 'No flights out on {date}',
  'planner.plan.ruleAfterPicked': 'Leaving at least {min} min after {flight} lands ({when})',
  'planner.plan.ruleAfterEarliest': 'Leaving at least {min} min after the earliest arrival ({when})',
  'planner.plan.stayIn': '{dur} in {city}',
  'planner.plan.noHome': 'No ways home on {date} after you land',
  'planner.plan.nearest': 'Nearest:',
  'planner.plan.ics': 'Round trip .ics',
  'planner.plan.barAria': 'Your round trip',
  'planner.plan.barOut': 'Out · {flight} {time}',
  'planner.plan.barOutPick': 'Out · pick one ({n})',
  'planner.plan.barHome': 'Home · {flight} {time}',
  'planner.plan.barHomePick': 'Home · pick one ({n})',
  'planner.plan.start': 'Start a trip',
  'planner.plan.addTo': 'Add to {name} trip',
  'planner.plan.needOut': 'Pick a flight out first',
  'planner.plan.unpublishedBody': 'Schedules end {date}. Pick an earlier day.',
  'planner.plan.seasonal': 'Next flight out: {date}',
  'planner.plan.announceOut': '{n, plural, one {# flight out} other {# flights out}} on {date}',
  'planner.plan.announceHome': '{n, plural, one {# way home} other {# ways home}} on {date}',
  'planner.plan.stripPrev': 'Earlier days',
  'planner.plan.stripNext': 'Later days',

  // ── Notices (D6) ───────────────────────────────────────────────────────────
  'planner.toast.carryNonstop': '{flight} doesn’t fly {date} · earliest nonstop: {suggestion}',
  'planner.toast.carryConn': '{flight} doesn’t fly {date} · earliest connection: {suggestion}',
  'planner.toast.carryNone': '{flight} doesn’t fly {date}',
  'planner.toast.beforeLanding': '{flight} leaves before you land · pick another way home',
  'planner.toast.backGone': '{flight} doesn’t fly home on {date} · pick another way home',
  'planner.toast.retMoved': 'Home moved to {date} to keep {nights}',
  'planner.toast.pick': 'Pick',
  'planner.toast.dismiss': 'Dismiss',

  // ── Stay chips ─────────────────────────────────────────────────────────────
  'planner.chips.aria': 'Length of stay',
  'planner.chips.question': 'When are you coming home?',
  'planner.chips.unpublished': 'not published',
  'planner.chips.other': 'Other',
  'planner.chips.fewer': 'One night fewer',
  'planner.chips.more': 'One night more',

  // ── Destination (/to/:code) ────────────────────────────────────────────────
  'planner.dest.when': 'When are you going?',
  'planner.dest.pickDates': 'Pick dates',
  'planner.dest.depOnly': 'Leave {date} · pick a day home',
  'planner.dest.seeFlights': 'See flights',
  'planner.dest.clearDates': 'Clear dates',
  'planner.dest.from': 'From {date}',
  'planner.dest.clearFrom': 'Show every day',
  'planner.dest.fullCalendar': 'Full calendar',
  'planner.dest.waysHomeTab': 'Ways home',
  'planner.dest.homeHeading': 'Leaving {code} after you land ({when})',
  'planner.dest.nextHome': 'Next flights home from {city}',
  'planner.dest.pickToMatch': 'Pick dates to match these to your stay',
  'planner.dest.seasonalHome': 'No flights home until {date}',
  'planner.dest.stripAria': 'Flights out by day',

  // ── Flight page (/flight) ──────────────────────────────────────────────────
  'planner.flight.coming': 'Coming home',
  'planner.flight.more': '+{n} more',
  'planner.flight.planRound': 'Plan round trip',

  // ── Home ───────────────────────────────────────────────────────────────────
  'planner.home.plan': 'Plan a round trip',

  // ── Round trip bar (WS-C) ──────────────────────────────────────────────────
  'planner.plan.barHomeNoDay': 'Home · pick a day',
};
