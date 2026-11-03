import { cookies } from "next/headers";

/**
 * The console has no sign-in. These fictional staff let a judge act as the
 * requester, then as an approver, and see that the requester can never approve
 * their own request. The choice lives in a cookie.
 */
export const ACTORS = [
  { name: "Priya Shah", role: "Finance approver" },
  { name: "Maya Chen", role: "Requester, Lumen Home Goods" },
  { name: "Sam Ortiz", role: "Dispute analyst" },
] as const;

export type Actor = (typeof ACTORS)[number];

export const ACTOR_COOKIE = "treza.actor";

export async function currentActor(): Promise<Actor> {
  const name = (await cookies()).get(ACTOR_COOKIE)?.value;
  return ACTORS.find((a) => a.name === name) ?? ACTORS[0];
}
