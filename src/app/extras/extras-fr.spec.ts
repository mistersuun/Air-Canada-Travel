import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n/locale';
import { t } from '../i18n/t';
import { msgParts } from './msg-parts';
import { FILES_ERROR_TEXT, memoryWarning } from '../files/model';
import { formatBytes, quotaText } from '../files/quota';
import { swapOfferText } from '../passes/match';
import { noBarcodeText } from '../passes/model';
import { removedAfterTripText } from '../passes/passes.service';
import { legPassesMeta } from '../passes/ui/leg-passes.component';
import { extrasLabels } from '../files/ui/trip-extras.component';
import { orphansLine, settingsUsageLine } from '../files/ui/settings-files-body.component';
import { barcodeLabel, savedText } from '../pages/passes/add-pass-model';
import { itemMeta, persistNote, usageTitle } from '../pages/files/files-model';
import type { Attachment } from '../files/model';
import type { PassRecord } from '../passes/model';
import { noteTitleFrom, shareFailedText, shareTooLargeText } from '../share-in/share-payload';

const MB = 1024 * 1024;
const nb = (s: string) => s.replace(/[  ]/g, ' ');

describe('day of travel text in French', () => {
  beforeEach(() => setLocale('fr'));
  afterEach(() => setLocale('en'));

  it('boarding passes', () => {
    expect(swapOfferText('AC812')).toBe('Cette carte est pour AC812 (votre vol de rechange). Remplacer ce segment par AC812?');
    expect(noBarcodeText()).toBe('Aucun code-barres trouvé dans cette image.');
    expect(nb(removedAfterTripText(2))).toBe('2 cartes d\'embarquement supprimées après votre voyage');
    expect(removedAfterTripText(1)).toBe('1 carte d\'embarquement supprimée après votre voyage');
    expect(legPassesMeta(['34K', '34J'])).toBe('2 cartes · siège 34K, 34J');
    expect(legPassesMeta([null])).toBe('1 carte');
    expect(barcodeLabel('QRCode', 2)).toBe('Code QR · 2 segments');
    expect(barcodeLabel('PDF417', 1)).toBe('PDF417 · 1 segment');
    expect(savedText([{ legId: 'l', flightNumber: 'AC834' } as PassRecord])).toBe('Carte enregistrée pour AC834');
    expect(msgParts('passes.add.privacy', ['strong'])).toEqual(['Lue sur ce téléphone. La carte est conservée ici seulement et n\'apparaît ', '.']);
  });

  it('files: sizes, summaries, errors', () => {
    expect(nb(formatBytes(500))).toBe('500 o');
    expect(nb(formatBytes(820 * 1024))).toBe('820 Ko');
    expect(nb(formatBytes(14.2 * MB))).toBe('14,2 Mo');
    expect(nb(quotaText(12.4 * MB))).toContain('(12,4 Mo)');
    expect(usageTitle(0, 0)).toBe('Aucun fichier pour l\'instant');
    expect(nb(usageTitle(9, 14.2 * MB))).toBe('9 fichiers · 14,2 Mo');
    expect(nb(usageTitle(1, 0))).toBe('1 fichier · 0 o');
    expect(FILES_ERROR_TEXT.tooLarge).toContain('50 Mo');
    expect(memoryWarning()).toContain('Les fichiers ne peuvent pas');
    expect(persistNote({ persisted: false, installed: false }, false)).toBe('Votre navigateur pourrait les effacer si l\'espace manque.');
    expect(nb(settingsUsageLine(9, 14.2 * MB, 2))).toBe('14,2 Mo · 9 fichiers dans 2 voyages');
    expect(nb(orphansLine(3, 4.1 * MB))).toBe('3 fichiers de voyages supprimés · 4,1 Mo');
    expect(extrasLabels(2, 7)).toEqual({ passes: 'Cartes · 2', files: 'Fichiers · 7' });
    expect(extrasLabels(0, 0)).toEqual({ passes: 'Ajouter une carte', files: 'Fichiers' });
  });

  it('file rows', () => {
    const pdf = { kind: 'pdf', bytes: 412 * 1024, pages: 3, mime: 'application/pdf' } as Attachment;
    expect(nb(itemMeta(pdf))).toBe('PDF · 3 pages · 412 Ko');
    expect(nb(itemMeta({ kind: 'image', bytes: 2 * MB, mime: 'image/jpeg' } as Attachment))).toBe('Photo · 2,0 Mo');
    expect(nb(itemMeta({ kind: 'file', bytes: 3 * 1024, mime: 'text/calendar' } as Attachment))).toBe('Calendrier · 3 Ko');
  });

  it('share-in', () => {
    expect(shareFailedText()).toBe('Impossible de recevoir ce partage. Réessayez.');
    expect(nb(shareTooLargeText())).toContain('25 Mo');
    expect(noteTitleFrom({ title: '' })).toBe('Note partagée');
    expect(t('shareIn.notify.title')).toBe('Horaires mis à jour');
  });
});
