import { testDb } from "../../src/lib/db/client";
import { ensureTenant } from "../../src/lib/ledger/ledger";
import { loadCash } from "../../src/lib/purchases/cash";
import { loadPolicy } from "../../src/lib/purchases/policy";
import { evaluateRules } from "../../src/lib/purchases/rules";
import { seedDemo } from "../../src/lib/seed";
import { RULES_CASES } from "../sets/rules";
import { pct, type Section } from "./report";

/** The deterministic first tier against Lumen's seeded policy and cash: a specification check. */
export async function runRules(): Promise<Section> {
  const db = await testDb();
  await ensureTenant(db, { id: "platform", kind: "platform", name: "Meridian Market" });
  await seedDemo(db);
  const policy = (await loadPolicy(db, "seller_lumen"))!;
  const cash = await loadCash(db, "seller_lumen", "USD");
  const rows: (string | number)[][] = [];
  const notes: string[] = [];
  let ok = 0;
  for (const c of RULES_CASES) {
    const out = evaluateRules({ vendor: c.vendor, merchantCategoryCode: c.mcc, purpose: c.purpose, options: c.options, policy, risk: { tier: c.risk ?? "low", reasons: [] }, cash, activeVendors: c.activeVendors ?? [] });
    const got = { verdict: out.verdict, chosen: out.chosen?.billing ?? null, needsHuman: out.needsHuman };
    const match = JSON.stringify(got) === JSON.stringify(c.expected);
    ok += match ? 1 : 0;
    rows.push([c.id, c.note, `${c.expected.verdict} / ${c.expected.chosen ?? "none"}${c.expected.needsHuman ? " / person" : ""}`, `${got.verdict} / ${got.chosen ?? "none"}${got.needsHuman ? " / person" : ""}`, match ? "yes" : "no"]);
    if (!match) notes.push(`${c.id}: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(got)}; ${out.results.filter((r) => r.outcome !== "pass").map((r) => `${r.code} ${r.outcome}`).join(", ")}`);
  }
  await db.close();
  return {
    title: "Policy rules: the deterministic first tier",
    method: `${RULES_CASES.length} purchase scenarios against the seeded seller policy ($250 auto-approve, $2,000 human approval, $6,000 maximum, $3,000 reserve floor, 12-week projection) and Lumen's seeded cash flows. No model.`,
    headline: [`Scenarios decided as specified: ${pct(ok, RULES_CASES.length)}`],
    table: { headers: ["Case", "Scenario", "Expected", "Got", "Match"], rows },
    notes,
  };
}
