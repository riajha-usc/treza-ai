/**
 * Money is stored internally as integer minor units (cents) so ledger math
 * never touches floating point. Airwallex APIs take major units, so
 * conversion happens only at the API boundary.
 */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "IDR", "CLP", "ISK", "UGX"]);

export function exponent(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

export function toMinor(major: number, currency: string): number {
  const factor = 10 ** exponent(currency);
  const minor = Math.round(major * factor);
  if (!Number.isSafeInteger(minor)) throw new Error(`Amount out of range: ${major} ${currency}`);
  return minor;
}

export function toMajor(minor: number, currency: string): number {
  if (!Number.isInteger(minor)) throw new Error(`Minor units must be an integer: ${minor}`);
  return minor / 10 ** exponent(currency);
}

export function format(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(toMajor(minor, currency));
}
