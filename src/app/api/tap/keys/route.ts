import { getApp } from "@/lib/app";
import { agentKey } from "@/lib/visa/keys";

/**
 * Key directory for Treza's agent: GET ?keyID=<kid> returns the public JWK.
 * A self-hosted stand-in for Visa's Key Store until the agent is registered with Visa.
 */
export async function GET(request: Request) {
  const { db } = await getApp();
  const key = await agentKey(db);
  const wanted = new URL(request.url).searchParams.get("keyID");
  if (wanted && wanted !== key.kid) return Response.json({ error: "unknown key" }, { status: 404 });
  return Response.json(wanted ? key.jwk : { keys: [key.jwk] });
}
