import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n/locale';
import { SEVILLE_PLACE, sevilleTrip } from '../trips/testing/seville-fixture';
import { cityOptionLabel, loungeLabel, terminalLabel, type AirportInfo } from './airport-info';
import { aboutDuration, airportEnd, groundEstimate } from './ground';
import { distanceLabel } from './airport-hotels';
import { otherWays } from './other-ways';
import { entryItems } from './prep';
import { stayLinks } from './stay-links';

const nbsp = (s: string) => s.replace(/[  ]/g, ' ');

beforeEach(() => setLocale('fr'));
afterEach(() => setLocale('en'));

describe('places in French', () => {
  it('ground estimates read in French', () => {
    expect(nbsp(aboutDuration(160))).toBe('2 h 40');
    expect(nbsp(aboutDuration(45))).toBe('45 min');
    const g = groundEstimate(airportEnd('MAD')!, SEVILLE_PLACE);
    expect(nbsp(g.label)).toBe('Train environ 2 h 40');
    expect(g.exitLabel).toBe('Passeport, sortie, rejoindre Atocha');
    expect(g.frequency).toBe('trains environ toutes les heures');
    expect(nbsp(groundEstimate(airportEnd('LIS')!, SEVILLE_PLACE).label)).toBe('Autocar environ 6 h 45');
    expect(nbsp(groundEstimate(airportEnd('BCN')!, SEVILLE_PLACE).label)).toBe('Train environ 6 h 20, ou un vol court');
  });

  it('entry reminders, links and distances', () => {
    const items = entryItems(sevilleTrip());
    expect(items[0].title).toBe('Passeport valide au moins 3 mois après votre départ');
    expect(items[0].link!.label).toBe('Conseils du gouvernement du Canada');
    expect(nbsp(distanceLabel(1200))).toBe('environ 1 km');
    expect(nbsp(distanceLabel(1400))).toBe('environ 1,5 km');
    const ways = otherWays({ from: airportEnd('MAD')!, to: { name: 'Seville', lat: 37.38, lng: -5.97 }, dateKey: '2026-10-09' });
    expect(ways[0].label).toBe('Chercher MAD → Seville sur Busbud ↗');
    expect(stayLinks({ airportName: 'Madrid', code: 'MAD', checkIn: '2026-10-09' })[1].label).toBe('Chercher des auberges près de MAD sur Hostelworld ↗');
    const info: AirportInfo = {
      terminals: ['1', '3'], singleTerminal: false, mapleLeafLounge: true, loungeClosed: false, loungeNote: '', toCity: [], source: '', reviewed: '',
    };
    expect(terminalLabel(info)).toBe('Terminaux 1 et 3');
    expect(nbsp(loungeLabel(info))).toBe("Salon Feuille d'érable : oui");
    expect(nbsp(cityOptionLabel({ mode: 'bus', min: 25, note: 'SL1' }))).toBe('Autocar environ 25 min · SL1');
  });
});
