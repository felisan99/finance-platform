import { describe, expect, it } from "vitest";
import { loginSchema } from "../login";

describe("loginSchema", () => {
  it("normaliza el email: sin espacios y en minúsculas", () => {
    const parsed = loginSchema.parse({ email: "  Felipe@Example.COM " });
    expect(parsed.email).toBe("felipe@example.com");
  });

  it("acepta emails con puntos y subdirecciones", () => {
    expect(
      loginSchema.safeParse({ email: "a.b+tag@sub.example.org" }).success,
    ).toBe(true);
  });

  it.each(["", "   ", "sin-arroba", "a@", "@b.com", "a b@c.com", "a@b"])(
    "rechaza %j",
    (email) => {
      expect(loginSchema.safeParse({ email }).success).toBe(false);
    },
  );

  it("rechaza un campo ausente o que no es texto (FormData.get puede dar null o un File)", () => {
    expect(loginSchema.safeParse({ email: null }).success).toBe(false);
    expect(loginSchema.safeParse({}).success).toBe(false);
    expect(loginSchema.safeParse({ email: 42 }).success).toBe(false);
  });
});
