"use server";

import { revalidatePath } from "next/cache";
import { currentActor } from "@/lib/actor";
import { getApp } from "@/lib/app";
import { advanceStory, loadStory, startStory, type StoryView } from "@/lib/story/story";

/** Opens a new run and returns it with every step pending. */
export async function startStoryAction(): Promise<StoryView> {
  const { db } = await getApp();
  await startStory(db, (await currentActor()).name);
  return loadStory(db);
}

/** Runs the next unfinished step and returns the whole run as it now stands. */
export async function advanceStoryAction(runId: string): Promise<{ more: boolean; view: StoryView }> {
  const app = await getApp();
  const r = await advanceStory(app, runId);
  if (!r.more) {
    revalidatePath("/story");
    revalidatePath("/");
  }
  return { more: r.more, view: await loadStory(app.db) };
}
