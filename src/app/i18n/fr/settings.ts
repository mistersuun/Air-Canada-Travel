import type { Translation } from '../catalogue';
import type { settings as en } from '../en/settings';

export const settings: Translation<typeof en> = {
  'settings.title': 'Paramètres',
  'settings.hub': 'Aéroport d\'attache',
  'settings.hubHint': 'Affiché à l\'ouverture',
  'settings.language': 'Langue',
  'settings.languageHint': '«\u00a0Automatique\u00a0» suit la langue de l\'appareil',
  'settings.language.auto': 'Automatique',
  'settings.language.en': 'English',
  'settings.language.fr': 'Français',
  'settings.appearance': 'Apparence',
  'settings.theme.auto': 'Auto',
  'settings.theme.light': 'Clair',
  'settings.theme.dark': 'Sombre',
  'settings.timeFormat': 'Format de l\'heure',
  'settings.connections': 'Correspondances',
  'settings.showConnections': 'Afficher les correspondances',
  'settings.showConnectionsHint': 'Inclure les trajets avec une correspondance dans une plaque tournante',
  'settings.minConnect': 'Durée minimale de correspondance',
  'settings.maxLayover': 'Durée maximale de correspondance',
  'settings.listing': 'Rappel d\'inscription',
  'settings.listingLabel': 'Rappel d\'inscription, en heures avant le départ',
  'settings.listingHint':
    'Moment où un vol affiche «\u00a0Inscription ouverte\u00a0», et rappel dans le calendrier. Pour recevoir une notification à l\'ouverture, une autorisation est requise\u00a0: accordez-la sous «\u00a0Vérifications des horaires en arrière-plan\u00a0» ci-dessous. Vérifiez les règles de votre laissez-passer.',
  'settings.overnight': 'Correspondances de nuit',
  'settings.overnightHint': 'Permettre une escale qui passe minuit dans la plaque tournante',
  'settings.logbook': 'Carnet de vols',
  'settings.shortcuts': 'Raccourcis clavier',
  'settings.schedules': 'Horaires',
  'settings.photoCredits': 'Crédits photo',
  'settings.photo': 'Photo',
  'settings.by': 'par',
  'settings.resetDefaults': 'Rétablir les valeurs par défaut',
  'settings.resetNote': 'Les destinations enregistrées sont conservées lors de la réinitialisation.',
  'settings.bg.title': 'Vérifications des horaires en arrière-plan',
  'settings.bg.hint':
    'Une ou deux fois par jour, chercher de nouveaux horaires et envoyer une notification. Android et Chrome seulement; le navigateur décide du moment, sans garantie.',
  'settings.bg.blocked':
    'Les notifications sont bloquées, il n\'y a donc rien à afficher. Autorisez-les dans les paramètres du navigateur pour activer cette option.',
  'settings.bg.failed':
    'Ce navigateur ne le permet pas. Installez l\'application sur votre écran d\'accueil ou votre ordinateur, puis réessayez.',
};
