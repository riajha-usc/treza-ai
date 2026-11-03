import { randomUUID, sign as edSign, verify as edVerify, type KeyObject } from "node:crypto";

/** Visa TAP signatures are valid for at most 8 minutes. */
export const MAX_WINDOW_SECONDS = 480;
export type TapTag = "agent-browser-auth" | "agent-payer-auth";

/**
 * RFC 9421 signature base for the components TAP requires. The last line
 * repeats the exact Signature-Input parameters, so signer and verifier
 * sign the same bytes.
 */
export function signatureBase(authority: string, path: string, params: string): string {
  return [`"@authority": ${authority}`, `"@path": ${path}`, `"@signature-params": ${params}`].join("\n");
}

/** Signs a request as the agent. Returns the two headers to attach. */
export function signRequest(
  url: string,
  key: { kid: string; privateKey: KeyObject },
  opts: { tag: TapTag; nonce?: string; now?: number; ttlSeconds?: number },
): { "signature-input": string; signature: string; nonce: string } {
  const u = new URL(url);
  const created = Math.floor((opts.now ?? Date.now()) / 1000);
  const expires = created + (opts.ttlSeconds ?? MAX_WINDOW_SECONDS);
  const nonce = opts.nonce ?? randomUUID();
  const params = `("@authority" "@path");created=${created};keyid="${key.kid}";alg="ed25519";expires=${expires};nonce="${nonce}";tag="${opts.tag}"`;
  const sig = edSign(null, Buffer.from(signatureBase(u.host, u.pathname, params)), key.privateKey).toString("base64");
  return { "signature-input": `sig2=${params}`, signature: `sig2=:${sig}:`, nonce };
}

/** Signs a body object (consumer or payment container) with the same key: every field except signature, in order. */
export function signObject<T extends Record<string, unknown>>(obj: T, privateKey: KeyObject): T & { signature: string } {
  const signature = edSign(null, Buffer.from(JSON.stringify(obj)), privateKey).toString("base64");
  return { ...obj, signature };
}

export function verifyObject(obj: Record<string, unknown>, publicKey: KeyObject): boolean {
  const { signature, ...rest } = obj;
  if (typeof signature !== "string") return false;
  try {
    return edVerify(null, Buffer.from(JSON.stringify(rest)), publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export interface TapVerification {
  ok: boolean;
  checks: Check[];
  keyid?: string;
  nonce?: string;
  tag?: string;
}

/**
 * Merchant-side verification, step by step as Visa's merchant spec lists it.
 * Stops at the first failed step and reports every step it ran.
 */
export async function verifyRequest(
  req: { url: string; headers: Headers },
  deps: { resolveKey: (kid: string) => Promise<KeyObject | null>; claimNonce: (nonce: string) => Promise<boolean>; now?: number },
): Promise<TapVerification> {
  const checks: Check[] = [];
  const fail = (name: string, detail: string, extra: Partial<TapVerification> = {}): TapVerification => {
    checks.push({ name, pass: false, detail });
    return { ok: false, checks, ...extra };
  };
  const pass = (name: string, detail: string) => checks.push({ name, pass: true, detail });

  const input = req.headers.get("signature-input") ?? "";
  const sigHeader = req.headers.get("signature") ?? "";
  const m = /^(\w+)=(\(.*?\)(?:;.*)?)$/.exec(input.trim());
  if (!m) return fail("signature present", "No TAP Signature-Input header: not a trusted agent request");
  const [, label, params] = m;
  const fields = Object.fromEntries([...params.matchAll(/;(\w+)=("([^"]*)"|\d+)/g)].map((x) => [x[1], x[3] ?? x[2]]));
  const tag = fields.tag;
  if (tag !== "agent-browser-auth" && tag !== "agent-payer-auth") return fail("trusted agent tag", `Tag "${tag ?? "missing"}" is not a TAP tag`);
  pass("trusted agent tag", `Tag ${tag}`);

  const missing = ["created", "expires", "keyid", "alg", "nonce"].filter((f) => !fields[f]);
  if (missing.length) return fail("required fields", `Missing ${missing.join(", ")}`, { tag });
  if (!params.startsWith('("@authority" "@path")')) return fail("covered components", "Signature must cover @authority and @path", { tag });
  pass("required fields", "created, expires, keyid, alg, nonce and tag present; @authority and @path covered");

  const now = Math.floor((deps.now ?? Date.now()) / 1000);
  const created = Number(fields.created);
  const expires = Number(fields.expires);
  if (!(created <= now) || !(expires > now) || expires - created > MAX_WINDOW_SECONDS) {
    return fail("time window", `created ${created}, expires ${expires}, now ${now}: must be current and at most 8 minutes apart`, { tag });
  }
  pass("time window", `Valid for ${expires - created} seconds, ${expires - now} remaining`);

  const sigMatch = new RegExp(`^${label}=:([A-Za-z0-9+/=]+):$`).exec(sigHeader.trim());
  if (!sigMatch) return fail("signature format", "Signature header does not match the Signature-Input label", { tag });

  if (!/^ed25519$/i.test(fields.alg)) return fail("algorithm", `Unsupported alg ${fields.alg}`, { tag });
  const key = await deps.resolveKey(fields.keyid);
  if (!key) return fail("key lookup", `No public key for keyid ${fields.keyid}`, { tag, keyid: fields.keyid });
  pass("key lookup", `Found key ${fields.keyid.slice(0, 12)}...`);

  const u = new URL(req.url);
  const valid = edVerify(null, Buffer.from(signatureBase(u.host, u.pathname, params)), key, Buffer.from(sigMatch[1], "base64"));
  if (!valid) return fail("signature", "Signature does not verify for this request", { tag, keyid: fields.keyid, nonce: fields.nonce });
  pass("signature", "Ed25519 signature verifies over @authority, @path and the signature parameters");

  // Claim the nonce only after the signature verifies, atomically, so forged
  // requests cannot burn nonces and two copies of a valid request cannot both pass.
  if (!(await deps.claimNonce(fields.nonce))) return fail("replay protection", `Nonce ${fields.nonce} was already used in the last 8 minutes`, { tag, keyid: fields.keyid, nonce: fields.nonce });
  pass("replay protection", "Nonce not seen before");
  return { ok: true, checks, keyid: fields.keyid, nonce: fields.nonce, tag };
}
