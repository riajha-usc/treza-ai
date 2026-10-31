import { describe, expect, it } from "vitest";
import { format, toMajor, toMinor } from "@/lib/money/money";

describe("money", () => {
  it("converts major to minor units without float drift", () => {
    expect(toMinor(0.1 + 0.2, "USD")).toBe(30);
    expect(toMinor(19.99, "USD")).toBe(1999);
    expect(toMinor(1500, "JPY")).toBe(1500);
  });

  it("converts back to major units", () => {
    expect(toMajor(1999, "USD")).toBe(19.99);
    expect(() => toMajor(1.5, "USD")).toThrow();
  });

  it("formats currency", () => {
    expect(format(123456, "USD")).toBe("$1,234.56");
  });
});
