import { describe, expect, it } from "vitest";
import { plural } from "../plural";

describe("plural", () => {
  it("singular solo con exactamente uno", () => {
    expect(plural(1, "operación", "operaciones")).toBe("operación");
    for (const n of [0, 2, 10, 1.5, -1]) {
      expect(plural(n, "operación", "operaciones")).toBe("operaciones");
    }
  });
});
