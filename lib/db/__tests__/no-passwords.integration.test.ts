import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAdmin,
  createAnon,
  createTestUser,
  deleteTestUser,
  generateLoginCode,
  type DbClient,
  type TestUser,
  type TestUserRecord,
} from "./integration-helpers";

// Sin contraseñas (migración `no_passwords`): el trigger `strip_user_password` borra el hash cada
// vez que Auth lo escribe, así que el ingreso con contraseña de la API pública de Supabase nunca
// abre una sesión. Corre contra finance-dev (ver assertDevProject).
//
// El alta pública con contraseña (`signUp`) no se prueba acá: mandaría un correo de confirmación.
// Escribe la misma fila de auth.users que `admin.createUser`, y el trigger es el mismo.

const newPassword = () => `Pw-${randomBytes(16).toString("hex")}`;

describe("sin contraseñas (integración, finance-dev)", () => {
  let admin: DbClient;
  const users: TestUserRecord[] = [];

  const signInWithPassword = (email: string, password: string) =>
    createAnon().auth.signInWithPassword({ email, password });

  beforeAll(() => {
    admin = createAdmin();
  });

  afterAll(async () => {
    for (const user of users) await deleteTestUser(admin, user);
  });

  it("una contraseña dada al crear el usuario no sirve para entrar; el código sí", async () => {
    const email = `rls-nopw-create-${randomBytes(4).toString("hex")}@example.com`;
    const password = newPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(error).toBeNull();
    users.push({ id: data.user!.id, email });

    const attempt = await signInWithPassword(email, password);
    expect(attempt.error).not.toBeNull();
    expect(attempt.data.session).toBeNull();

    const withCode = await createAnon().auth.verifyOtp({
      email,
      token: await generateLoginCode(admin, email),
      type: "email",
    });
    expect(withCode.error).toBeNull();
    expect(withCode.data.user?.id).toBe(data.user!.id);
  });

  describe("cambiar la contraseña de un usuario que ya existe", () => {
    let user: TestUser;

    beforeAll(async () => {
      user = await createTestUser(admin, "nopw-update");
      users.push(user);
    });

    it("con su propia sesión (lo que haría alguien con un token robado), no deja una que sirva", async () => {
      const password = newPassword();
      // Auth puede aceptarlo o pedir reautenticación: en ningún caso la contraseña tiene que servir.
      await user.client.auth.updateUser({ password });

      const attempt = await signInWithPassword(user.email, password);
      expect(attempt.error).not.toBeNull();
      expect(attempt.data.session).toBeNull();
    });

    it("con la clave secreta, tampoco", async () => {
      const password = newPassword();
      const { error } = await admin.auth.admin.updateUserById(user.id, {
        password,
      });
      expect(error).toBeNull();

      const attempt = await signInWithPassword(user.email, password);
      expect(attempt.error).not.toBeNull();
      expect(attempt.data.session).toBeNull();
    });

    it("cambiar otros datos del usuario no se ve afectado", async () => {
      const { data, error } = await admin.auth.admin.updateUserById(user.id, {
        user_metadata: { marca: "no-passwords" },
      });
      expect(error).toBeNull();
      expect(data.user?.user_metadata).toMatchObject({ marca: "no-passwords" });
    });
  });

  it("la función del trigger no es invocable como RPC", async () => {
    const { error } = await createAnon().rpc(
      "strip_user_password" as never,
      {} as never,
    );
    expect(error).not.toBeNull();
  });
});
