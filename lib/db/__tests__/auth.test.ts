import { describe, expect, it } from "vitest";
import { getSessionUser } from "../auth";

const clientWith = (result: {
  data: { claims: Record<string, unknown> } | null;
}) => ({ auth: { getClaims: async () => result } }) as never;

describe("getSessionUser", () => {
  it("devuelve el id y el email de los claims verificados", async () => {
    const user = await getSessionUser(
      clientWith({ data: { claims: { sub: "u-1", email: "a@b.com" } } }),
    );
    expect(user).toEqual({ id: "u-1", email: "a@b.com" });
  });

  it("sin email en el token: email null", async () => {
    expect(
      await getSessionUser(clientWith({ data: { claims: { sub: "u-1" } } })),
    ).toEqual({ id: "u-1", email: null });
  });

  it.each([
    ["sin sesión", { data: null }],
    ["claims sin sub", { data: { claims: { email: "a@b.com" } } }],
    ["sub vacío", { data: { claims: { sub: "" } } }],
    ["sub que no es texto", { data: { claims: { sub: 5 } } }],
  ])("%s: null", async (_label, result) => {
    expect(await getSessionUser(clientWith(result))).toBeNull();
  });

  it("nunca usa getSession()", async () => {
    const client = {
      auth: {
        getClaims: async () => ({ data: { claims: { sub: "u" } } }),
        getSession: () => {
          throw new Error("getSession() no se puede usar en el servidor");
        },
      },
    } as never;
    await expect(getSessionUser(client)).resolves.toMatchObject({ id: "u" });
  });
});
