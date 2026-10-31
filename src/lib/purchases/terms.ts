import { toMinor } from "../money/money";
import type { PurchaseOption } from "./options";

/** An option as read from vendor terms, with the exact text that supports it. */
export interface ExtractedOption {
  label: string;
  billing: "one_time" | "monthly" | "annual";
  chargeAmount: number;
  currency: string;
  commitmentMonths: number;
  cancellable: boolean;
  /** Verbatim span of the vendor terms that states this price. */
  quote: string;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Every whole number written in a text, so 48 never matches inside 480. */
function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, "")));
}

/**
 * Accepts an extracted option only if its quote appears verbatim in the
 * terms and the quoted text contains the price. A model can misread, but it
 * cannot invent a price that is not in the document.
 */
export function verifyExtracted(termsText: string, extracted: ExtractedOption[]): {
  options: PurchaseOption[];
  rejected: { label: string; reason: string }[];
} {
  const haystack = squash(termsText);
  const options: PurchaseOption[] = [];
  const rejected: { label: string; reason: string }[] = [];
  extracted.forEach((e, i) => {
    const quote = squash(e.quote);
    if (!quote || !haystack.includes(quote)) {
      rejected.push({ label: e.label, reason: "quote does not appear in the vendor terms" });
      return;
    }
    if (!numbersIn(quote).some((n) => Math.abs(n - e.chargeAmount) < 0.005)) {
      rejected.push({ label: e.label, reason: "price is not stated in the quoted text" });
      return;
    }
    if (!(e.chargeAmount > 0) || !/^[A-Z]{3}$/.test(e.currency)) {
      rejected.push({ label: e.label, reason: "invalid amount or currency" });
      return;
    }
    options.push({
      id: `opt_${i + 1}_${e.billing}`,
      label: e.label,
      billing: e.billing,
      chargeMinor: toMinor(e.chargeAmount, e.currency),
      currency: e.currency,
      commitmentMonths: Math.max(0, Math.min(36, Math.round(e.commitmentMonths))),
      cancellable: e.cancellable,
    });
  });
  return { options, rejected };
}

/**
 * Rules-based fallback when no Claude key is configured. Reads simple
 * phrasings such as "$480 per month", "$4,723.20 per year" or
 * "$1,200 one-time". Anything it cannot read is left for a person.
 */
export function parseTermsWithRules(termsText: string, currency: string): ExtractedOption[] {
  const out: ExtractedOption[] = [];
  const pattern =
    /\$\s?([\d,]+(?:\.\d{1,2})?)\s*(?:USD\s*)?(per month|\/\s?month|a month|monthly|per year|\/\s?year|a year|annually|per annum|one[- ]time)/gi;
  for (const m of termsText.matchAll(pattern)) {
    const amount = Number(m[1].replace(/,/g, ""));
    const unit = m[2].toLowerCase();
    const billing: ExtractedOption["billing"] = /month/.test(unit)
      ? "monthly"
      : /one/.test(unit)
        ? "one_time"
        : "annual";
    if (out.some((o) => o.billing === billing)) continue;
    out.push({
      label: billing === "monthly" ? "Monthly plan" : billing === "annual" ? "Annual plan" : "One-time purchase",
      billing,
      chargeAmount: amount,
      currency,
      commitmentMonths: billing === "annual" ? 12 : billing === "monthly" ? 1 : 0,
      cancellable: billing === "monthly",
      quote: m[0],
    });
  }
  return out;
}
