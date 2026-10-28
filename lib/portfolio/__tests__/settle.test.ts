import { afterEach, describe, expect, it, vi } from "vitest";
import { settle } from "../settle";

afterEach(() => vi.restoreAllMocks());

describe("settle", () => {
  it("passes the value through", async () => {
    await expect(settle(Promise.resolve([1]), "x")).resolves.toEqual([1]);
  });

  it("resolves null and logs when the read rejects", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      settle(Promise.reject(new Error("boom")), "closes"),
    ).resolves.toBeNull();
    expect(spy).toHaveBeenCalledWith("[closes]", "boom");
  });

  it("handles non-Error rejections", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(settle(Promise.reject("nope"), "c")).resolves.toBeNull();
    expect(spy).toHaveBeenCalledWith("[c]", "nope");
  });
});
