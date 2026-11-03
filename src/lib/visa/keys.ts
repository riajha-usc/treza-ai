import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import type { Queryable } from "../db/client";

export interface AgentKey {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** Public JWK as served from the key directory. */
  jwk: { kty: "OKP"; crv: "Ed25519"; x: string; kid: string; use: "sig"; alg: "EdDSA" };
}

/** RFC 7638 thumbprint, the form of Visa's example key ids. */
function thumbprint(x: string): string {
  return createHash("sha256").update(`{"crv":"Ed25519","kty":"OKP","x":"${x}"}`).digest("base64url");
}

function toAgentKey(privateKey: KeyObject): AgentKey {
  const publicKey = createPublicKey(privateKey);
  const { x } = publicKey.export({ format: "jwk" }) as { x: string };
  const kid = thumbprint(x);
  return { kid, privateKey, publicKey, jwk: { kty: "OKP", crv: "Ed25519", x, kid, use: "sig", alg: "EdDSA" } };
}

/**
 * The purchase agent's Ed25519 signing key. TAP_AGENT_PRIVATE_KEY (PKCS8,
 * base64) wins when set; otherwise a key is generated once and kept in the
 * local database. A production agent keeps this in a key manager and
 * registers the public key with Visa.
 */
export async function agentKey(q: Queryable): Promise<AgentKey> {
  const fromEnv = process.env.TAP_AGENT_PRIVATE_KEY?.trim();
  if (fromEnv) return toAgentKey(createPrivateKey({ key: Buffer.from(fromEnv, "base64"), format: "der", type: "pkcs8" }));
  const [row] = await q.query<{ private_key_pkcs8_b64: string }>("SELECT private_key_pkcs8_b64 FROM agent_keys ORDER BY created_at LIMIT 1");
  if (row) return toAgentKey(createPrivateKey({ key: Buffer.from(row.private_key_pkcs8_b64, "base64"), format: "der", type: "pkcs8" }));
  const { privateKey } = generateKeyPairSync("ed25519");
  const key = toAgentKey(privateKey);
  await q.query("INSERT INTO agent_keys (kid, public_key_b64, private_key_pkcs8_b64) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [
    key.kid,
    key.jwk.x,
    (privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).toString("base64"),
  ]);
  return key;
}

/** Key directory lookup: the stand-in for Visa's Key Store. */
export async function publicKeyFor(q: Queryable, kid: string): Promise<KeyObject | null> {
  const key = await agentKey(q);
  return key.kid === kid ? key.publicKey : null;
}
