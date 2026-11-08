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
  'saved.chg.new': 'Nouveau\u00a0: vol sans escale depuis {hub} à partir du {date}',
  'saved.chg.newNow': 'Nouveau\u00a0: vol sans escale depuis {hub}',
  'saved.chg.ends': 'Fin\u00a0: dernier vol sans escale le {date}',
  'saved.chg.fewer': 'Moins de jours cette semaine\u00a0: {from} → {to}',
  'saved.chg.fewerWeek': 'Moins de jours la semaine du {date}\u00a0: {from} → {to}',
  'saved.chg.more': 'Plus de jours cette semaine\u00a0: {from} → {to}',
  'saved.chg.moreWeek': 'Plus de jours la semaine du {date}\u00a0: {from} → {to}',
  'saved.chg.fromHub': '{text} (depuis {hub})',
};
