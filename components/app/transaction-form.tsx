"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Field } from "@/components/app/field";
import { SymbolCombobox } from "@/components/app/symbol-combobox";
import { Notice } from "@/components/app/stat";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { saveTransaction, type FormState } from "@/app/(app)/activity/actions";
import { TRANSACTION_TYPE_LABELS } from "@/lib/validation/transaction";
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
}: {
  initial: TransactionFormValues;
  /** Con `id`, edita esa operación; sin `id`, crea una. */
  id?: string;
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

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {id && <input type="hidden" name="id" value={id} />}

      {state.status === "error" && state.message && (
        <Notice tone="error">{state.message}</Notice>
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
              hint="Por acción, sin comisión"
            >
              <Input
                id="price"
                name="price"
                defaultValue={value("price")}
                aria-invalid={fieldErrors.price ? true : undefined}
                aria-describedby={describe("price")}
                {...decimal}
              />
            </Field>
          </div>
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
