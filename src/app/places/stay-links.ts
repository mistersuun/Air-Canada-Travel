/**
 * "Stuck tonight?" deep links: a hotel or hostel search for tonight near an
 * airport. Plain links only: no affiliate ids, no prices, no availability
 * claims. They open the site's own search with the place and dates filled in.
 *
 *   Booking.com   https://www.booking.com/searchresults.html?ss=<place>&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&group_adults=1&no_rooms=1
 *   Hostelworld   https://www.hostelworld.com/   (home page only: its search URL needs internal ids; the label names the airport)
 *   Google Maps   https://www.google.com/maps/search/?api=1&query=hotels+near+<airport>
 */
import { addDays } from '../utils/time';

export interface StayLink { id: 'booking' | 'hostelworld' | 'maps'; label: string; href: string }

const q = encodeURIComponent;

/** 'Madrid MAD Airport' unless the name already says airport. */
export function airportSearchText(name: string, code: string): string {
  return /airport/i.test(name) ? name : `${name} ${code} Airport`;
}

export function stayLinks(input: { airportName: string; code: string; checkIn: string }): StayLink[] {
  const place = airportSearchText(input.airportName, input.code);
  const out = addDays(input.checkIn, 1);
  return [
    {
      id: 'booking', label: 'Search hotels on Booking.com ↗',
      href: `https://www.booking.com/searchresults.html?ss=${q(place)}&checkin=${input.checkIn}&checkout=${out}&group_adults=1&no_rooms=1`,
    },
    {
      id: 'hostelworld', label: `Search hostels near ${input.code} on Hostelworld \u2197`,
      href: 'https://www.hostelworld.com/',
    },
    {
      id: 'maps', label: 'Hotels near the airport on Google Maps ↗',
      href: `https://www.google.com/maps/search/?api=1&query=${q(`hotels near ${place}`)}`,
    },
  ];
}

/** The night "tonight" means at the local date and time: before 05:00 it is still last night's stay. */
export function tonightCheckIn(localDate: string, localHhmm: string): string {
  return localHhmm < '05:00' ? addDays(localDate, -1) : localDate;
}
