import type { Translation } from '../catalogue';
import type { saved as en } from '../en/saved';

export const saved: Translation<typeof en> = {
  'saved.title': 'Enregistrées',
  'saved.countAria': 'Enregistrées\u00a0: {n}',
  'saved.tab.upcoming': 'À venir',
  'saved.tab.watching': 'Suivies',
  'saved.viewAria': 'Vue des destinations enregistrées',
  'saved.empty.title': "Rien d'enregistré pour l'instant",
  'saved.empty.text': 'Touchez ★ sur une destination pour la garder ici.',
  'saved.empty.cta': 'Explorer les destinations',
  'saved.noFlights': 'Aucun vol publié',
  'saved.remove': 'Retirer {city} des destinations enregistrées',
  'saved.showing': 'Semaine affichée\u00a0: {week}',
  'saved.thatWeek': '{n}× cette semaine-là',
  'saved.ends': 'se termine le {date}',
};
