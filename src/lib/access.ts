export const ACCESS_COOKIE = "treza.access";

export type Access = { kind: "open" } | { kind: "allow" } | { kind: "grant"; redirectTo: string } | { kind: "deny" };

/** Equal length and content, taking the same time whatever differs. */
export function sameKey(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The hosted demo opens with a link that carries the key once; a cookie
 * carries it afterwards. API routes stay open because each verifies its own
 * caller (webhook signatures, remote authorization secrets, public keys).
 * Without a key configured, nothing is guarded.
 */
export function decideAccess(input: { key: string | undefined; pathname: string; search: URLSearchParams; cookie: string | undefined }): Access {
  if (!input.key) return { kind: "open" };
  if (input.pathname.startsWith("/api/")) return { kind: "open" };
  if (sameKey(input.cookie, input.key)) return { kind: "allow" };
  if (sameKey(input.search.get("key") ?? undefined, input.key)) {
    const rest = new URLSearchParams(input.search);
    rest.delete("key");
    const q = rest.toString();
    return { kind: "grant", redirectTo: `${input.pathname}${q ? `?${q}` : ""}` };
  }
  return { kind: "deny" };
}
