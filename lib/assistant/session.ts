import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { takeRateLimit } from "@/lib/db/rate-limit";
import { formatDayHeader } from "@/lib/portfolio/format";
import type { PortfolioScope } from "@/lib/portfolio/portfolio-scope";
import { localDateKey } from "@/lib/portfolio/time";
import type { AssistantConfig } from "./config";
import { supabaseMemoryStore } from "./memory-store";
import { createTavilySearch } from "./news/tavily";
import { buildSystemPrompt } from "./prompt";
import { supabaseDataSource } from "./supabase-data-source";
import { buildTools, type ToolTiming } from "./tools";

/**
 * Todo lo que necesita un turno del asistente para quien está en la sesión: tools sobre sus datos
 * (cliente RLS), su memoria y el prompt. Nada de esto usa la clave secreta.
 */
export async function prepareTurn(args: {
  client: SupabaseClient<Database>;
  userId: string;
  scope: PortfolioScope;
  config: AssistantConfig;
  summary: string | null;
  now: Date;
}) {
  const { client, scope, config, now } = args;
  const ds = supabaseDataSource(client, scope, now);
  const memory = supabaseMemoryStore(client, args.userId);
  const memories = await memory.list();
  const timings: ToolTiming[] = [];

  const news = config.tavilyKey
    ? {
        search: createTavilySearch(config.tavilyKey),
        takeLimit: () => takeRateLimit(client, "news_search"),
        holds: async (symbol: string) =>
          (await ds.snapshot()).valued.positions.some(
            (p) => p.isOpen && p.symbol === symbol,
          ),
      }
    : null;

  const tools = buildTools({ ds, memory, news, timings });
  const todayKey = localDateKey(now);
  const instructions = buildSystemPrompt({
    todayText: `${formatDayHeader(todayKey)} de ${todayKey.slice(0, 4)}`,
    todayKey,
    scopeName: ds.scopeName,
    memories,
    summary: args.summary,
    hasNews: news !== null,
    hasMemory: true,
  });
  return { tools, instructions, timings };
}
