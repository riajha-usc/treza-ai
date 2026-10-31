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

