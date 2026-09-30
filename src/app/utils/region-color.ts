/**
 * Region colours live as CSS custom properties in src/styles.scss
 * (`--region-<slug>`, with lighter dark-theme variants). Templates should bind
 * `regionVar(dest.region)` instead of hex values, e.g.
 *   [style.--region]="regionVar(d.region)"   or   [style.background]="regionVar(d.region)"
 */

/** Slugs that have a matching `--region-<slug>` variable in styles.scss. */
export const KNOWN_REGION_SLUGS = [
  'caribbean',
  'mexico',
  'usa',
  'europe',
  'asia-pacific',
  'south-america',
  'central-america',
  'africa-middle-east',
] as const;

/** 'Asia & Pacific' -> 'asia-pacific', 'Africa & Middle East' -> 'africa-middle-east'. */
export function regionSlug(region: string | null | undefined): string {
  return (region ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** CSS value for a region's colour; unknown regions fall back to --region-other. */
export function regionVar(region: string | null | undefined): string {
  const slug = regionSlug(region);
  return slug ? `var(--region-${slug}, var(--region-other))` : 'var(--region-other)';
}
