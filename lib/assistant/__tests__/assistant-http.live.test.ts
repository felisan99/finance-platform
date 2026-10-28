import { spawn, type ChildProcess } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertDevProject,
  createAdmin,
  deleteTestUser,
  generateLoginCode,
  type DbClient,
} from "@/lib/db/__tests__/integration-helpers";
import type { Database } from "@/lib/db/database.types";
import { getAssistantConfig } from "../config";

// El asistente de punta a punta (`pnpm test:live`, necesita `pnpm build`): `next start`, una sesión
// real de finance-dev, una pregunta por HTTP con streaming contra OpenRouter, y después los
// mensajes y las métricas guardados en la base. Borra los usuarios al terminar.

const PORT = 3114;
const BASE = `http://localhost:${PORT}`;

class CookieJar {
  private readonly cookies = new Map<string, string>();
  getAll() {
    return [...this.cookies].map(([name, value]) => ({ name, value }));
  }
  setAll(list: Array<{ name: string; value: string }>) {
    for (const { name, value } of list) {
      if (value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([n, v]) => `${n}=${v}`).join("; ");
  }
}

interface Session {
  userId: string;
  jar: CookieJar;
  client: ReturnType<typeof createServerClient<Database>>;
}

async function waitFor<T>(
  probe: () => Promise<T | null>,
  timeoutMs = 60_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await probe();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("timeout");
}

describe.skipIf(!getAssistantConfig())(
  "asistente por HTTP con sesión real",
  () => {
    let admin: DbClient;
    let server: ChildProcess | undefined;
    let a: Session;
    let b: Session;
    const userIds: string[] = [];

    async function newSession(label: string): Promise<Session> {
      const { url, publishableKey } = assertDevProject();
      const email = `rls-assistant-${label}-${Math.random().toString(16).slice(2, 10)}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(error?.message);
      userIds.push(data.user.id);
      const jar = new CookieJar();
      const client = createServerClient<Database>(url, publishableKey, {
        cookies: { getAll: () => jar.getAll(), setAll: (l) => jar.setAll(l) },
      });
      const signIn = await client.auth.verifyOtp({
        email,
        token: await generateLoginCode(admin, email),
        type: "email",
      });
      if (signIn.error) throw new Error(signIn.error.message);
      return { userId: data.user.id, jar, client };
    }

    const post = (body: unknown, session?: Session) =>
      fetch(`${BASE}/api/assistant`, {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          ...(session ? { cookie: session.jar.header() } : {}),
        },
        body: JSON.stringify(body),
      });

    beforeAll(async () => {
      admin = createAdmin();
      a = await newSession("a");
      b = await newSession("b");

      // Una cartera mínima: un depósito, para que haya algo que valuar.
      const { data: account } = await a.client
        .from("accounts")
        .select("id")
        .single();
      const deposit = await a.client.from("transactions").insert({
        user_id: a.userId,
        account_id: account!.id,
        type: "DEPOSIT",
        executed_at: "2026-09-01T15:00:00Z",
        amount: 1234.56,
        currency: "USD",
        source: "manual",
      });
      if (deposit.error) throw new Error(deposit.error.message);

      server = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], {
        stdio: "ignore",
        env: process.env,
      });
      await waitFor(async () => {
        try {
          const response = await fetch(`${BASE}/login`);
          return response.ok ? true : null;
        } catch {
          return null;
        }
      });
    });

    afterAll(async () => {
      server?.kill();
      for (const id of userIds) {
        await deleteTestUser(admin, { id, email: id });
      }
    });

    it("sin sesión no responde", async () => {
      const response = await post({});
      expect([307, 401]).toContain(response.status);
    });

    it("la página abre la conversación y una pregunta se responde, se guarda y se mide", async () => {
      const page = await fetch(`${BASE}/assistant`, {
        headers: { cookie: a.jar.header() },
      });
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("No es asesoramiento financiero");

      const { data: conversation } = await a.client
        .from("assistant_conversations")
        .select("id")
        .single();
      expect(conversation).not.toBeNull();

      // B no puede usar la conversación de A.
      const intrusion = await post(
        {
          conversationId: conversation!.id,
          message: { id: "b1", text: "Hola" },
        },
        b,
      );
      expect(intrusion.status).toBe(404);

      const response = await post(
        {
          conversationId: conversation!.id,
          message: { id: "q1", text: "¿Cuánto efectivo tengo?" },
        },
        a,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const stream = await response.text();
      expect(stream).toContain("tool-input-available");
      expect(stream).toContain("get_positions");

      const messages = await waitFor(async () => {
        const { data } = await a.client
          .from("assistant_messages")
          .select("role, message")
          .order("seq");
        return data && data.length >= 2 ? data : null;
      });
      expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
      const answer = JSON.stringify(messages[1]!.message).replace(/\s/g, " ");
      expect(answer).toContain("1.234,56");

      const run = await waitFor(async () => {
        const { data } = await a.client
          .from("assistant_runs")
          .select("model, steps, tools, latency_ms, error_code")
          .maybeSingle();
        return data;
      });
      console.info(JSON.stringify(run, null, 2));
      expect(run.error_code).toBeNull();
      expect(run.steps).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(run.tools)).toContain("get_positions");
    });

    it("rechaza un cuerpo inválido", async () => {
      const response = await post(
        { conversationId: "no-es-uuid", message: { id: "x", text: "" } },
        a,
      );
      expect(response.status).toBe(400);
    });
  },
);
