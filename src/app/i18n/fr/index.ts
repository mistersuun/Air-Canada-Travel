/**
 * The French (fr-CA) catalogue: one file per area, each typed against its
 * English file, so a missing or extra key fails `tsc`.
 */
import type { EN_AREAS } from '../en';
import { calendar } from './calendar';
import { common } from './common';
import { compare } from './compare';
import { data } from './data';
import { dest } from './dest';
import { files } from './files';
import { flight } from './flight';
import { format } from './format';
import { group } from './group';
import { guide } from './guide';
import { home } from './home';
import { logbook } from './logbook';
import { map } from './map';
import { passes } from './passes';
import { planner } from './planner';
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
import { commute } from './commute';

type Areas = typeof EN_AREAS;

/** Exactly the areas and keys of EN_AREAS. */
export const FR_AREAS: { readonly [A in keyof Areas]: { readonly [K in keyof Areas[A]]: string } } = {
  calendar,
  common,
  compare,
  data,
  dest,
  files,
  flight,
  format,
  group,
  guide,
  home,
  logbook,
  map,
  passes,
  planner,
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
  commute,
};

export const FR = {
  ...calendar,
  ...common,
  ...compare,
  ...data,
  ...dest,
  ...files,
  ...flight,
  ...format,
  ...group,
  ...guide,
  ...home,
  ...logbook,
  ...map,
  ...passes,
  ...planner,
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
  ...commute,
};
