"use client";

import { useOptimistic, useTransition } from "react";
import { setActorAction } from "@/app/actions";

type Option = { name: string; role: string };

/**
 * Controlled on purpose: a form action would reset the select to its old
 * default after the action ran, so the choice appeared to snap back until a
 * reload. The optimistic value shows the choice at once; the server's value
 * takes over when the revalidated layout streams in.
 */
export function ActorSwitcher({ actors, current }: { actors: readonly Option[]; current: string }) {
  const [value, showChoice] = useOptimistic(current);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2 text-xs">
      <label htmlFor="actor" className="text-muted">
        Acting as
      </label>
      <select
        id="actor"
        name="actor"
        value={value}
        aria-busy={pending}
        onChange={(e) => {
          const name = e.currentTarget.value;
          const form = new FormData();
          form.set("actor", name);
          startTransition(async () => {
            showChoice(name);
            await setActorAction(form);
          });
        }}
        className="h-7 rounded-md border border-line-strong bg-surface px-2 font-medium text-ink"
      >
        {actors.map((a) => (
          <option key={a.name} value={a.name}>
            {a.name} · {a.role}
          </option>
        ))}
      </select>
    </div>
  );
}
