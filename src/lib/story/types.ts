import type { App } from "../app";

export type StepStatus = "pending" | "done" | "skipped" | "waiting" | "failed";

/** What one step reports after it ran. */
export interface StepOutcome {
  status: "done" | "skipped" | "waiting";
  /** One or two sentences a viewer reads, written from the data the step produced. */
  narration: string;
  /** Identifiers worth showing next to the narration: Airwallex ids, cycle ids, timings. */
  refs?: Record<string, string | number | null>;
  /** Where to look in the console for the detail. */
  href?: string | null;
}

export interface StoryRun {
  id: string;
  tenant_id: string;
  started_by: string;
  status: "running" | "waiting" | "failed" | "done" | "stopped";
  created_at: string;
  finished_at: string | null;
}

export interface StoryStepRow {
  run_id: string;
  step: string;
  position: number;
  status: StepStatus;
  narration: string | null;
  refs: Record<string, string | number | null>;
  href: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface StoryContext {
  app: App;
  run: StoryRun;
}

/**
 * One step of the story. A step must be safe to run twice: it looks for
 * what an earlier run already did before doing anything, so a resumed or
 * repeated run reports the existing card or cycle instead of making another.
 */
export interface StoryStep {
  id: string;
  title: string;
  /** What the viewer is about to see, shown before the step runs. */
  promise: string;
  run(ctx: StoryContext): Promise<StepOutcome>;
}

export const skipped = (narration: string): StepOutcome => ({ status: "skipped", narration });
