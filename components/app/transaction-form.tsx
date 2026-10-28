"use client";

import Link from "next/link";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import { Field } from "@/components/app/field";
import { SymbolCombobox } from "@/components/app/symbol-combobox";
import { Notice } from "@/components/app/stat";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  getReferencePrice,
  saveTransaction,
  type FormState,
  type ReferencePriceResponse,
} from "@/app/(app)/activity/actions";
import { TRANSACTION_TYPE_LABELS } from "@/lib/portfolio/transaction-type-labels";
import { cn } from "@/lib/utils";

export interface TransactionFormValues {
  type: string;
  symbol: string;
  quantity: string;
  price: string;
  fee: string;
  amount: string;
  splitNew: string;
  splitOld: string;
  /** `YYYY-MM-DDTHH:mm` en hora de Montevideo. */
  executedAt: string;
  notes: string;
  /** Id del portafolio donde se guarda. */
  portfolio: string;
}

const NEEDS_SYMBOL = new Set(["BUY", "SELL", "DIVIDEND", "SPLIT"]);
const TYPES = Object.keys(TRANSACTION_TYPE_LABELS) as Array<
  keyof typeof TRANSACTION_TYPE_LABELS
>;
const initialState: FormState = { status: "idle" };

const decimal = {
  type: "text",
  inputMode: "decimal",
  autoComplete: "off",
  autoCapitalize: "off",
  autoCorrect: "off",
  spellCheck: false,
} as const;

/**
 * Alta y edición de una operación. Los campos que se muestran dependen del tipo; el servidor
 * valida todo igual (esto es solo comodidad). Si hay un error, se conserva lo escrito.
 */
export function TransactionForm({
  initial,
  id,
  portfolios,
}: {
  initial: TransactionFormValues;
  /** Con `id`, edita esa operación; sin `id`, crea una. */
  id?: string;
  /**
   * Los portafolios de la persona. Con más de uno, el alta pregunta en cuál guardar; la edición solo
   * lo muestra (una operación no se mueve de portafolio).
   */
  portfolios: ReadonlyArray<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(
    saveTransaction,
    initialState,
  );
  const echoed = state.status === "error" ? state.values : undefined;
  const fieldErrors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const value = (name: keyof TransactionFormValues) =>
    echoed?.[name] ?? initial[name];

  const [type, setType] = useState(value("type"));
  const hasSymbol = NEEDS_SYMBOL.has(type);
  const isTrade = type === "BUY" || type === "SELL";
  const isSplit = type === "SPLIT";
  const hasAmount = !isTrade && !isSplit;

  const describe = (name: string) =>
    fieldErrors[name] ? `${name}-error` : undefined;

  // Precio de referencia (solo en el alta de una compra o venta): al elegir el símbolo se trae la
  // cotización de hoy y se deja escrita en el precio, como la fecha y la hora que arrancan en
  // "ahora". Si la persona ya escribió el precio, no se lo pisa: queda el botón «Usar este precio».
  const wantsReference = !id && isTrade;
  const [price, setPrice] = useState(value("price"));
  const priceTouched = useRef(value("price") !== "");
  const [committed, setCommitted] = useState<{
    symbol: string;
    n: number;
  } | null>(null);
  const [reference, setReference] = useState<{
    symbol: string;
    response: ReferencePriceResponse;
  } | null>(null);
  /** Último símbolo consultado y si salió bien: uno que salió bien no se vuelve a pedir. */
  const asked = useRef<{ symbol: string; ok: boolean } | null>(null);

  const handleCommit = (raw: string) => {
    const symbol = raw.trim().toUpperCase();
    if (symbol === "") return;
    if (asked.current?.symbol === symbol && asked.current.ok) return;
    // El precio que dejamos escrito era de otro símbolo: si nadie lo tocó, se borra hasta que llegue
    // el nuevo (y si el nuevo no llega, no queda un precio que no corresponde).
    if (asked.current?.symbol !== symbol && !priceTouched.current) setPrice("");
    setCommitted((previous) => ({ symbol, n: (previous?.n ?? 0) + 1 }));
  };

  useEffect(() => {
    if (!wantsReference || committed === null) return;
    const { symbol } = committed;
    if (asked.current?.symbol === symbol && asked.current.ok) return;
    let cancelled = false;
    const settle = (response: ReferencePriceResponse) => {
      if (cancelled) return;
      asked.current = { symbol, ok: response.ok };
      setReference({ symbol, response });
      if (response.ok && !priceTouched.current) setPrice(response.price);
    };
    getReferencePrice(symbol).then(settle, () =>
      settle({
        ok: false,
        message: "No pudimos traer el precio actual ahora. Cargalo a mano.",
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [wantsReference, committed]);

  const referenceLoading =
    wantsReference &&
    committed !== null &&
    reference?.symbol !== committed.symbol;
  const shownReference =
    wantsReference &&
    committed !== null &&
    reference?.symbol === committed.symbol
      ? reference.response
      : null;

  return (
    <form
      // Con `action={formAction}`, React 19 reinicia el formulario al terminar la acción: el tipo y
      // el precio (controlados) quedaban mostrando otra cosa que su estado después de un error (se
      // veía «Compra» con los campos de un depósito, y un segundo envío mandaba «Compra»). Enviado
      // así no se reinicia y cada campo conserva lo que escribió la persona.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      {id && <input type="hidden" name="id" value={id} />}

      {state.status === "error" && state.message && (
        <Notice tone="error">{state.message}</Notice>
      )}

      {id || portfolios.length < 2 ? (
        <>
          {!id && (
            <input type="hidden" name="portfolio" value={initial.portfolio} />
          )}
          {portfolios.length > 1 && (
            <p className="text-sm">
              <span className="text-muted-foreground">Portafolio: </span>
              {portfolios.find((p) => p.id === initial.portfolio)?.name}
            </p>
          )}
        </>
      ) : (
        <Field id="portfolio" label="Portafolio" error={fieldErrors.portfolio}>
          <NativeSelect
            id="portfolio"
            name="portfolio"
            defaultValue={value("portfolio")}
            aria-invalid={fieldErrors.portfolio ? true : undefined}
            aria-describedby={describe("portfolio")}
          >
            {/* Mirando «Todo junto» no hay uno por defecto: hay que elegirlo. */}
            {initial.portfolio === "" && (
              <option value="" disabled>
                Elegí un portafolio
              </option>
            )}
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}

      <Field id="type" label="Tipo de operación" error={fieldErrors.type}>
        <NativeSelect
          id="type"
          name="type"
          value={type}
          onChange={(event) => setType(event.target.value)}
          aria-invalid={fieldErrors.type ? true : undefined}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TRANSACTION_TYPE_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
      </Field>

      {hasSymbol && (
        <Field id="symbol" label="Símbolo" error={fieldErrors.symbol}>
          <SymbolCombobox
            id="symbol"
            name="symbol"
            defaultValue={value("symbol")}
            invalid={Boolean(fieldErrors.symbol)}
            describedBy={describe("symbol")}
            onCommit={handleCommit}
          />
        </Field>
      )}

      {isTrade && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field id="quantity" label="Cantidad" error={fieldErrors.quantity}>
              <Input
                id="quantity"
                name="quantity"
                defaultValue={value("quantity")}
                aria-invalid={fieldErrors.quantity ? true : undefined}
                aria-describedby={describe("quantity")}
                {...decimal}
              />
            </Field>
            <Field
              id="price"
              label="Precio (USD)"
              error={fieldErrors.price}
              hint="Por unidad (acción o moneda), sin comisión"
            >
              <Input
                id="price"
                name="price"
                value={price}
                onChange={(event) => {
                  priceTouched.current = true;
                  setPrice(event.target.value);
                }}
                aria-invalid={fieldErrors.price ? true : undefined}
                aria-describedby={describe("price")}
                {...decimal}
              />
            </Field>
          </div>
          {!id && (
            <p
              aria-live="polite"
              className="-mt-2 min-h-4 text-xs text-muted-foreground"
            >
              {referenceLoading && committed ? (
                `Buscando el precio actual de ${committed.symbol}…`
              ) : shownReference?.ok ? (
                <>
                  Precio actual de {shownReference.symbol}:{" "}
                  <span className="font-medium text-foreground">
                    {shownReference.priceText}
                  </span>{" "}
                  ({shownReference.asOfText}).{" "}
                  {price === shownReference.price ? (
                    "Ya está cargado: cambialo si operaste a otro precio."
                  ) : (
                    <button
                      key="use-reference"
                      type="button"
                      className="underline"
                      onClick={() => {
                        priceTouched.current = false;
                        setPrice(shownReference.price);
                      }}
                    >
                      Usar este precio
                    </button>
                  )}
                </>
              ) : (
                (shownReference?.message ?? null)
              )}
            </p>
          )}
          <Field
            id="fee"
            label="Comisión (USD)"
            error={fieldErrors.fee}
            hint="Opcional"
          >
            <Input
              id="fee"
              name="fee"
              defaultValue={value("fee")}
              aria-invalid={fieldErrors.fee ? true : undefined}
              aria-describedby={describe("fee")}
              {...decimal}
            />
          </Field>
        </>
      )}

      {isSplit && (
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="splitNew"
            label="Acciones nuevas"
            error={fieldErrors.splitNew}
          >
            <Input
              id="splitNew"
              name="splitNew"
              defaultValue={value("splitNew")}
              aria-invalid={fieldErrors.splitNew ? true : undefined}
              aria-describedby={describe("splitNew")}
              {...decimal}
            />
          </Field>
          <Field
            id="splitOld"
            label="Por cada"
            error={fieldErrors.splitOld}
            hint="Ej.: 10 por cada 1"
          >
            <Input
              id="splitOld"
              name="splitOld"
              defaultValue={value("splitOld")}
              aria-invalid={fieldErrors.splitOld ? true : undefined}
              aria-describedby={describe("splitOld")}
              {...decimal}
            />
          </Field>
        </div>
      )}

      {hasAmount && (
        <Field
          id="amount"
          label="Monto (USD)"
          error={fieldErrors.amount}
          hint={
            type === "INTEREST"
              ? "Negativo si es interés que pagaste"
              : undefined
          }
        >
          <Input
            id="amount"
            name="amount"
            defaultValue={value("amount")}
            aria-invalid={fieldErrors.amount ? true : undefined}
            aria-describedby={describe("amount")}
            {...decimal}
          />
        </Field>
      )}

      <Field
        id="executedAt"
        label="Fecha y hora"
        error={fieldErrors.executedAt}
        hint="Hora de Montevideo"
      >
        <Input
          id="executedAt"
          name="executedAt"
          type="datetime-local"
          step={60}
          defaultValue={value("executedAt")}
          aria-invalid={fieldErrors.executedAt ? true : undefined}
          aria-describedby={describe("executedAt")}
        />
      </Field>

      <Field id="notes" label="Notas" error={fieldErrors.notes} hint="Opcional">
        <Input
          id="notes"
          name="notes"
          defaultValue={value("notes")}
          maxLength={500}
          aria-invalid={fieldErrors.notes ? true : undefined}
          aria-describedby={describe("notes")}
        />
      </Field>

      <div className="flex gap-2 pt-1">
        <Button type="submit" size="lg" disabled={pending} className="flex-1">
          {pending
            ? "Guardando…"
            : id
              ? "Guardar cambios"
              : "Guardar operación"}
        </Button>
        <Link
          href="/activity"
          className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
