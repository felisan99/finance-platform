import { describe, expect, it, vi } from "vitest";
import type { StoredMessage } from "../compaction";
import type { Conversation } from "../conversation-store";
import type { MemoryItem } from "../memory";
import {
  loadTurnContext,
  type AssistantLimitKey,
  type TurnContextDeps,
} from "../turn-context";

const conversation: Conversation = {
  id: "c1",
  summary: "resumen",
  summarizedThrough: 4,
};
const stored: StoredMessage[] = [
  {
    seq: 5,
    message: { id: "m5", role: "user", parts: [{ type: "text", text: "hola" }] },
  },
];
const memories: MemoryItem[] = [
  { id: "x", kind: "goal", content: "jubilarme", updatedAt: "2026-01-01" },
];
const scope = { kind: "all" } as const;

type Scope = typeof scope;

function fakeDeps(overrides: Partial<TurnContextDeps<Scope>> = {}) {
  const limitCalls: AssistantLimitKey[] = [];
  const deps: TurnContextDeps<Scope> = {
    takeLimit: async (key) => {
      limitCalls.push(key);
      return true;
    },
    getConversation: async () => conversation,
    getScope: async () => scope,
    loadMessages: async () => stored,
    listMemories: async () => memories,
    ...overrides,
  };
  return { deps, limitCalls };
}

/** La versión anterior de la ruta, en serie, para comparar resultados. */
async function serialReference(deps: TurnContextDeps<Scope>) {
  if (
    !(await deps.takeLimit("assistant_message")) ||
    !(await deps.takeLimit("assistant_daily"))
  ) {
    return { ok: false as const, reason: "rate_limited" as const };
  }
  const [found, foundScope] = await Promise.all([
    deps.getConversation(),
    deps.getScope(),
  ]);
  if (!found) return { ok: false as const, reason: "no_conversation" as const };
  if (!foundScope) {
    return { ok: false as const, reason: "no_portfolio" as const };
  }
  const [messages, memoryItems] = await Promise.all([
    deps.loadMessages(found),
    deps.listMemories(),
  ]);
  return {
    ok: true as const,
    conversation: found,
    scope: foundScope,
    stored: messages,
    memories: memoryItems,
  };
}

/** Una promesa que se resuelve o rechaza a mano, para ordenar los eventos sin relojes. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const boom = () => Promise.reject(new Error("db"));

describe("loadTurnContext", () => {
  it("returns the same context as the serial version", async () => {
    const { deps } = fakeDeps();
    expect(await loadTurnContext(deps)).toEqual(await serialReference(deps));
    expect(await loadTurnContext(deps)).toEqual({
      ok: true,
      conversation,
      scope,
      stored,
      memories,
    });
  });

  it("loads the messages of the conversation it read", async () => {
    const loadMessages = vi.fn(async () => stored);
    const { deps } = fakeDeps({ loadMessages });
    await loadTurnContext(deps);
    expect(loadMessages).toHaveBeenCalledExactlyOnceWith(conversation);
  });

  it("takes each limit once, message first then daily", async () => {
    const { deps, limitCalls } = fakeDeps();
    await loadTurnContext(deps);
    expect(limitCalls).toEqual(["assistant_message", "assistant_daily"]);
  });

  it("does not take the daily limit when the per-message one rejects", async () => {
    const { deps, limitCalls } = fakeDeps({
      takeLimit: async (key) => {
        limitCalls.push(key);
        return false;
      },
    });
    expect(await loadTurnContext(deps)).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect(limitCalls).toEqual(["assistant_message"]);
  });

  it("rejects on the daily limit and returns no data", async () => {
    const { deps } = fakeDeps({
      takeLimit: async (key) => key === "assistant_message",
    });
    const result = await loadTurnContext(deps);
    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(result).toEqual(await serialReference(deps));
  });

  it("a rate limit rejection wins over failed reads, without unhandled rejections", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const { deps } = fakeDeps({
        takeLimit: async () => false,
        getConversation: boom,
        getScope: boom,
        listMemories: boom,
      });
      expect(await loadTurnContext(deps)).toEqual({
        ok: false,
        reason: "rate_limited",
      });
      // Deja correr las microtareas y un macrotask para que Node detecte rechazos sueltos.
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("throws when a rate limit call fails, as before", async () => {
    const { deps } = fakeDeps({ takeLimit: boom });
    await expect(loadTurnContext(deps)).rejects.toThrow("db");
  });

  it("maps a missing conversation and a missing portfolio like the serial version", async () => {
    const noConversation = fakeDeps({ getConversation: async () => null });
    expect(await loadTurnContext(noConversation.deps)).toEqual({
      ok: false,
      reason: "no_conversation",
    });
    expect(await serialReference(noConversation.deps)).toEqual({
      ok: false,
      reason: "no_conversation",
    });

    const noScope = fakeDeps({ getScope: async () => null });
    expect(await loadTurnContext(noScope.deps)).toEqual({
      ok: false,
      reason: "no_portfolio",
    });
    expect(await serialReference(noScope.deps)).toEqual({
      ok: false,
      reason: "no_portfolio",
    });

    const neither = fakeDeps({
      getConversation: async () => null,
      getScope: async () => null,
    });
    expect(await loadTurnContext(neither.deps)).toEqual({
      ok: false,
      reason: "no_conversation",
    });
  });

  it("a missing conversation wins over a failed memory read, as before", async () => {
    const { deps } = fakeDeps({
      getConversation: async () => null,
      listMemories: boom,
    });
    expect(await loadTurnContext(deps)).toEqual(await serialReference(deps));
  });

  it("a missing portfolio wins over failed message or memory reads, as before", async () => {
    const { deps } = fakeDeps({
      getScope: async () => null,
      loadMessages: boom,
      listMemories: boom,
    });
    expect(await loadTurnContext(deps)).toEqual({
      ok: false,
      reason: "no_portfolio",
    });
    expect(await serialReference(deps)).toEqual({
      ok: false,
      reason: "no_portfolio",
    });
  });

  it.each([
    ["conversation", { getConversation: boom }],
    ["portfolio", { getScope: boom }],
    ["messages", { loadMessages: boom }],
    ["memory", { listMemories: boom }],
  ] as const)(
    "throws when the %s read fails and the limits pass",
    async (_name, override) => {
      const { deps } = fakeDeps(override);
      await expect(loadTurnContext(deps)).rejects.toThrow("db");
      await expect(serialReference(deps)).rejects.toThrow("db");
    },
  );

  it("starts the reads while the limits are still pending, and waits for both limits", async () => {
    const messageLimit = deferred<boolean>();
    const dailyLimit = deferred<boolean>();
    const started: string[] = [];
    const { deps } = fakeDeps({
      takeLimit: (key) => {
        started.push(key);
        return key === "assistant_message"
          ? messageLimit.promise
          : dailyLimit.promise;
      },
      getConversation: async () => {
        started.push("conversation");
        return conversation;
      },
      getScope: async () => {
        started.push("scope");
        return scope;
      },
      loadMessages: async () => {
        started.push("messages");
        return stored;
      },
      listMemories: async () => {
        started.push("memories");
        return memories;
      },
    });

    let settled = false;
    const result = loadTurnContext(deps).then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => setImmediate(resolve));

    // Ningún límite resolvió y todas las lecturas ya corrieron; el diario todavía no se tomó.
    expect(started).toEqual([
      "assistant_message",
      "conversation",
      "scope",
      "memories",
      "messages",
    ]);
    expect(settled).toBe(false);

    messageLimit.resolve(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(started.at(-1)).toBe("assistant_daily");
    expect(settled).toBe(false);

    dailyLimit.resolve(true);
    expect((await result).ok).toBe(true);
  });

  it("the critical path is two round trips instead of four (fake timers)", async () => {
    vi.useFakeTimers();
    try {
      // Cada lectura o límite tarda 100 ms (un viaje a la base).
      const trip = <T>(value: T) =>
        new Promise<T>((resolve) => setTimeout(() => resolve(value), 100));
      const deps: TurnContextDeps<Scope> = {
        takeLimit: () => trip(true),
        getConversation: () => trip(conversation),
        getScope: () => trip(scope),
        loadMessages: () => trip(stored),
        listMemories: () => trip(memories),
      };

      const timeOf = async (run: () => Promise<unknown>) => {
        const start = Date.now();
        const pending = run();
        await vi.runAllTimersAsync();
        await pending;
        return Date.now() - start;
      };

      expect(await timeOf(() => serialReference(deps))).toBe(400);
      expect(await timeOf(() => loadTurnContext(deps))).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});
