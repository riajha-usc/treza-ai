import { Suspense } from "react";
import { connection } from "next/server";
import { ACTORS, currentActor } from "@/lib/actor";
import { loadShell } from "@/lib/queries/shell";
import { ActorSwitcher } from "./actor-switcher";
import { Crumbs } from "./crumbs";

export function TopBar() {
  return (
    <header className="sticky top-0 z-10 flex h-[52px] flex-none items-center justify-between gap-4 border-b border-line bg-surface px-6">
      <div className="min-w-0 truncate text-muted">
        <Suspense fallback={null}>
          <Crumbs />
        </Suspense>
      </div>
      <div className="flex items-center gap-4">
        <Suspense fallback={null}>
          <ActorMenu />
        </Suspense>
        <Suspense fallback={null}>
          <EnvBadge />
        </Suspense>
      </div>
    </header>
  );
}

async function ActorMenu() {
  const actor = await currentActor();
  return <ActorSwitcher actors={ACTORS} current={actor.name} />;
}

async function EnvBadge() {
  await connection();
  const { environment } = await loadShell();
  return <span className="whitespace-nowrap rounded bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">Airwallex {environment}</span>;
}
