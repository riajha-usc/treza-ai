import { getApp } from "@/lib/app";
import { env } from "@/lib/env";
import { decideAuthorization, recordAuthorization, verifyRemoteAuthSignature, type RemoteAuthRequest } from "@/lib/visa/remote-auth";

/** Airwallex gives 2.5 seconds; answer DECLINED well before that rather than time out. */
const BUDGET_MS = 2_000;

export async function POST(request: Request) {
  const started = Date.now();
  const secret = env().AIRWALLEX_REMOTE_AUTH_SECRET;
  if (!secret) return Response.json({ error: "remote authorization is not configured" }, { status: 503 });
  if (!verifyRemoteAuthSignature({ nonce: request.headers.get("x-nonce"), signature: request.headers.get("x-signature"), secret })) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }
  const payload = (await request.json()) as RemoteAuthRequest;
  const { db } = await getApp();
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), BUDGET_MS));
  const decided = await Promise.race([decideAuthorization(db, payload), timeout]);
  const answer = decided ?? {
    card_transaction_event_id: payload.card_transaction_event_id,
    response_status: "DECLINED" as const,
    status_reason: "Decision took too long",
    checks: [{ name: "time budget", pass: false, detail: `Over ${BUDGET_MS} ms` }],
  };
  await recordAuthorization(db, payload, answer, Date.now() - started);
  const { checks: _checks, ...body } = answer;
  void _checks;
  return Response.json(body);
}
