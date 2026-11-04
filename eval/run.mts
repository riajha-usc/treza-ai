/**
 * Measures Treza against labeled sets and writes eval/results.md.
 *
 *   npm run eval            offline: rules, injection detector, authorization latency, replays,
 *                           plus the terms and dispute sets with the rules parser and the fake reader
 *   npm run eval:models     the same, with Claude Sonnet 5.5 reading the terms and Claude Opus 5.5
 *                           reading the dispute documents (needs ANTHROPIC_API_KEY)
 */
import Anthropic from "@anthropic-ai/sdk";
import { writeFile } from "node:fs/promises";
import { ClaudeDisputeModel } from "../src/lib/models/dispute-model";
import { ClaudePurchaseModel } from "../src/lib/models/claude-purchase-model";
import { runDisputes } from "./lib/disputes";
import { runIdempotency } from "./lib/idempotency";
import { runInjection } from "./lib/injection";
import { runLatency } from "./lib/latency";
import { print, toMarkdown, type Section } from "./lib/report";
import { runRules } from "./lib/rules";
import { runTerms } from "./lib/terms";

const withModels = process.argv.includes("--models");
const apiKey = process.env.ANTHROPIC_API_KEY;
if (withModels && !apiKey) {
  console.error("ANTHROPIC_API_KEY is not set; run without --models for the offline sets.");
  process.exit(1);
}
const purchaseModel = withModels ? new ClaudePurchaseModel(new Anthropic({ apiKey })) : null;
const disputeModel = withModels ? new ClaudeDisputeModel({ apiKey: apiKey! }) : null;

const sections: Section[] = [];
for (const run of [() => runTerms(purchaseModel), () => runDisputes(disputeModel), runInjection, runRules, runLatency, runIdempotency]) {
  const s = await run();
  print(s);
  sections.push(s);
}

const stamp = new Date().toISOString().slice(0, 10);
const head = [
  "# Evaluation results",
  "",
  `Generated ${stamp} by \`npm run eval${withModels ? ":models" : ""}\`. ${withModels ? `Models: ${purchaseModel!.name} for vendor terms, ${disputeModel!.name} for dispute documents.` : "No model calls: the terms and dispute sets ran with the rules parser and the fake document reader, which measure the code around the model, not the model."}`,
  "",
  "Every set is synthetic and labeled by hand; the sets live in `eval/sets`. Numbers come from running the same code the product runs, against an embedded database.",
  "",
];
await writeFile(new URL(`./results${withModels ? "" : "-offline"}.md`, import.meta.url), [...head, ...sections.map(toMarkdown)].join("\n\n") + "\n");
console.log(`\nWrote eval/results${withModels ? "" : "-offline"}.md`);
