import { describe, expect, it, vi } from "vitest";
import { takeRateLimit } from "../rate-limit";

const clientWith = (result: {
  data: unknown;
  error: { message: string } | null;
}) => {
  const rpc = vi.fn(async () => result);
  return { client: { rpc } as never, rpc };
};

describe("takeRateLimit", () => {
  it("devuelve true si la base dice que está dentro del límite y manda solo la clave", async () => {
    const { client, rpc } = clientWith({ data: true, error: null });
    expect(await takeRateLimit(client, "search_symbols")).toBe(true);
    expect(rpc).toHaveBeenCalledWith("take_rate_limit", {
      p_key: "search_symbols",
    });
  });

  it("devuelve false si se pasó del límite", async () => {
    expect(
      await takeRateLimit(
        clientWith({ data: false, error: null }).client,
        "refresh_quotes",
      ),
    ).toBe(false);
  });

  it("cualquier respuesta que no sea exactamente true se toma como rechazo", async () => {
    for (const data of [null, undefined, "true", 1, {}]) {
      expect(
        await takeRateLimit(
          clientWith({ data, error: null }).client,
          "import_csv",
        ),
      ).toBe(false);
    }
  });

  it("si la base falla, lanza (no deja pasar sin límite)", async () => {
    await expect(
      takeRateLimit(
        clientWith({ data: null, error: { message: "caída" } }).client,
        "import_csv",
      ),
    ).rejects.toThrow("db take_rate_limit: caída");
  });
});
