import type { App } from "../app";
import { recordDecision } from "../audit/audit";
import type { Db } from "../db/client";
import { PURCHASE_STEPS } from "./steps-purchase";
import { SETTLEMENT_STEPS } from "./steps-settlement";
import type { StepOutcome, StepStatus, StoryRun, StoryStep, StoryStepRow } from "./types";

/** The seller whose journey the story follows. Every live run so far features Lumen. */
export const STORY_TENANT = "seller_lumen";

export const STORY_STEPS: StoryStep[] = [...PURCHASE_STEPS, ...SETTLEMENT_STEPS];

/** Opens a new run with every step pending. An unfinished earlier run is stopped, never deleted. */
export async function startStory(db: Db, by: string, steps: StoryStep[] = STORY_STEPS): Promise<string> {
  await db.query("UPDATE story_runs SET status = 'stopped', finished_at = now() WHERE status IN ('running', 'waiting', 'failed')");
  const [{ id }] = await db.query<{ id: string }>("INSERT INTO story_runs (tenant_id, started_by) VALUES ($1, $2) RETURNING id", [STORY_TENANT, by]);
  for (const [i, s] of steps.entries()) await db.query("INSERT INTO story_steps (run_id, step, position) VALUES ($1, $2, $3)", [id, s.id, i]);
  await recordDecision(db, { tenantId: STORY_TENANT, actor: "human", action: "story.started", subjectType: "story_run", subjectId: id, inputs: { by } });
  return id;
}

const unfinished = (q: Db, runId: string) =>
  q.query<StoryStepRow>("SELECT * FROM story_steps WHERE run_id = $1 AND status NOT IN ('done', 'skipped') ORDER BY position LIMIT 1", [runId]);

/**
 * Runs the first step that has not finished: a pending one, or the one that
 * failed or is waiting for a person, which is how a run resumes. Returns
 * whether another step can run right away.
 */
export async function advanceStory(app: App, runId: string, steps: StoryStep[] = STORY_STEPS): Promise<{ step: string | null; status: StepStatus; more: boolean }> {
  const { db } = app;
  const [run] = await db.query<StoryRun>("SELECT * FROM story_runs WHERE id = $1", [runId]);
  if (!run) throw new Error(`Unknown story run ${runId}`);
  const [next] = await unfinished(db, runId);
  if (!next) {
    await db.query("UPDATE story_runs SET status = 'done', finished_at = COALESCE(finished_at, now()) WHERE id = $1", [runId]);
    return { step: null, status: "done", more: false };
  }
  const def = steps.find((s) => s.id === next.step);
  if (!def) throw new Error(`Unknown story step ${next.step}`);

  await db.query("UPDATE story_steps SET started_at = now(), finished_at = NULL WHERE run_id = $1 AND step = $2", [runId, next.step]);
  await db.query("UPDATE story_runs SET status = 'running', finished_at = NULL WHERE id = $1", [runId]);
  let outcome: Omit<StepOutcome, "status"> & { status: StepStatus };
  try {
    outcome = await def.run({ app, run });
  } catch (e) {
    outcome = { status: "failed", narration: e instanceof Error ? e.message : String(e) };
  }
  await db.query("UPDATE story_steps SET status = $3, narration = $4, refs = $5, href = $6, finished_at = now() WHERE run_id = $1 AND step = $2", [
    runId,
    next.step,
    outcome.status,
    outcome.narration,
    JSON.stringify(outcome.refs ?? {}),
    outcome.href ?? null,
  ]);
  await recordDecision(db, { tenantId: run.tenant_id, actor: "system", action: `story.step_${outcome.status}`, subjectType: "story_run", subjectId: runId, inputs: { step: next.step }, outcome: { narration: outcome.narration, ...outcome.refs } });

  const remaining = (await unfinished(db, runId)).length;
  const blocked = outcome.status === "failed" || outcome.status === "waiting";
  const status = blocked ? outcome.status : remaining === 0 ? "done" : "running";
  await db.query("UPDATE story_runs SET status = $2, finished_at = CASE WHEN $2 = 'done' THEN now() ELSE NULL END WHERE id = $1", [runId, status]);
  return { step: next.step, status: outcome.status, more: !blocked && remaining > 0 };
}

export interface StoryView {
  run: StoryRun | null;
  steps: { id: string; title: string; promise: string; row: StoryStepRow | null }[];
}

/** The latest run with its steps in order, in a form the page and the client can both hold. */
export async function loadStory(db: Db, steps: StoryStep[] = STORY_STEPS): Promise<StoryView> {
  const [run] = await db.query<StoryRun>("SELECT * FROM story_runs ORDER BY created_at DESC LIMIT 1");
  const show = ({ id, title, promise }: StoryStep, row: StoryStepRow | null) => ({ id, title, promise, row });
  if (!run) return { run: null, steps: steps.map((def) => show(def, null)) };
  const rows = await db.query<StoryStepRow>("SELECT * FROM story_steps WHERE run_id = $1 ORDER BY position", [run.id]);
  return { run, steps: rows.map((row) => show(steps.find((s) => s.id === row.step) ?? { id: row.step, title: row.step, promise: "", run: async () => ({ status: "skipped", narration: "" }) }, row)) };
}
