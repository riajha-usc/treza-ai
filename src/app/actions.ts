"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ACTOR_COOKIE, ACTORS } from "@/lib/actor";

/** Switches which fictional staff member the viewer is acting as. */
export async function setActorAction(form: FormData) {
  const name = String(form.get("actor") ?? "");
  if (!ACTORS.some((a) => a.name === name)) return;
  (await cookies()).set(ACTOR_COOKIE, name, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 30 });
  revalidatePath("/", "layout");
}
