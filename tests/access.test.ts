import { describe, expect, it } from "vitest";
import { decideAccess, sameKey } from "@/lib/access";

const at = (pathname: string, search = "", cookie?: string, key: string | undefined = "k3y-of-sixteen-c") =>
  decideAccess({ key, pathname, search: new URLSearchParams(search), cookie });

describe("hosted demo access link", () => {
  it("guards nothing when no key is configured", () => {
    expect(decideAccess({ key: undefined, pathname: "/", search: new URLSearchParams(), cookie: undefined })).toEqual({ kind: "open" });
  });
  it("leaves API routes open for Airwallex, merchants and health checks", () => {
    expect(at("/api/webhooks/airwallex")).toEqual({ kind: "open" });
    expect(at("/api/airwallex/remote-auth")).toEqual({ kind: "open" });
  });
  it("grants once from the link and strips the key from the redirect", () => {
    expect(at("/purchases", "key=k3y-of-sixteen-c&tab=2")).toEqual({ kind: "grant", redirectTo: "/purchases?tab=2" });
    expect(at("/", "key=k3y-of-sixteen-c")).toEqual({ kind: "grant", redirectTo: "/" });
  });
  it("allows by cookie and denies everything else", () => {
    expect(at("/sellers", "", "k3y-of-sixteen-c")).toEqual({ kind: "allow" });
    expect(at("/sellers", "", "wrong-cookie-xxxx")).toEqual({ kind: "deny" });
    expect(at("/sellers", "key=nope")).toEqual({ kind: "deny" });
  });
  it("compares keys without short-circuiting on length or prefix", () => {
    expect(sameKey("abc", "abc")).toBe(true);
    expect(sameKey("abc", "abd")).toBe(false);
    expect(sameKey("abc", "ab")).toBe(false);
    expect(sameKey(undefined, "abc")).toBe(false);
  });
});
