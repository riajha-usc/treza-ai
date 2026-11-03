"use client";

import { setActorAction } from "@/app/actions";

type Option = { name: string; role: string };

export function ActorSwitcher({ actors, current }: { actors: readonly Option[]; current: string }) {
  return (
    <form action={setActorAction} className="flex items-center gap-2 text-xs">
      <label htmlFor="actor" className="text-muted">
        Acting as
      </label>
      <select
        id="actor"
        name="actor"
        defaultValue={current}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-7 rounded-md border border-line-strong bg-surface px-2 font-medium text-ink"
      >
        {actors.map((a) => (
          <option key={a.name} value={a.name}>
            {a.name} · {a.role}
          </option>
        ))}
      </select>
    </form>
  );
}
