/**
 * Local currency per destination country (ISO 3166-1 alpha-2 → ISO 4217),
 * for the destination page's Essentials tile. Names come from
 * Intl.DisplayNames, with a small fallback table.
 */
const CURRENCY: Readonly<Record<string, string>> = {
  AE: 'AED', AG: 'XCD', AT: 'EUR', AU: 'AUD', AW: 'AWG', BB: 'BBD', BE: 'EUR', BM: 'BMD', BR: 'BRL', BS: 'BSD',
  BZ: 'BZD', CA: 'CAD', CH: 'CHF', CL: 'CLP', CN: 'CNY', CO: 'COP', CR: 'CRC', CW: 'XCG', CZ: 'CZK', DE: 'EUR',
  DK: 'DKK', DO: 'DOP', EC: 'USD', ES: 'EUR', FR: 'EUR', GB: 'GBP', GD: 'XCD', GP: 'EUR', GR: 'EUR', GT: 'GTQ',
  HK: 'HKD', HN: 'HNL', HR: 'EUR', HU: 'HUF', IE: 'EUR', IL: 'ILS', IN: 'INR', IS: 'ISK', IT: 'EUR', JM: 'JMD',
  JP: 'JPY', KN: 'XCD', KR: 'KRW', KY: 'KYD', LC: 'XCD', MA: 'MAD', MQ: 'EUR', MX: 'MXN', NL: 'EUR', NO: 'NOK',
  NZ: 'NZD', PE: 'PEN', PH: 'PHP', PR: 'USD', PT: 'EUR', SE: 'SEK', SG: 'SGD', SX: 'XCG', TC: 'USD', TH: 'THB',
  TT: 'TTD', US: 'USD', VC: 'XCD',
};

/** Names Intl may not know yet (the Caribbean guilder replaced the ANG in 2025). */
const FALLBACK_NAMES: Readonly<Record<string, string>> = {
  XCG: 'Caribbean guilder',
};

/** ISO 4217 code for a country, or null when unknown. */
export function currencyCode(iso2: string | null | undefined): string | null {
  return (iso2 && CURRENCY[iso2.toUpperCase()]) || null;
}

/**
 * 'Japanese yen', 'Euro', 'US dollar': the English name with the unit in
 * lower case, as the design sets it. Falls back to the code, then ''.
 */
export function currencyName(iso2: string | null | undefined): string {
  const code = currencyCode(iso2);
  if (!code) return '';
  if (FALLBACK_NAMES[code]) return FALLBACK_NAMES[code];
  let name = code;
  try {
    name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
  if (name === code) return code;
  const words = name.split(' ');
  if (words.length > 1) words[words.length - 1] = words[words.length - 1].toLowerCase();
  return words.join(' ');
}
