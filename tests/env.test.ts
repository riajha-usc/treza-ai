import { afterEach, describe, expect, it } from "vitest";
import { env, resetEnvForTests } from "@/lib/env";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  resetEnvForTests();
});

describe("env", () => {
  it("treats blank values copied from .env.example as not set", () => {
    process.env.DATABASE_URL = "";
    process.env.AIRWALLEX_WEBHOOK_SECRET = "   ";
    process.env.ANTHROPIC_API_KEY = "";
    resetEnvForTests();
    const e = env();
    expect(e.DATABASE_URL).toBeUndefined();
    expect(e.AIRWALLEX_WEBHOOK_SECRET).toBeUndefined();
    expect(e.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("still rejects a malformed database URL", () => {
    process.env.DATABASE_URL = "not a url";
    resetEnvForTests();
    expect(() => env()).toThrow();
  });
});
