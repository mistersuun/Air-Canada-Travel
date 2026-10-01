/**
 * A tiny ground.json for specs: Madrid → Seville (MAD-2510911) by Renfe,
 * valid Oct 1 to Dec 12 2026. Weekdays 07:00, 10:00, 16:00 and 21:05
 * (ALVIA, 2h50); Saturdays 08:00 only; nothing on Sundays; no trains on
 * Mon Oct 12. Back: weekdays 06:05 and 18:00.
 */
export const FIXTURE_GROUND_FILE = {
  v: 1,
  builtAt: '2026-10-02',
  license: 'ODbL-1.0',
  licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
  licenseNote: 'ODbL 1.0 (database).',
  sources: {
    renfe: {
      name: 'Renfe', credit: 'Renfe Viajeros (data.renfe.com)', licence: 'CC BY 4.0',
      licenceUrl: 'https://creativecommons.org/licenses/by/4.0/', url: 'https://data.renfe.com/', fetched: '2026-10-01',
    },
  },
  corridors: {
    'MAD-2510911': {
      mode: 'train',
      out: {
        src: 'renfe', op: 'Renfe', from: 'Madrid Puerta de Atocha', to: 'Sevilla Santa Justa', tz: 'Europe/Madrid',
        validFrom: '2026-10-01', validTo: '2026-12-12', p: ['AVE', 'ALVIA'],
        wk: [[420, 159, 0], [600, 160, 0], [960, 159, 0], [1265, 170, 1]],
        sat: [[480, 168, 0]],
        sun: [],
        x: ['2026-10-12'],
        note: 'Renfe trains only. Iryo and Ouigo also run this route.',
      },
      back: {
        src: 'renfe', op: 'Renfe', from: 'Sevilla Santa Justa', to: 'Madrid Puerta de Atocha', tz: 'Europe/Madrid',
        validFrom: '2026-10-01', validTo: '2026-12-12', p: ['AVE'],
        wk: [[365, 160, 0], [1080, 160, 0]], sat: [], sun: [],
      },
    },
  },
};
