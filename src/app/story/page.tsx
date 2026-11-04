import { Suspense } from "react";
import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { getApp } from "@/lib/app";
import { loadStory } from "@/lib/story/story";
import { StoryBoard } from "./board";

export default function StoryPage({ searchParams }: PageProps<"/story">) {
  return (
    <main className="flex flex-col gap-4 p-6">
      <Suspense fallback={<PageHeader title="Run the story" subtitle="Loading..." />}>
        <Story searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Story({ searchParams }: { searchParams: PageProps<"/story">["searchParams"] }) {
  await connection();
  const [sp, app] = await Promise.all([searchParams, getApp()]);
  const view = await loadStory(app.db);
  return <StoryBoard initial={view} autoplay={sp.play === "1"} enabled={Boolean(app.airwallex)} />;
}
