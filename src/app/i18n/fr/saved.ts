import type { Translation } from '../catalogue';
import type { saved as en } from '../en/saved';

export const saved: Translation<typeof en> = {
  'saved.title': 'Enregistrés',
  'saved.countAria': '{n} enregistrés',
  'saved.tab.upcoming': 'À venir',
  'saved.tab.watching': 'Suivis',
  'saved.viewAria': 'Vue des enregistrés',
  'saved.empty.title': "Rien d'enregistré pour l'instant",
  'saved.empty.text': 'Touchez ★ sur une destination pour la garder ici.',
  'saved.empty.cta': 'Explorer les destinations',
  'saved.noFlights': 'Aucun vol publié',
  'saved.remove': 'Retirer {city} des enregistrés',
  'saved.showing': 'Semaine affichée\u00a0: {week}',
  'saved.thatWeek': '{n}× cette semaine-là',
  'saved.ends': 'se termine le {date}',
};
