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
    message: {
      id: "m5",
      role: "user",
      parts: [{ type: "text", text: "hola" }],
    },
  },
];
const memories: MemoryItem[] = [
  { id: "x", kind: "goal", content: "jubilarme", updatedAt: "2026-01-01" },
];
const scope = { kind: "all" } as const;

type Scope = typeof scope;

function fakeDeps(overrides: Partial<TurnContextDeps<Scope>> = {}) {
  const limitCalls: AssistantLimitKey[] = [];
  const loadMessages = vi.fn(async () => stored);
  const listMemories = vi.fn(async () => memories);
  const deps: TurnContextDeps<Scope> = {
    takeLimit: async (key) => {
      limitCalls.push(key);
      return true;
    },
    getConversation: async () => conversation,
    getScope: async () => scope,
    loadMessages,
    listMemories,
    ...overrides,
  };
  return { deps, limitCalls, loadMessages, listMemories };
}

/** Una promesa que se resuelve a mano, para ordenar los eventos sin relojes. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const noConversation = async (): Promise<Conversation | null> => null;
const noScope = async (): Promise<Scope | null> => null;
const boom = () => Promise.reject(new Error("db"));
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("loadTurnContext", () => {
  it("returns the conversation, scope, messages and memories", async () => {
    const { deps, loadMessages } = fakeDeps();
    expect(await loadTurnContext(deps)).toEqual({
      ok: true,
      conversation,
      scope,
      stored,
      memories,
    });
    expect(loadMessages).toHaveBeenCalledExactlyOnceWith(conversation);
  });

  it("takes each limit once, message first then daily", async () => {
    const { deps, limitCalls } = fakeDeps();
    await loadTurnContext(deps);
    expect(limitCalls).toEqual(["assistant_message", "assistant_daily"]);
  });

  it("does not take the daily limit nor read messages or memory when the per-message limit rejects", async () => {
    const { deps, limitCalls, loadMessages, listMemories } = fakeDeps({
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
    await flush();
    expect(loadMessages).not.toHaveBeenCalled();
    expect(listMemories).not.toHaveBeenCalled();
  });

  it("never reads messages or memory when the daily limit rejects", async () => {
    const { deps, loadMessages, listMemories } = fakeDeps({
      takeLimit: async (key) => key === "assistant_message",
    });
    expect(await loadTurnContext(deps)).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    await flush();
    expect(loadMessages).not.toHaveBeenCalled();
    expect(listMemories).not.toHaveBeenCalled();
  });

  it("a rate limit rejection wins over failed reads, without unhandled rejections", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const { deps } = fakeDeps({
        takeLimit: async () => false,
        getConversation: boom,
        getScope: boom,
      });
      expect(await loadTurnContext(deps)).toEqual({
        ok: false,
        reason: "rate_limited",
      });
      await flush();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("throws when a rate limit call fails, as before", async () => {
    const { deps } = fakeDeps({ takeLimit: boom });
    await expect(loadTurnContext(deps)).rejects.toThrow("db");
  });

  it.each([
    [
      "missing conversation",
      { getConversation: noConversation },
      "no_conversation",
    ],
    ["missing portfolio", { getScope: noScope }, "no_portfolio"],
    [
      "missing conversation and portfolio",
      { getConversation: noConversation, getScope: noScope },
      "no_conversation",
    ],
    [
      "missing conversation with a failing memory read",
      { getConversation: noConversation, listMemories: boom },
      "no_conversation",
    ],
    [
      "missing portfolio with failing message and memory reads",
      { getScope: noScope, loadMessages: boom, listMemories: boom },
      "no_portfolio",
    ],
  ] as const)("%s → %s", async (_name, override, reason) => {
    const { deps } = fakeDeps(override);
    expect(await loadTurnContext(deps)).toEqual({ ok: false, reason });
  });

  it("does not read messages or memory when the conversation or portfolio is missing", async () => {
    for (const override of [
      { getConversation: noConversation },
      { getScope: noScope },
    ]) {
      const { deps, loadMessages, listMemories } = fakeDeps(override);
      await loadTurnContext(deps);
      expect(loadMessages).not.toHaveBeenCalled();
      expect(listMemories).not.toHaveBeenCalled();
    }
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
    },
  );

  it("overlaps conversation and portfolio with the limits; messages and memory wait for both limits", async () => {
    const messageLimit = deferred<boolean>();
    const dailyLimit = deferred<boolean>();
    const started: string[] = [];
    const { deps, loadMessages, listMemories } = fakeDeps({
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
    });

    const result = loadTurnContext(deps);
    await flush();
    expect([...started].sort()).toEqual(
      ["assistant_message", "conversation", "scope"].sort(),
    );
    expect(loadMessages).not.toHaveBeenCalled();
    expect(listMemories).not.toHaveBeenCalled();

    messageLimit.resolve(true);
    await flush();
    expect(started).toContain("assistant_daily");
    expect(loadMessages).not.toHaveBeenCalled();
    expect(listMemories).not.toHaveBeenCalled();

    dailyLimit.resolve(true);
    expect((await result).ok).toBe(true);
    expect(loadMessages).toHaveBeenCalledOnce();
    expect(listMemories).toHaveBeenCalledOnce();
  });

  it("the critical path is three round trips (fake timers)", async () => {
    vi.useFakeTimers();
    try {
      // Cada lectura o límite tarda 100 ms (un viaje a la base). Antes eran 4 en serie (400 ms).
      const trip = <T>(value: T) =>
        new Promise<T>((resolve) => setTimeout(() => resolve(value), 100));
      const deps: TurnContextDeps<Scope> = {
        takeLimit: () => trip(true),
        getConversation: () => trip(conversation),
        getScope: () => trip(scope),
        loadMessages: () => trip(stored),
        listMemories: () => trip(memories),
      };

      const start = Date.now();
      const pending = loadTurnContext(deps);
      await vi.runAllTimersAsync();
      expect((await pending).ok).toBe(true);
      expect(Date.now() - start).toBe(300);
    } finally {
      vi.useRealTimers();
    }
  });
});
