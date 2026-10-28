"use client";

import { useActionState, useState } from "react";
import { Notice } from "@/components/app/stat";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  confirmDividends,
  dismissDividend,
  setWithholdingRate,
  type DividendActionState,
} from "@/app/(app)/activity/dividends/actions";
import {
  addAllConfirmationText,
  DISMISS_CONFIRMATION_TEXT,
} from "@/lib/portfolio/dividends-confirm";
import type { PendingDividendView } from "@/lib/portfolio/dividends-view";

const idle: DividendActionState = { status: "idle" };

function StateNotice({ state }: { state: DividendActionState }) {
  if (state.status === "idle") return null;
  return (
    <Notice tone={state.status === "error" ? "error" : "info"}>
      {state.message}
    </Notice>
  );
}

/** La retención que aplica EE. UU.: al cambiarla se recalculan las propuestas. */
export function WithholdingForm({
  value,
  options,
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  const [state, action, pending] = useActionState(setWithholdingRate, idle);
  return (
    <form action={action} className="flex flex-col gap-2">
      <label htmlFor="withholding-rate" className="text-sm font-medium">
        Retención de EE. UU. sobre tus dividendos
      </label>
      {/* `key`: si el servidor cambia la tasa, el select vuelve a mostrar la guardada. */}
      <div className="flex gap-2" key={value}>
        <NativeSelect
          id="withholding-rate"
          name="rate"
          defaultValue={value}
          className="min-w-0 flex-1"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </div>
      <StateNotice state={state} />
    </form>
  );
}

function DividendRow({ item }: { item: PendingDividendView }) {
  const [addState, add, adding] = useActionState(confirmDividends, idle);
  const [dismissState, dismiss, dismissing] = useActionState(
    dismissDividend,
    idle,
  );
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);
  const busy = adding || dismissing;
  return (
    <li className="flex flex-col gap-2 rounded-lg border px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {item.symbol}
            {item.portfolioName && (
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                · {item.portfolioName}
              </span>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            Ex-dividendo {item.exDate} · {item.detail}
          </p>
        </div>
        <div className="shrink-0 text-right tabular-nums">
          <p className="font-medium">{item.net}</p>
          <p className="text-xs text-muted-foreground">
            {item.gross} bruto · {item.withholding}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <form action={add} className="flex-1">
          <input type="hidden" name="key" value={item.key} />
          <Button
            type="submit"
            size="sm"
            className="min-h-11 w-full"
            disabled={busy}
          >
            {adding ? "Agregando…" : "Agregar"}
          </Button>
        </form>
        <form action={dismiss} className="flex flex-col gap-2">
          <input type="hidden" name="key" value={item.key} />
          {!confirmingDismiss ? (
            <Button
              key="dismiss-ask"
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => setConfirmingDismiss(true)}
            >
              Descartar
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm">{DISMISS_CONFIRMATION_TEXT}</p>
              <div className="flex gap-2">
                <Button
                  key="dismiss-confirm"
                  type="submit"
                  size="sm"
                  variant="destructive"
                  className="min-h-11 flex-1"
                  disabled={busy}
                >
                  {dismissing ? "Descartando…" : "Sí, descartar"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setConfirmingDismiss(false)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </form>
      </div>
      <StateNotice
        state={addState.status === "error" ? addState : dismissState}
      />
    </li>
  );
}

export function DividendList({
  items,
  totalNet,
}: {
  items: PendingDividendView[];
  totalNet: string;
}) {
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [state, addAll, pending] = useActionState(confirmDividends, idle);
  return (
    <div className="flex flex-col gap-3">
      {items.length > 1 && (
        <form action={addAll} className="flex flex-col gap-2">
          {items.map((item) => (
            <input key={item.key} type="hidden" name="key" value={item.key} />
          ))}
          {!confirmingAll ? (
            <Button
              key="add-all-ask"
              type="button"
              className="min-h-11"
              disabled={pending}
              onClick={() => setConfirmingAll(true)}
            >
              {`Agregar los ${items.length}`}
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                {addAllConfirmationText(items.length, totalNet)}
              </p>
              <div className="flex gap-2">
                <Button
                  key="add-all-confirm"
                  type="submit"
                  className="min-h-11 flex-1"
                  disabled={pending}
                >
                  {pending
                    ? "Agregando…"
                    : `Confirmar: agregar los ${items.length}`}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={pending}
                  onClick={() => setConfirmingAll(false)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </form>
      )}
      <StateNotice state={state} />
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <DividendRow key={item.key} item={item} />
        ))}
      </ul>
    </div>
  );
}
