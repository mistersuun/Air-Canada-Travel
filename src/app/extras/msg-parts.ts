import { type MsgKey, type MsgParams, t } from '../i18n/t';

/**
 * A message with styled or linked values inside it ('Goal <b>X</b> · home by
 * <b>Y</b>'), split at those values so the template can wrap each in its own
 * element and French word order still works: `msgParts('k', {}, ['goal', 'at'])`
 * on 'Goal {goal} · home by {at}' gives ['Goal ', ' · home by ', ''].
 * Slots are written in the message in the order given.
 */
export function msgParts(key: MsgKey, slots: readonly string[], params: MsgParams = {}): string[] {
  const marks = Object.fromEntries(slots.map((s, i) => [s, `\u0000${i}\u0000`]));
  return t(key, { ...params, ...marks }).split(/\u0000\d\u0000/);
}
