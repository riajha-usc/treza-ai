"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { dateTime } from "@/components/time";
import { PageHeader, Panel, PanelNote, Tag, type Tone } from "@/components/ui";
import type { StoryView } from "@/lib/story/story";
import type { StepStatus } from "@/lib/story/types";
import { advanceStoryAction, startStoryAction } from "./actions";

const STEP_TONE: Record<StepStatus, Tone> = { pending: "neutral", done: "good", skipped: "warn", waiting: "warn", failed: "bad" };
const STEP_LABEL: Record<StepStatus, string> = { pending: "Pending", done: "Done", skipped: "Skipped", waiting: "Needs a person", failed: "Failed" };
const RUN_LABEL = { running: ["info", "Running"], waiting: ["warn", "Waiting for a person"], failed: ["bad", "Stopped on an error"], done: ["good", "Complete"], stopped: ["neutral", "Stopped"] } as const;

/**
 * The story page. Each step is its own server action and returns the run as
 * it now stands, so the list fills in step by step while the run goes. On a
 * reload the server renders the same run from the database.
 */
export function StoryBoard({ initial, autoplay, enabled }: { initial: StoryView; autoplay: boolean; enabled: boolean }) {
  const [view, setView] = useState(initial);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const { run, steps } = view;
  const resumable = run ? run.status === "running" || run.status === "waiting" || run.status === "failed" : false;
  const finished = steps.filter((s) => s.row?.status === "done" || s.row?.status === "skipped").length;

  const play = async (fresh: boolean) => {
    setRunning(true);
    setError(null);
    try {
      let current = run;
      if (fresh || !current) {
        const v = await startStoryAction();
        setView(v);
        current = v.run;
      }
      let more = true;
      while (more && current) {
        const r = await advanceStoryAction(current.id);
        setView(r.view);
        more = r.more;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (!autoplay || !enabled || started.current) return;
    started.current = true;
    window.history.replaceState(null, "", "/story");
    void play(!resumable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, enabled]);

  return (
    <>
      <PageHeader
        title="Run the story"
        subtitle="One seller, Lumen Home Goods, through the whole loop. Every step calls the same code as the pages and moves real sandbox money; nothing here is mocked."
        actions={
          !enabled ? (
            <span className="text-muted">Add Airwallex sandbox keys to run the story.</span>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {error ? <span className="text-bad">{error}</span> : null}
              {running ? (
                <button type="button" disabled className="btn btn-primary opacity-70">Running...</button>
              ) : resumable ? (
                <>
                  <button type="button" onClick={() => play(false)} className="btn btn-primary">Continue</button>
                  <button type="button" onClick={() => play(true)} className="btn">Start over</button>
                </>
              ) : (
                <button type="button" onClick={() => play(true)} className="btn btn-primary">{run ? "Run again" : "Run the story"}</button>
              )}
            </div>
          )
        }
      />
      <Panel
        title={run ? `Run started ${dateTime(run.created_at)} by ${run.started_by}` : "Nine steps, about two minutes"}
        meta={run ? <Tag tone={RUN_LABEL[run.status][0]}>{RUN_LABEL[run.status][1]} · {finished} of {steps.length}</Tag> : null}
      >
        <ol className="divide-y divide-line">
          {steps.map(({ id, title, promise, row }, i) => {
            const status: StepStatus = row?.status ?? "pending";
            const refs = Object.entries(row?.refs ?? {}).filter(([, v]) => v !== null && v !== "");
            return (
              <li key={id} className="flex gap-4 px-4 py-3.5">
                <span className={`mt-0.5 flex size-6 flex-none items-center justify-center rounded-full text-xs font-semibold ${status === "done" ? "bg-primary text-white" : "bg-subtle text-ink-2 ring-1 ring-inset ring-line"}`}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="font-semibold">{title}</b>
                    <Tag tone={STEP_TONE[status]}>{STEP_LABEL[status]}</Tag>
                    {row?.finished_at ? <span className="text-xs text-muted">{dateTime(row.finished_at)}</span> : null}
                  </div>
                  <p className={`mt-1 ${row?.narration ? (status === "failed" ? "text-bad" : "text-ink-2") : "text-muted"}`}>{row?.narration ?? promise}</p>
                  {refs.length || row?.href ? (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
                      {refs.map(([k, v]) => (
                        <span key={k}>
                          {k} <span className="text-ink">{String(v)}</span>
                        </span>
                      ))}
                      {row?.href ? <Link href={row.href} className="font-sans text-primary hover:underline">Open</Link> : null}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        <PanelNote>Steps reuse what an earlier run already did: an existing card is reported, not reissued. Settlement always opens a new cycle. A step that needs a person pauses the run; Continue resumes it.</PanelNote>
      </Panel>
    </>
  );
}
