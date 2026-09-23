import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PG,
  createAdmin,
  createAnon,
  createTestUser,
  deleteTestUser,
  type DbClient,
  type TestUser,
} from "./integration-helpers";

// Registro solo por invitación (spec §11): el hook "Before User Created" rechaza los emails que
// no están en public.allowed_emails. Corre contra finance-dev (ver assertDevProject).

const rand = () => randomBytes(4).toString("hex");

describe("registro solo por invitación (integración, finance-dev)", () => {
  let admin: DbClient;
  let user: TestUser;
  const allowedEmails: string[] = [];
  const strayUserEmails: string[] = [];

  beforeAll(async () => {
    admin = createAdmin();
    user = await createTestUser(admin, "gate");
  }, 120_000);

  afterAll(async () => {
    await deleteTestUser(admin, user);
    if (allowedEmails.length > 0) {
      await admin.from("allowed_emails").delete().in("email", allowedEmails);
    }
    // Si el hook estuviera apagado, el test de rechazo habría creado un usuario: se borra.
    if (strayUserEmails.length > 0) {
      const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
      for (const stray of data?.users ?? []) {
        if (stray.email && strayUserEmails.includes(stray.email)) {
          await admin.auth.admin.deleteUser(stray.id);
        }
      }
    }
  }, 120_000);

  it("rechaza con 403 a un email que no está en allowed_emails y no crea el usuario", async () => {
    const email = `sin-acceso-${rand()}@example.com`;
    strayUserEmails.push(email);

    const { error } = await createAnon().auth.signInWithOtp({ email });

    expect(error?.status).toBe(403);
    expect(error?.message).toMatch(/no tiene acceso/i);

    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    expect(data?.users.some((u) => u.email === email)).toBe(false);
  });

  describe("función hook_before_user_created", () => {
    const call = (client: DbClient, email: string) =>
      client.rpc("hook_before_user_created", { event: { user: { email } } });

    it("deja pasar a un email habilitado, sin importar mayúsculas ni espacios", async () => {
      const email = `con-acceso-${rand()}@example.com`;
      allowedEmails.push(email);
      const insert = await admin.from("allowed_emails").insert({ email });
      expect(insert.error).toBeNull();

      const { data, error } = await call(admin, `  ${email.toUpperCase()} `);
      expect(error).toBeNull();
      expect(data).toEqual({});
    });

    it("rechaza a un email que no está en la lista", async () => {
      const { data, error } = await call(admin, `nadie-${rand()}@example.com`);
      expect(error).toBeNull();
      expect(data).toMatchObject({ error: { http_code: 403 } });
    });

    it("rechaza un evento sin email", async () => {
      const { data } = await admin.rpc("hook_before_user_created", {
        event: { user: {} },
      });
      expect(data).toMatchObject({ error: { http_code: 403 } });
    });

    it("no se puede llamar desde la API pública (anon ni authenticated)", async () => {
      const anon = await call(createAnon(), "cualquiera@example.com");
      expect(anon.data).toBeNull();
      expect(anon.error?.code).toBe(PG.insufficientPrivilege);

      const authenticated = await call(user.client, "cualquiera@example.com");
      expect(authenticated.data).toBeNull();
      expect(authenticated.error?.code).toBe(PG.insufficientPrivilege);
    });

    it("el trigger handle_new_user tampoco es invocable como RPC", async () => {
      const { error } = await createAnon().rpc(
        "handle_new_user" as never,
        {} as never,
      );
      expect(error).not.toBeNull();
    });
  });

  describe("tabla allowed_emails", () => {
    it("rechaza emails sin normalizar (CHECK)", async () => {
      for (const email of [
        "Mayusculas@Example.com",
        " espacios@example.com",
        "sin-arroba",
      ]) {
        const { error } = await admin.from("allowed_emails").insert({ email });
        expect(error?.code, email).toBe(PG.checkViolation);
      }
    });

    it("no permite repetir un email", async () => {
      const email = `repetido-${rand()}@example.com`;
      allowedEmails.push(email);
      expect(
        (await admin.from("allowed_emails").insert({ email })).error,
      ).toBeNull();
      const again = await admin.from("allowed_emails").insert({ email });
      expect(again.error?.code).toBe(PG.uniqueViolation);
    });
  });
});
