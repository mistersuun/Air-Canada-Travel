/**
 * Catalogue types. Each area has one English file (en/<area>.ts, the source
 * of truth) and one French file (fr/<area>.ts) typed against it with
 * Translation<>, so a missing or extra French key fails `tsc`.
 */

/** An area's messages: flat keys that all start with '<area>.'. */
export type Messages = Readonly<Record<string, string>>;

/** The French (or any other) version of an English area: exactly the same keys. */
export type Translation<T extends Messages> = { readonly [K in keyof T]: string };
