"use client";

import Link from "next/link";
import { useState } from "react";
import { PnlText } from "@/components/app/pnl-text";
import { Segmented } from "@/components/app/segmented";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  ContributionModeView,
  ContributionRowView,
  ContributionView,
} from "@/lib/portfolio/contribution-view";

type Mode = "total" | "day";

const BAR_COLOR = { gain: "bg-gain", loss: "bg-loss", flat: "bg-transparent" };

/**
 * Barra que sale del centro: a la derecha (verde) si ganó, a la izquierda (roja) si perdió. Es
 * decorativa: el monto con su signo y su flecha está en texto al lado, así que no depende del color.
 */
function Bar({ ratio, tone }: Pick<ContributionRowView, "ratio" | "tone">) {
  const width = `${Math.abs(ratio) * 50}%`;
  return (
    <div
      aria-hidden="true"
      className="relative mt-1.5 h-2 rounded-full bg-muted"
    >
      <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
      <div
        className={`absolute inset-y-0 rounded-full ${BAR_COLOR[tone ?? "flat"]}`}
        style={{ left: ratio >= 0 ? "50%" : `calc(50% - ${width})`, width }}
      />
    </div>
  );
}

function Row({ row }: { row: ContributionRowView }) {
  const content = (
    <>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium">
          {row.label}
          {row.closed && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              cerrada
            </span>
          )}
        </span>
        <PnlText text={row.text} tone={row.tone} className="shrink-0" />
      </div>
      <Bar ratio={row.ratio} tone={row.tone} />
    </>
  );
  return (
    <li>
      {row.href ? (
        <Link href={row.href} className="block rounded-md py-1 active:bg-muted">
          {content}
        </Link>
      ) : (
        <div className="py-1">{content}</div>
      )}
    </li>
  );
}

function ModeList({ mode, view }: { mode: Mode; view: ContributionModeView }) {
  if (view.rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {mode === "day"
          ? "Todavía no hay cambios del día para mostrar."
          : "Todavía no hay posiciones con datos."}
      </p>
    );
  }
  return (
    <>
      <ul className="flex flex-col gap-1.5">
        {view.rows.map((row) => (
          <Row key={row.key} row={row} />
        ))}
      </ul>
      <div className="flex items-baseline justify-between gap-3 border-t pt-3 text-sm">
        <span className="text-muted-foreground">
          {mode === "total" ? "Ganancia total" : "Total del día"}
        </span>
        <PnlText
          text={view.totalText}
          tone={view.totalTone}
          className="font-semibold"
        />
      </div>
      {view.note && (
        <p className="text-xs text-muted-foreground">{view.note}</p>
      )}
    </>
  );
}

/**
 * Ganancia por posición (Inicio): cuánto aportó cada símbolo, en dinero, abiertas y cerradas
 * ("Total") o solo el movimiento de hoy ("Hoy"). Solo alterna entre las dos listas: los textos, las
 * proporciones y el orden vienen del servidor (`lib/portfolio/contribution-view.ts`).
 */
export function ContributionCard({ view }: { view: ContributionView }) {
  const [mode, setMode] = useState<Mode>("total");
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>Ganancia por posición</CardTitle>
        <Segmented
          label="Período de la ganancia"
          value={mode}
          onChange={setMode}
          options={[
            { id: "total", text: "Total" },
            { id: "day", text: "Hoy" },
          ]}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ModeList mode={mode} view={view[mode]} />
      </CardContent>
    </Card>
  );
}
