/**
 * The boarding-pass swap offer: a pass for one of the trip's backups (not the
 * planned flight) offers "This pass is for AC812 (your backup). Swap this
 * leg to AC812?". Swapping is the same TripsService.swapLeg the Recover
 * screen and the leg sheet use (old leg Dropped, backup becomes the planned
 * leg, ground leg re-estimated, Undo), then the pass is linked to the new leg.
 */
import { Injectable, inject } from '@angular/core';
import { alternateSwapPlan } from '../trips/engine/alternate-swap';
import type { Trip } from '../trips/model';
import { TripsService } from '../trips/trips.service';
import { AlternateMatch, passAlternate, swapOfferText } from './match';
import type { PassRecord } from './model';
import { PassesService } from './passes.service';

export interface SwapOffer { match: AlternateMatch; flightNumber: string; text: string }

/** The offer for a saved pass, or null when it is for a planned leg (or no backup). */
export function swapOfferFor(pass: PassRecord, trip: Trip | null): SwapOffer | null {
  const match = trip ? passAlternate(pass, trip) : null;
  return match ? { match, flightNumber: match.ref.flightNumber, text: swapOfferText(match.ref.flightNumber) } : null;
}

@Injectable({ providedIn: 'root' })
export class PassSwapService {
  private readonly trips = inject(TripsService);
  private readonly passes = inject(PassesService);

  /**
   * Swaps the leg the backup is folded under to that backup. Resolves to the
   * new leg and the pass's segment in it, or null when nothing was swapped.
   */
  swapToBackup(tripId: string, m: AlternateMatch, onUndo?: () => void): { legId: string; refIndex: number } | null {
    const trip = this.trips.trip(tripId);
    const leg = trip?.legs.find(l => l.id === m.legId);
    const alt = leg?.kind === 'flight' ? leg.alternates.find(a => a.id === m.altId) : undefined;
    const plan = trip && alt ? alternateSwapPlan(trip, alt) : null;
    if (!trip || !plan) return null;
    const legId = this.trips.swapLeg(tripId, m.legId, plan.it, plan.ground, { onUndo });
    if (!legId) return null;
    const fresh = this.trips.trip(tripId)?.legs.find(l => l.id === legId);
    const refs = fresh?.kind === 'flight' ? fresh.refs : [];
    const i = refs.findIndex(r => r.flightNumber.toUpperCase() === m.ref.flightNumber.toUpperCase()
      && r.origin === m.ref.origin && r.dest === m.ref.dest);
    return { legId, refIndex: i >= 0 ? i : m.refIndex };
  }

  /**
   * Swaps to the pass's backup and links the pass to the new leg (with any
   * other saved pass for the same backup flight, e.g. a companion's). Undo
   * puts the trip and the passes back. Resolves to the new leg id.
   */
  async swapForPass(pass: PassRecord): Promise<string | null> {
    const trip = this.trips.trip(pass.tripId);
    const offer = swapOfferFor(pass, trip);
    if (!offer) return null;
    const same = this.passes.forTrip(pass.tripId).filter(p => p.id === pass.id || swapOfferFor(p, trip)?.match.altId === offer.match.altId
      && swapOfferFor(p, trip)?.match.refIndex === offer.match.refIndex);
    const prev = same.map(p => ({ id: p.id, legId: p.legId, refIndex: p.refIndex, matched: p.matched }));
    // Undo waits for the forward relinks, so none of them lands after the passes are put back.
    let forward: Promise<void> = Promise.resolve();
    const done = this.swapToBackup(pass.tripId, offer.match, () => {
      void forward.catch(() => undefined).then(async () => {
        for (const b of prev) await this.passes.relink(b.id, b.legId, b.refIndex, b.matched);
      });
    });
    if (!done) return null;
    forward = (async () => {
      for (const p of same) await this.passes.relink(p.id, done.legId, done.refIndex, 'confirmed');
    })();
    await forward;
    return done.legId;
  }
}
