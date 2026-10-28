import { describe, expect, it } from "vitest";
import { stripInternalRefs } from "../internal-refs";

describe("stripInternalRefs", () => {
  it("saca las citas de tools y funciones internas", () => {
    expect(
      stripInternalRefs(
        "Por tres razones concretas, todas basadas en tu cartera actual (get_positions):",
      ),
    ).toBe("Por tres razones concretas, todas basadas en tu cartera actual:");
    expect(
      stripInternalRefs(
        "Rindió +12,40% (computeTwr, 1A: 30/09/2025 – 30/09/2026) en el último año.",
      ),
    ).toBe("Rindió +12,40% en el último año.");
    expect(stripInternalRefs("Según `simulate_trade`, quedarías así.")).toBe(
      "Según, quedarías así.",
    );
    expect(stripInternalRefs("Dato (source.fn) final")).toBe("Dato final");
  });

  it("no toca paréntesis comunes ni el formato del texto", () => {
    const text =
      "Tenés VOO (S&P 500) y NVDA (en dólares).\n\n- **Vendé** un tercio (si no la necesitás).";
    expect(stripInternalRefs(text)).toBe(text);
  });
});
