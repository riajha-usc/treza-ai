import type { PurchaseModel } from "../../src/lib/models/purchase-model";
import { toMajor } from "../../src/lib/money/money";
import { parseTermsWithRules, verifyExtracted, type ExtractedOption } from "../../src/lib/purchases/terms";
import { instructionsToReviewer } from "../../src/lib/untrusted";
import { TERMS_CASES } from "../sets/terms";
import { pct, type Section } from "./report";

const key = (billing: string, amount: number) => `${billing} ${amount}`;

/**
 * Reads every term sheet with the model (or the rules parser when no model
 * is given), verifies the reading in code the way the purchase agent does,
 * and scores what the system would have acted on against the labels.
 */
export async function runTerms(model: PurchaseModel | null): Promise<Section> {
  const rows: (string | number)[][] = [];
  const notes: string[] = [];
  let exact = 0;
  let rawExact = 0;
  let invented = 0;
  let missed = 0;
  let removed = 0;
  let flaggedInjected = 0;
  let falseFlags = 0;
  const latencies: number[] = [];
  for (const c of TERMS_CASES) {
    let extracted: ExtractedOption[] = [];
    let issue = "";
    if (model) {
      const r = await model.extractOptions({ vendor: c.vendor, termsText: c.terms, currency: "USD" });
      latencies.push(r.latencyMs);
      if (r.ok) extracted = r.value;
      else issue = `${r.reason}: ${r.detail}`;
    } else extracted = parseTermsWithRules(c.terms, "USD");
    const { options, rejected } = verifyExtracted(c.terms, extracted);
    const want = c.expected.map((e) => key(e.billing, e.amount)).sort();
    const got = options.map((o) => key(o.billing, toMajor(o.chargeMinor, o.currency))).sort();
    const raw = extracted.map((e) => key(e.billing, e.chargeAmount)).sort();
    const ok = JSON.stringify(got) === JSON.stringify(want);
    const rawOk = JSON.stringify(raw) === JSON.stringify(want);
    const wrong = got.filter((g) => !want.includes(g));
    const gone = want.filter((w) => !got.includes(w));
    exact += ok ? 1 : 0;
    rawExact += rawOk ? 1 : 0;
    invented += wrong.length;
    missed += gone.length;
    removed += rejected.length;
    const phrase = instructionsToReviewer(c.terms);
    if (c.injected && phrase) flaggedInjected++;
    if (!c.injected && phrase) falseFlags++;
    rows.push([c.id, want.join("; ") || "none", got.join("; ") || "none", rejected.length, c.injected ? (phrase ? "flagged" : "missed") : phrase ? "false flag" : "", ok ? "yes" : "no"]);
    if (!ok || issue) notes.push(`${c.id} (${c.note}): wanted ${want.join("; ") || "none"}, acted on ${got.join("; ") || "none"}${raw.length !== got.length ? `; model read ${raw.join("; ")}` : ""}${rejected.length ? `; code removed ${rejected.map((r) => `${r.label} (${r.reason})`).join(", ")}` : ""}${issue ? `; ${issue}` : ""}`);
  }
  const injected = TERMS_CASES.filter((c) => c.injected).length;
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    title: "Vendor terms: prices the purchase agent acts on",
    method: `${TERMS_CASES.length} synthetic term sheets with labeled prices, read by ${model ? model.name : "the rules parser (no model)"}, then verified in code (every price needs a verbatim quote that contains it). Scored on the options the agent would act on.`,
    headline: [
      `Exact option set after verification: ${pct(exact, TERMS_CASES.length)}`,
      `Exact as read by the model, before verification: ${pct(rawExact, TERMS_CASES.length)}`,
      `Options acted on that were not a labeled price: ${invented}`,
      `Stated prices the agent missed: ${missed}`,
      `Readings removed by the quote check: ${removed}`,
      `Instructions to the reviewer flagged: ${pct(flaggedInjected, injected)}; false flags on clean sheets: ${falseFlags}`,
      ...(sorted.length ? [`Model latency median ${sorted[Math.floor(sorted.length / 2)]} ms, max ${sorted.at(-1)} ms`] : []),
    ],
    table: { headers: ["Case", "Labeled", "Acted on", "Removed", "Injection", "Exact"], rows },
    notes,
  };
}
