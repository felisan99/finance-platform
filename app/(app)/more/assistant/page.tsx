import { Trash2 } from "lucide-react";
import { redirect } from "next/navigation";
import { Notice, PageHeader } from "@/components/app/stat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MEMORY_KIND_LABELS } from "@/lib/assistant/memory";
import { supabaseMemoryStore } from "@/lib/assistant/memory-store";
import {
  RUN_COLUMNS,
  formatAverage,
  formatCount,
  formatSeconds,
  resolveUsage,
} from "@/lib/assistant/usage-view";
import { getSessionUser } from "@/lib/db/auth";
import { createClient } from "@/lib/db/server";
import { formatChartShare } from "@/lib/portfolio/chart-format";
import { describeError } from "@/lib/market-data";
import { forgetMemory } from "./actions";

/** Turnos que entran en las métricas (los más recientes). */
const RUNS_WINDOW = 500;

export default async function AssistantSettingsPage() {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const [memories, runs] = await Promise.all([
    supabaseMemoryStore(supabase, user.id).list(),
    supabase
      .from("assistant_runs")
      .select(RUN_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(RUNS_WINDOW),
  ]);
  if (runs.error) {
    console.error("[assistant] métricas", describeError(runs.error));
  }
  const outcome = resolveUsage(runs.error !== null, runs.data);
  if (!outcome.ok && !runs.error) {
    console.error("[assistant] métricas con filas inválidas");
  }
  const usage = outcome.ok ? outcome.usage : null;

  const stats: Array<[string, string]> = !usage
    ? []
    : [
        ["Preguntas", formatCount(usage.turns)],
        ["Con error", formatCount(usage.errors)],
        ["Latencia (mediana)", formatSeconds(usage.latencyP50)],
        ["Latencia (p95)", formatSeconds(usage.latencyP95)],
        ["Primera respuesta del modelo", formatSeconds(usage.ttftP50)],
        ["Pasos por pregunta", formatAverage(usage.avgSteps)],
        ["Tokens por pregunta", formatCount(usage.avgTokens)],
        [
          "Respondió el modelo de respaldo",
          usage.fallbackShare === null
            ? "—"
            : formatChartShare(usage.fallbackShare),
        ],
        [
          "Compactaciones",
          usage.compactionSaving === null
            ? formatCount(usage.compactions)
            : `${formatCount(usage.compactions)} (−${formatChartShare(usage.compactionSaving)} de contexto)`,
        ],
      ];

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Asistente" />

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Lo que recuerda de vos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {memories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nada todavía. Si le contás tu perfil de riesgo o tus objetivos, lo
              guarda para la próxima. Nunca guarda montos de tu cartera.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {memories.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="text-muted-foreground">
                      {MEMORY_KIND_LABELS[item.kind]}:{" "}
                    </span>
                    {item.content}
                  </span>
                  <form action={forgetMemory}>
                    <input type="hidden" name="id" value={item.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Olvidar: ${item.content}`}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Uso</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!usage ? (
            <Notice tone="error">
              No pudimos cargar el uso del asistente. Probá de nuevo en unos
              minutos.
            </Notice>
          ) : (
            <>
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                {stats.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              {usage.tools.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">Herramientas más usadas</p>
                  <ul className="flex flex-col gap-0.5 text-sm">
                    {usage.tools.map((tool) => (
                      <li
                        key={tool.name}
                        className="flex justify-between gap-2"
                      >
                        <span className="text-muted-foreground">
                          {tool.label}
                        </span>
                        <span className="tabular-nums">
                          {formatCount(tool.calls)}
                          {tool.failures > 0 &&
                            ` (${formatCount(tool.failures)} con error)`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {usage.models.length > 0 && (
                <p className="text-xs break-words text-muted-foreground">
                  Modelos:{" "}
                  {usage.models
                    .map((m) => `${m.model} (${formatCount(m.turns)})`)
                    .join(", ")}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Últimas {formatCount(RUNS_WINDOW)} preguntas como máximo. No se
                guarda el texto de las conversaciones en estas métricas.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
