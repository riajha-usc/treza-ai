import { createHash } from "node:crypto";

/** Stable JSON: object keys sorted at every level, so equal data hashes equally. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Binds an approval to exactly what the approver saw: tenant, counterparty,
 * amount, currency, terms and card controls. If any of it changes before
 * execution, the fingerprint no longer matches and the card is not issued.
 */
export function fingerprint(terms: unknown): string {
  return createHash("sha256").update(canonical(terms)).digest("hex");
}
