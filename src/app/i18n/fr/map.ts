import type { Translation } from '../catalogue';
import type { map as en } from '../en/map';

export const map: Translation<typeof en> = {
  'map.title': 'Carte des liaisons',
  'map.search': 'Rechercher sur la carte',
  'map.clearSearch': 'Effacer la recherche',
  'map.recentre': 'Recentrer sur {hub}',
  'map.zoomIn': 'Zoom avant',
  'map.zoomOut': 'Zoom arrière',
  'map.collapse': 'Réduire la liste',
  'map.expand': 'Agrandir la liste',
  'map.sortBy': 'Trier par',
  'map.sort.distance': 'Distance',
  'map.sort.time': 'Durée',
  'map.connGroup': 'Correspondances seulement · {n}',
  'map.open': 'Ouvrir {city}',
  'map.noMatch': 'Aucune destination ne correspond à «\u00a0{query}\u00a0».',
  'map.notPublished': 'Les horaires de cette semaine ne sont pas encore publiés.',
  'map.noFlights': '{when, select, day {Aucun vol au départ de {hub} ce jour-là.} other {Aucun vol au départ de {hub} cette semaine.}}',
  'map.count': '{n, plural, one {# destination} other {# destinations}}',
  'map.rowSelected': '. Sélectionné; appuyez de nouveau pour ouvrir',
  'map.thisWeek': '{n} cette semaine',
};
