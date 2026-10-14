/**
 * The English catalogue: the source of truth for every key. One file per
 * area, so parallel conversions never edit the same file (docs/i18n.md).
 * Every area is already registered here and in fr/index.ts; a conversion
 * only fills its own en/<area>.ts and fr/<area>.ts.
 */
import { calendar } from './calendar';
import { common } from './common';
import { data } from './data';
import { dest } from './dest';
import { files } from './files';
import { flight } from './flight';
import { format } from './format';
import { group } from './group';
import { home } from './home';
import { logbook } from './logbook';
import { map } from './map';
import { passes } from './passes';
import { places } from './places';
import { recs } from './recs';
import { saved } from './saved';
import { settings } from './settings';
import { share } from './share';
import { shareIn } from './shareIn';
import { shell } from './shell';
import { today } from './today';
import { trips } from './trips';
import { ui } from './ui';
import { weekend } from './weekend';

/** Area name → its messages. Every key of an area starts with '<area>.' (checked by i18n.spec.ts). */
export const EN_AREAS = {
  calendar,
  common,
  data,
  dest,
  files,
  flight,
  format,
  group,
  home,
  logbook,
  map,
  passes,
  places,
  recs,
  saved,
  settings,
  share,
  shareIn,
  shell,
  today,
  trips,
  ui,
  weekend,
} as const;

export const EN = {
  ...calendar,
  ...common,
  ...data,
  ...dest,
  ...files,
  ...flight,
  ...format,
  ...group,
  ...home,
  ...logbook,
  ...map,
  ...passes,
  ...places,
  ...recs,
  ...saved,
  ...settings,
  ...share,
  ...shareIn,
  ...shell,
  ...today,
  ...trips,
  ...ui,
  ...weekend,
};
