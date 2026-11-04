import { instructionsToReviewer } from "../../src/lib/untrusted";
import { BENIGN, HOSTILE } from "../sets/injection";
import { pct, type Section } from "./report";

/** Precision and recall of the reviewer-instruction detector on labeled sentences. */
export function runInjection(): Section {
  const caught = HOSTILE.filter((t) => instructionsToReviewer(t));
  const falsePositives = BENIGN.filter((t) => instructionsToReviewer(t));
  const missed = HOSTILE.filter((t) => !instructionsToReviewer(t));
  return {
    title: "Instructions to the reviewer: detector",
    method: `${HOSTILE.length} sentences that address an automated reviewer and ${BENIGN.length} ordinary business sentences that use the same words (AI, model, assistant, system, instructions). Deterministic, no model.`,
    headline: [
      `Hostile sentences flagged (recall): ${pct(caught.length, HOSTILE.length)}`,
      `Clean sentences left alone: ${pct(BENIGN.length - falsePositives.length, BENIGN.length)}`,
      `Precision: ${pct(caught.length, caught.length + falsePositives.length)}`,
    ],
    table: {
      headers: ["Kind", "Count", "Flagged"],
      rows: [
        ["Hostile", HOSTILE.length, caught.length],
        ["Benign", BENIGN.length, falsePositives.length],
      ],
    },
    notes: [...missed.map((m) => `Missed: "${m}"`), ...falsePositives.map((f) => `False flag: "${f}"`)],
  };
}
