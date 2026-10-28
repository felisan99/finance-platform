import { describe, expect, it } from "vitest";
import { resolveUsage } from "../usage-view";

describe("resolveUsage", () => {
  it("flags a failed query instead of returning zeros", () => {
    expect(resolveUsage(true, null)).toEqual({ ok: false });
  });

  it("flags rows that do not validate", () => {
    expect(resolveUsage(false, [{ nope: 1 }])).toEqual({ ok: false });
  });

  it("treats an empty successful result as real, empty data", () => {
    const outcome = resolveUsage(false, []);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.usage.turns).toBe(0);
  });
});
