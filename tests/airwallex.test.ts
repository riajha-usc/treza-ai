import { beforeEach, describe, expect, it } from "vitest";
import { AirwallexClient, AirwallexError } from "@/lib/airwallex/client";
import { onceForOperation } from "@/lib/airwallex/idempotency";
import { signForTests, verifyAirwallexSignature } from "@/lib/airwallex/webhook";
import { testDb, type Db } from "@/lib/db/client";

type Call = { url: string; init: RequestInit };

function fakeAirwallex(responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).endsWith("/authentication/login")) {
      return new Response(JSON.stringify({ token: `tok_${calls.length}`, expires_at: "2099-01-01T00:00:00+0000" }), {
        status: 201,
      });
    }
    const next = responses.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  const client = new AirwallexClient({
    clientId: "id",
    apiKey: "key",
    apiBase: "https://api.sandbox.airwallex.com",
    filesBase: "https://files.sandbox.airwallex.com",
    fetch: fetchFn,
    sleep: async () => {},
  });
  return { client, calls };
}

describe("Airwallex client", () => {
  it("logs in once and reuses the token", async () => {
    const { client, calls } = fakeAirwallex([
      { status: 200, body: { items: [] } },
      { status: 200, body: { items: [] } },
    ]);
    await client.request("GET", "/api/v1/global_accounts");
    await client.request("GET", "/api/v1/global_accounts");
    expect(calls.filter((c) => c.url.endsWith("/login"))).toHaveLength(1);
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer tok_1");
  });

  it("retries a 503 with the identical body so the request_id is unchanged", async () => {
    const { client, calls } = fakeAirwallex([
      { status: 503, body: { code: "unavailable", message: "try again" } },
      { status: 201, body: { id: "tr_1" } },
    ]);
    const res = await client.request("POST", "/api/v1/connected_account_transfers/create", {
      body: { request_id: "req-1", amount: "10.00" },
    });
    expect(res).toEqual({ id: "tr_1" });
    const posts = calls.filter((c) => c.url.includes("connected_account_transfers"));
    expect(posts).toHaveLength(2);
    expect(posts[0].init.body).toBe(posts[1].init.body);
  });

  it("sends x-on-behalf-of for connected account calls", async () => {
    const { client, calls } = fakeAirwallex([{ status: 200, body: [] }]);
    await client.request("GET", "/api/v1/balances/current", { onBehalfOf: "acct_123" });
    expect((calls[1].init.headers as Record<string, string>)["x-on-behalf-of"]).toBe("acct_123");
  });

  it("surfaces Airwallex error bodies without retrying a 400", async () => {
    const { client, calls } = fakeAirwallex([
      { status: 400, body: { code: "field_required", message: "reference is required", source: "reference" } },
    ]);
    const err = (await client.request("POST", "/api/v1/charges/create", { body: {} }).catch((e) => e)) as AirwallexError;
    expect(err).toBeInstanceOf(AirwallexError);
    expect(err.code).toBe("field_required");
    expect(calls.filter((c) => c.url.includes("charges"))).toHaveLength(1);
  });
});

describe("one request_id per operation", () => {
  let db: Db;
  beforeEach(async () => {
    db = await testDb();
  });

  const op = { key: "payout:seller_a:2026-10-26", method: "POST", path: "/api/v1/connected_account_transfers/create" };

  it("reuses the same request_id after an ambiguous failure", async () => {
    const ids: string[] = [];
    await expect(
      onceForOperation(db, op, async (id) => {
        ids.push(id);
        throw new AirwallexError(0, "network_error", "socket hang up");
      }),
    ).rejects.toThrow();
    await onceForOperation(db, op, async (id) => {
      ids.push(id);
      return { id: "tr_1" };
    });
    expect(ids[0]).toBe(ids[1]);
  });

  it("never calls Airwallex again once the operation succeeded", async () => {
    let calls = 0;
    const run = () => onceForOperation(db, op, async () => ({ id: `tr_${++calls}` }));
    await run();
    const replay = await run();
    expect(calls).toBe(1);
    expect(replay).toMatchObject({ replayed: true, result: { id: "tr_1" } });
  });

  it("does not retry an operation that failed definitively", async () => {
    await expect(
      onceForOperation(db, op, async () => {
        throw new AirwallexError(400, "insufficient_fund", "no funds");
      }),
    ).rejects.toThrow();
    await expect(onceForOperation(db, op, async () => ({}))).rejects.toThrow(/already failed/);
  });
});

describe("webhook signatures", () => {
  const secret = "whsec_test";
  const body = '{"id":"evt_1","name":"deposit.settled","data":{"object":{}}}';
  const now = 1_761_500_000_000;
  const ts = String(now);

  it("accepts a correctly signed body", () => {
    const signature = signForTests(secret, ts, body);
    expect(verifyAirwallexSignature({ rawBody: body, timestamp: ts, signature, secret, now })).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    const signature = signForTests(secret, ts, body);
    const res = verifyAirwallexSignature({ rawBody: body.replace("evt_1", "evt_2"), timestamp: ts, signature, secret, now });
    expect(res).toEqual({ ok: false, reason: "signature mismatch" });
  });

  it("rejects a replayed delivery outside the time window", () => {
    const signature = signForTests(secret, ts, body);
    const res = verifyAirwallexSignature({ rawBody: body, timestamp: ts, signature, secret, now: now + 10 * 60_000 });
    expect(res).toEqual({ ok: false, reason: "timestamp outside tolerance" });
  });
});
