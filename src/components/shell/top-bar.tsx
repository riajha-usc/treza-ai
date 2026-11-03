import { Suspense } from "react";
import { connection } from "next/server";
import { loadShell } from "@/lib/queries/shell";
import { Crumbs } from "./crumbs";

export function TopBar() {
  return (
    <header className="sticky top-0 z-10 flex h-[52px] flex-none items-center justify-between gap-4 border-b border-line bg-surface px-6">
      <div className="min-w-0 truncate text-muted">
        <Suspense fallback={null}>
          <Crumbs />
        </Suspense>
      </div>
      <Suspense fallback={null}>
        <EnvBadge />
      </Suspense>
    </header>
  );
}

async function EnvBadge() {
  await connection();
  const { environment } = await loadShell();
  return <span className="whitespace-nowrap rounded bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">Airwallex {environment}</span>;
}
