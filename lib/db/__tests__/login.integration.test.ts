import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PG,
  createAdmin,
  createAnon,
  createTestUser,
  createTestUserRecord,
  deleteTestUser,
  type DbClient,
  type TestUser,
  type TestUserRecord,
} from "./integration-helpers";

// Ingreso con código (Fase 6) contra finance-dev (`pnpm test:integration`): el límite de intentos
// antes de tener sesión y un código OTP real de 6 dígitos. No se envía ningún correo: el código se
// genera con la API de administración (`generateLink` nunca manda mail).

const newKey = () => randomBytes(32).toString("hex");

describe("ingreso con código (integración, finance-dev)", () => {
  let admin: DbClient;
  const keys: string[] = [];
  const users: TestUserRecord[] = [];
  let signedIn: TestUser | undefined;

  const key = () => {
    const k = newKey();
    keys.push(k);
    return k;
  };
  const take = (k: string) => admin.rpc("take_login_attempt", { p_key: k });
  const row = async (k: string) =>
    (
      await admin
        .from("login_attempts")
        .select("count, window_start")
        .eq("key", k)
        .maybeSingle()
    ).data;

  beforeAll(() => {
    admin = createAdmin();
  });

  afterAll(async () => {
    if (keys.length > 0)
      await admin.from("login_attempts").delete().in("key", keys);
    for (const user of users) await deleteTestUser(admin, user);
    await deleteTestUser(admin, signedIn);
  });

  describe("take_login_attempt / clear_login_attempts", () => {
    it("permite 5 verificaciones por ventana y rechaza la sexta", async () => {
      const k = key();
      for (let i = 1; i <= 5; i++) {
        const { data, error } = await take(k);
        expect(error, `intento ${i}`).toBeNull();
        expect(data, `intento ${i}`).toBe(true);
      }
      expect((await take(k)).data).toBe(false);
      expect((await take(k)).data).toBe(false);
      expect((await row(k))?.count).toBe(7); // sigue contando: no se "libera" solo por insistir
    });

    it("cada email tiene su propio contador", async () => {
      const a = key();
      const b = key();
      for (let i = 0; i < 6; i++) await take(a);
      expect((await take(a)).data).toBe(false);
      expect((await take(b)).data).toBe(true);
    });

    it("pasada la ventana de 15 minutos el contador vuelve a empezar", async () => {
      const k = key();
      for (let i = 0; i < 6; i++) await take(k);
      expect((await take(k)).data).toBe(false);
      const old = new Date(Date.now() - 16 * 60_000).toISOString();
      await admin
        .from("login_attempts")
        .update({ window_start: old })
        .eq("key", k);
      expect((await take(k)).data).toBe(true);
      expect((await row(k))?.count).toBe(1);
      // Y a 14 minutos todavía no se libera.
      const recent = new Date(Date.now() - 14 * 60_000).toISOString();
      for (let i = 0; i < 5; i++) await take(k);
      await admin
        .from("login_attempts")
        .update({ window_start: recent })
        .eq("key", k);
      expect((await take(k)).data).toBe(false);
    });

    it("un ingreso exitoso borra el contador", async () => {
      const k = key();
      for (let i = 0; i < 5; i++) await take(k);
      const cleared = await admin.rpc("clear_login_attempts", { p_key: k });
      expect(cleared.error).toBeNull();
      expect(await row(k)).toBeNull();
      expect((await take(k)).data).toBe(true);
    });

    it("limpia las filas de más de un día, para que la tabla no crezca sin límite", async () => {
      const stale = key();
      await admin.from("login_attempts").insert({
        key: stale,
        count: 3,
        window_start: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      });
      await take(key());
      expect(await row(stale)).toBeNull();
    });

    it("rechaza claves que no son un SHA-256 hexadecimal", async () => {
      for (const bad of [
        "",
        "abc",
        "Z".repeat(64),
        "A".repeat(64),
        "a".repeat(63),
        "a".repeat(65),
      ]) {
        const { error } = await take(bad);
        expect(error?.code, JSON.stringify(bad)).toBe("22023");
        expect(
          (await admin.rpc("clear_login_attempts", { p_key: bad })).error?.code,
        ).toBe("22023");
      }
      const nul = await admin.rpc("take_login_attempt", {
        p_key: null as unknown as string,
      });
      expect(nul.error).not.toBeNull();
    });

    it("solo la clave secreta puede usarlas: ni anónimos ni usuarios con sesión", async () => {
      const k = key();
      const asAnon = createAnon();
      expect(
        (await asAnon.rpc("take_login_attempt", { p_key: k })).error?.code,
      ).toBe(PG.insufficientPrivilege);
      expect(
        (await asAnon.rpc("clear_login_attempts", { p_key: k })).error?.code,
      ).toBe(PG.insufficientPrivilege);

      signedIn = await createTestUser(admin, "login");
      expect(
        (await signedIn.client.rpc("take_login_attempt", { p_key: k })).error
          ?.code,
      ).toBe(PG.insufficientPrivilege);
      expect(
        (await signedIn.client.rpc("clear_login_attempts", { p_key: k })).error
          ?.code,
      ).toBe(PG.insufficientPrivilege);
    });

    it("la tabla no se puede leer ni escribir sin la clave secreta (RLS y permisos)", async () => {
      const k = key();
      await take(k);
      expect(
        (await createAnon().from("login_attempts").select("key")).error?.code,
      ).toBe(PG.insufficientPrivilege);
      const asUser =
        signedIn ?? (signedIn = await createTestUser(admin, "login"));
      expect(
        (await asUser.client.from("login_attempts").select("key")).error?.code,
      ).toBe(PG.insufficientPrivilege);
      expect(
        (await asUser.client.from("login_attempts").delete().eq("key", k)).error
          ?.code,
      ).toBe(PG.insufficientPrivilege);
      expect(
        (
          await asUser.client
            .from("login_attempts")
            .insert({ key: newKey(), count: 0 })
        ).error?.code,
      ).toBe(PG.insufficientPrivilege);
      expect(await row(k)).not.toBeNull(); // nadie la tocó
    });
  });

  describe("código OTP real", () => {
    async function freshCode(email: string): Promise<string> {
      const { data, error } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      if (error || !data.properties)
        throw new Error(`generateLink: ${error?.message}`);
      return data.properties.email_otp;
    }
    const otherThan = (code: string) =>
      code === "111111" ? "222222" : "111111";

    it("el código tiene 6 dígitos (otp_length de supabase/config.toml aplicado)", async () => {
      const user = await createTestUserRecord(admin, "otp-len");
      users.push(user);
      expect(await freshCode(user.email)).toMatch(/^\d{6}$/);
    });

    it("verifyOtp con el código abre sesión de esa persona", async () => {
      const user = await createTestUserRecord(admin, "otp-ok");
      users.push(user);
      const code = await freshCode(user.email);

      const anon = createAnon();
      const { data, error } = await anon.auth.verifyOtp({
        email: user.email,
        token: code,
        type: "email",
      });
      expect(error).toBeNull();
      expect(data.user?.id).toBe(user.id);
      expect(data.session?.access_token).toBeTruthy();

      // La sesión es de verdad: lee sus propios datos con RLS.
      const profile = await anon.from("profiles").select("id").single();
      expect(profile.data?.id).toBe(user.id);
    });

    it("un código equivocado no sirve, y el bueno sigue valiendo después de fallar", async () => {
      const user = await createTestUserRecord(admin, "otp-bad");
      users.push(user);
      const code = await freshCode(user.email);

      const anon = createAnon();
      const wrong = await anon.auth.verifyOtp({
        email: user.email,
        token: otherThan(code),
        type: "email",
      });
      expect(wrong.error).not.toBeNull();
      expect(wrong.data.session).toBeNull();

      const ok = await anon.auth.verifyOtp({
        email: user.email,
        token: code,
        type: "email",
      });
      expect(ok.error).toBeNull();
      expect(ok.data.user?.id).toBe(user.id);
    });

    it("un código ya usado no sirve otra vez", async () => {
      const user = await createTestUserRecord(admin, "otp-twice");
      users.push(user);
      const code = await freshCode(user.email);

      const first = await createAnon().auth.verifyOtp({
        email: user.email,
        token: code,
        type: "email",
      });
      expect(first.error).toBeNull();
      const second = await createAnon().auth.verifyOtp({
        email: user.email,
        token: code,
        type: "email",
      });
      expect(second.error).not.toBeNull();
      expect(second.data.session).toBeNull();
    });

    it("el código de una persona no abre la cuenta de otra", async () => {
      const a = await createTestUserRecord(admin, "otp-a");
      const b = await createTestUserRecord(admin, "otp-b");
      users.push(a, b);
      const codeA = await freshCode(a.email);

      const crossed = await createAnon().auth.verifyOtp({
        email: b.email,
        token: codeA,
        type: "email",
      });
      expect(crossed.error).not.toBeNull();
      expect(crossed.data.session).toBeNull();
    });

    it("un código nuevo invalida al anterior", async () => {
      const user = await createTestUserRecord(admin, "otp-new");
      users.push(user);
      const oldCode = await freshCode(user.email);
      const newCode = await freshCode(user.email);
      if (oldCode === newCode) return; // 1 en un millón: no se puede comparar
      const stale = await createAnon().auth.verifyOtp({
        email: user.email,
        token: oldCode,
        type: "email",
      });
      expect(stale.error).not.toBeNull();
      const fresh = await createAnon().auth.verifyOtp({
        email: user.email,
        token: newCode,
        type: "email",
      });
      expect(fresh.error).toBeNull();
    });
  });
});
