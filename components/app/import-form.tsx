"use client";

import { useActionState, useState, startTransition } from "react";
import { Notice } from "@/components/app/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  confirmImport,
  previewImport,
  type ImportState,
} from "@/app/(app)/activity/import/actions";
import { d } from "@/lib/engine";
import { formatMoney, formatQuantity } from "@/lib/portfolio/format";
import type { ImportPreviewView } from "@/lib/portfolio/import-preview";
import { TRANSACTION_TYPE_LABELS } from "@/lib/validation/transaction";

const initial: ImportState = { status: "idle" };
const typeLabel = (type: string) =>
  TRANSACTION_TYPE_LABELS[type as keyof typeof TRANSACTION_TYPE_LABELS] ?? type;

function PreviewPanel({ view }: { view: ImportPreviewView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Vista previa</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <p className="tabular-nums">
          <strong>{view.newCount}</strong> operaciones nuevas
          {view.duplicateCount > 0 && (
            <> · {view.duplicateCount} ya importadas</>
          )}
          {view.skipped.length > 0 && (
            <>
              {" "}
              · {view.skipped.reduce((n, s) => n + s.count, 0)} filas ignoradas
            </>
          )}
          {view.errorCount > 0 && <> · {view.errorCount} con error</>}
        </p>

        {view.newByType.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {view.newByType.map((t) => (
              <li key={t.type}>
                <Badge variant="secondary">
                  {typeLabel(t.type)} · {t.count}
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

        {view.errors.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="font-medium text-destructive">Filas con error</p>
            <ul className="flex flex-col gap-1 text-destructive">
              {view.errors.map((e) => (
                <li key={`${e.row}-${e.code}`}>
                  Fila {e.row}: {e.message}
                </li>
              ))}
            </ul>
            {view.errorCount > view.errors.length && (
              <p className="text-xs text-muted-foreground">
                …y {view.errorCount - view.errors.length} más.
              </p>
            )}
          </div>
        )}

        {view.after && (
          <div className="flex flex-col gap-1 rounded-lg bg-muted p-3">
            <p className="font-medium">Cómo quedaría tu portafolio</p>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 tabular-nums">
              <dt className="text-muted-foreground">Efectivo</dt>
              <dd>
                {formatMoney(d(view.after.cash))}{" "}
                <span className="text-xs text-muted-foreground">
                  ({formatQuantity(d(view.after.cash))})
                </span>
              </dd>
              <dt className="text-muted-foreground">
                Costo base de las abiertas
              </dt>
              <dd>
                {formatMoney(d(view.after.openCostBasis))}{" "}
                <span className="text-xs text-muted-foreground">
                  ({formatQuantity(d(view.after.openCostBasis))})
                </span>
              </dd>
              <dt className="text-muted-foreground">Ganancia realizada</dt>
              <dd>
                {formatMoney(d(view.after.realizedPnl), { signed: true })}{" "}
                <span className="text-xs text-muted-foreground">
                  ({formatQuantity(d(view.after.realizedPnl))})
                </span>
              </dd>
              <dt className="text-muted-foreground">Posiciones abiertas</dt>
              <dd>{view.after.openPositions.length}</dd>
            </dl>
            {view.after.openPositions.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground tabular-nums">
                {view.after.openPositions.map((p) => (
                  <li key={p.symbol}>
                    {p.symbol}: {formatQuantity(d(p.quantity))} · costo{" "}
                    {formatMoney(d(p.costBasis))}
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
      </CardContent>
    </Card>
  );
}

/**
 * Importar un CSV en dos pasos: vista previa y confirmación. El archivo se guarda en el estado del
 * componente y se reenvía en cada paso (el navegador limpia el campo de archivo después de una
 * acción de formulario). El servidor vuelve a leerlo y a validarlo al confirmar: no confía en la
 * vista previa.
 */
export function ImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [previewState, previewAction, previewPending] = useActionState(
    previewImport,
    initial,
  );
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmImport,
    initial,
  );

  const signature = file ? `${file.name}|${file.size}` : "";
  // Una vista previa de otro archivo (o de uno cambiado) no se muestra.
  const view =
    previewState.status === "preview" && previewState.signature === signature
      ? previewState.view
      : null;
  const busy = previewPending || confirmPending;

  const run = (action: (payload: FormData) => void) => {
    if (!file) return;
    const data = new FormData();
    data.set("file", file);
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
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="file">Archivo CSV de Delta</Label>
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

      <Button
        type="button"
        size="lg"
        disabled={!file || busy}
        onClick={() => run(previewAction)}
      >
        {previewPending ? "Leyendo el archivo…" : "Ver vista previa"}
      </Button>

      {error && <Notice tone="error">{error}</Notice>}
      {view && <PreviewPanel view={view} />}

      {view?.canConfirm && (
        <Button
          type="button"
          size="lg"
          disabled={busy}
          onClick={() => run(confirmAction)}
        >
          {confirmPending
            ? "Importando…"
            : `Confirmar importación (${view.newCount} operaciones)`}
        </Button>
      )}
    </div>
  );
}
