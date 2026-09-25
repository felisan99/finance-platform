"use client";

import { useActionState, useState, startTransition } from "react";
import { Notice } from "@/components/app/stat";
import { Segmented } from "@/components/app/segmented";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  confirmImport,
  previewImport,
  type ImportState,
} from "@/app/(app)/activity/import/actions";
import { inputSignature } from "@/lib/portfolio/import-signature";
import { plural } from "@/lib/portfolio/plural";
import type {
  ImportPreviewView,
  ImportRowView,
} from "@/lib/portfolio/import-preview";

// El cliente no importa el motor ni el formato de dinero (arrastrarían decimal.js al navegador):
// todo lo que muestra viene ya escrito en `ImportPreviewView`.

const initial: ImportState = { status: "idle" };

type Mode = "file" | "paste";
const MODES = [
  { id: "file", text: "Subir archivo" },
  { id: "paste", text: "Pegar filas" },
] as const;

const SUSPECTED_SHOWN = 10;

/** Las operaciones en lista compacta (entra en 390 px): fecha, tipo y símbolo a la izquierda, detalle a la derecha. */
function RowList({ rows, hidden }: { rows: ImportRowView[]; hidden: number }) {
  return (
    <>
      <ul className="divide-y text-xs">
        {rows.map((row) => (
          <li
            key={row.row}
            className="flex items-baseline justify-between gap-3 py-1.5"
          >
            <span className="min-w-0">
              <span className="text-muted-foreground tabular-nums">
                {row.date}
              </span>{" "}
              <span className="font-medium">{row.typeLabel}</span>
              {row.symbol && <span> {row.symbol}</span>}
              <span className="text-muted-foreground"> · fila {row.row}</span>
            </span>
            <span className="text-right tabular-nums">{row.detail}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="pt-1 text-xs text-muted-foreground">…y {hidden} más.</p>
      )}
    </>
  );
}

function PreviewPanel({
  view,
  includeSuspected,
  busy,
  onIncludeSuspected,
}: {
  view: ImportPreviewView;
  includeSuspected: boolean;
  busy: boolean;
  onIncludeSuspected: (include: boolean) => void;
}) {
  const skippedCount = view.skipped.reduce((n, s) => n + s.count, 0);
  const suspectedHidden = view.suspectedCount - view.suspected.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          Vista previa
          {view.format && (
            <Badge variant="outline">Formato: {view.format.label}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {!view.fatal && (
          <p className="tabular-nums">
            <strong>{view.newCount}</strong>{" "}
            {plural(view.newCount, "operación nueva", "operaciones nuevas")}
            {view.duplicateCount > 0 && (
              <>
                {" "}
                · {view.duplicateCount}{" "}
                {plural(view.duplicateCount, "ya importada", "ya importadas")}
              </>
            )}
            {view.suspectedCount > 0 && !view.suspectedIncluded && (
              <>
                {" "}
                · {view.suspectedCount}{" "}
                {plural(
                  view.suspectedCount,
                  "parece repetida",
                  "parecen repetidas",
                )}
              </>
            )}
            {skippedCount > 0 && (
              <>
                {" "}
                · {skippedCount}{" "}
                {plural(skippedCount, "fila ignorada", "filas ignoradas")}
              </>
            )}
            {view.errorCount > 0 && <> · {view.errorCount} con error</>}
          </p>
        )}

        {view.newByType.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {view.newByType.map((t) => (
              <li key={t.type}>
                <Badge variant="secondary">
                  {t.label} · {t.count}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        {view.newSymbols.length > 0 && (
          <p>
            <span className="text-muted-foreground">Instrumentos nuevos: </span>
            {view.newSymbols.join(", ")}
          </p>
        )}

        {view.errorGroups.length > 0 && (
          <div className="flex flex-col gap-3">
            {view.errorGroups.map((group) => (
              <div key={group.code} className="flex flex-col gap-1">
                <p className="font-medium text-destructive">
                  {group.label} ({group.count})
                </p>
                <ul className="flex flex-col gap-1 text-destructive">
                  {group.examples.map((example) => (
                    <li key={`${example.row}-${example.message}`}>
                      Fila {example.row}: {example.message}
                    </li>
                  ))}
                </ul>
                {group.count > group.examples.length && (
                  <p className="text-xs text-muted-foreground">
                    …y {group.count - group.examples.length} más de este tipo.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {view.suspectedCount > 0 && (
          <div className="flex flex-col gap-2 rounded-lg bg-warning p-3 text-warning-foreground">
            <p className="font-medium">
              Parecen repetir operaciones que ya tenés ({view.suspectedCount})
            </p>
            <p className="text-xs">
              Tienen el mismo día, tipo, símbolo y cantidad que algo ya cargado
              {includeSuspected
                ? ", y las vas a importar igual."
                : ", así que no se importan salvo que lo pidas."}
            </p>
            <RowList
              rows={view.suspected.slice(0, SUSPECTED_SHOWN)}
              hidden={
                suspectedHidden +
                Math.max(0, view.suspected.length - SUSPECTED_SHOWN)
              }
            />
            <label className="flex items-start gap-2 pt-1">
              <input
                type="checkbox"
                checked={includeSuspected}
                disabled={busy}
                onChange={(event) => onIncludeSuspected(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-current"
              />
              <span>
                Importar igual{" "}
                {plural(
                  view.suspectedCount,
                  "esta operación",
                  `estas ${view.suspectedCount} operaciones`,
                )}
              </span>
            </label>
          </div>
        )}

        {view.skipped.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="font-medium">Filas que se ignoran</p>
            <ul className="flex flex-col gap-1 text-muted-foreground">
              {view.skipped.map((s) => (
                <li key={s.reason}>
                  <span className="tabular-nums">{s.count} ×</span> {s.label}
                  <span className="text-xs">
                    {" "}
                    (filas {s.rows.join(", ")}
                    {s.count > s.rows.length ? "…" : ""})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {view.rows.length > 0 && (
          <details className="rounded-lg border px-3 py-2">
            <summary className="cursor-pointer font-medium">
              Ver{" "}
              {plural(
                view.newCount,
                "la operación que se va",
                `las ${view.newCount} operaciones que se van`,
              )}{" "}
              a cargar
            </summary>
            <p className="pt-2 pb-1 text-xs text-muted-foreground">
              Revisá que las fechas (día/mes/año) y los montos sean los que
              esperás.
            </p>
            <RowList rows={view.rows} hidden={view.rowsHidden} />
          </details>
        )}

        {view.afterText && view.newCount > 0 && (
          <div className="flex flex-col gap-1 rounded-lg bg-muted p-3">
            <p className="font-medium">Cómo quedaría tu portafolio</p>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 tabular-nums">
              <dt className="text-muted-foreground">Efectivo</dt>
              <dd>
                {view.afterText.cash.money}{" "}
                <span className="text-xs text-muted-foreground">
                  ({view.afterText.cash.exact})
                </span>
              </dd>
              <dt className="text-muted-foreground">
                Costo base de las abiertas
              </dt>
              <dd>
                {view.afterText.openCostBasis.money}{" "}
                <span className="text-xs text-muted-foreground">
                  ({view.afterText.openCostBasis.exact})
                </span>
              </dd>
              <dt className="text-muted-foreground">Ganancia realizada</dt>
              <dd>
                {view.afterText.realizedPnl.money}{" "}
                <span className="text-xs text-muted-foreground">
                  ({view.afterText.realizedPnl.exact})
                </span>
              </dd>
              <dt className="text-muted-foreground">Posiciones abiertas</dt>
              <dd>{view.afterText.openPositions.length}</dd>
            </dl>
            {view.afterText.openPositions.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground tabular-nums">
                {view.afterText.openPositions.map((p) => (
                  <li key={p.symbol}>
                    {p.symbol}: {p.quantity} · costo {p.costBasis}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {view.problems.map((problem) => (
          <Notice key={problem} tone="error">
            {problem}
          </Notice>
        ))}
        {view.warnings.map((warning) => (
          <Notice key={warning} tone="warning">
            {warning}
          </Notice>
        ))}
        {view.problems.length > 0 && (
          <p className="text-xs text-muted-foreground">
            ¿Dudas con el formato?{" "}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- descarga de un archivo: <Link> intentaría navegar */}
            <a href="/activity/import/plantilla" className="underline">
              Descargá la plantilla
            </a>{" "}
            y mirá la guía de arriba.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Importar operaciones en dos pasos: vista previa y confirmación. La entrada es un archivo CSV o
 * filas pegadas desde una planilla. Lo elegido se guarda en el estado del componente y se reenvía
 * en cada paso (el navegador limpia el campo de archivo después de una acción de formulario). El
 * servidor vuelve a leerlo y a validarlo al confirmar: no confía en la vista previa.
 */
export function ImportForm() {
  const [mode, setMode] = useState<Mode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [includeSuspected, setIncludeSuspected] = useState(false);
  const [previewState, previewAction, previewPending] = useActionState(
    previewImport,
    initial,
  );
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmImport,
    initial,
  );

  const hasInput = mode === "file" ? file !== null : pasted.trim() !== "";
  const signatureFor = (include: boolean) =>
    mode === "file" && file
      ? inputSignature(
          { kind: "file", name: file.name, size: file.size },
          include,
        )
      : mode === "paste" && pasted.trim() !== ""
        ? inputSignature({ kind: "text", text: pasted }, include)
        : "";
  const signature = signatureFor(includeSuspected);

  // Una vista previa de otra entrada (o de otra opción) no se muestra.
  const view =
    previewState.status === "preview" && previewState.signature === signature
      ? previewState.view
      : null;
  const busy = previewPending || confirmPending;

  const run = (
    action: (payload: FormData) => void,
    include = includeSuspected,
  ) => {
    if (!hasInput) return;
    const data = new FormData();
    if (mode === "file" && file) data.set("file", file);
    else data.set("text", pasted);
    data.set("include_suspected", include ? "1" : "0");
    startTransition(() => action(data));
  };

  const error =
    confirmState.status === "error"
      ? confirmState.message
      : previewState.status === "error"
        ? previewState.message
        : null;

  return (
    <div className="flex flex-col gap-4">
      <Segmented
        label="Cómo cargar las operaciones"
        options={MODES}
        value={mode}
        onChange={setMode}
        className="w-full"
      />

      {mode === "file" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="file">Archivo CSV</Label>
          <Input
            id="file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <p className="text-xs text-muted-foreground">
            Hasta 1 MB. No se guarda el archivo, solo las operaciones.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pasted">Filas copiadas de tu planilla</Label>
          <Textarea
            id="pasted"
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            rows={8}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            placeholder={
              "fecha\ttipo\tsimbolo\tcantidad\tprecio\n2026-03-09\tcompra\tVOO\t2\t400,50"
            }
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Copiá las celdas en Excel o Google Sheets, con la fila de
            encabezados, y pegalas acá. Hasta 1 MB.
          </p>
        </div>
      )}

      <Button
        type="button"
        size="lg"
        disabled={!hasInput || busy}
        onClick={() => run(previewAction)}
      >
        {previewPending ? "Leyendo…" : "Ver vista previa"}
      </Button>

      {error && <Notice tone="error">{error}</Notice>}
      {view && (
        <PreviewPanel
          view={view}
          includeSuspected={includeSuspected}
          busy={busy}
          onIncludeSuspected={(include) => {
            setIncludeSuspected(include);
            run(previewAction, include);
          }}
        />
      )}

      {view?.canConfirm && (
        <Button
          type="button"
          size="lg"
          disabled={busy}
          onClick={() => run(confirmAction)}
        >
          {confirmPending
            ? "Importando…"
            : `Confirmar importación (${view.newCount} ${plural(view.newCount, "operación", "operaciones")})`}
        </Button>
      )}
    </div>
  );
}
