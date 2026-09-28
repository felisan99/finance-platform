"use client";

import { useActionState, useState } from "react";
import { Field } from "@/components/app/field";
import { Notice } from "@/components/app/stat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createPortfolio,
  deletePortfolio,
  renamePortfolio,
  type PortfolioFormState,
} from "@/app/(app)/more/portfolios/actions";
import { plural } from "@/lib/portfolio/plural";
import { PORTFOLIO_NAME_MAX } from "@/lib/validation/portfolio";

const initial: PortfolioFormState = { status: "idle" };

const nameInput = {
  type: "text",
  autoComplete: "off",
  maxLength: PORTFOLIO_NAME_MAX,
  required: true,
} as const;

/** Alta de un portafolio: al crearlo se pasa a mirarlo (en Inicio). */
export function CreatePortfolioForm() {
  const [state, action, pending] = useActionState(createPortfolio, initial);
  const error = state.status === "error" ? state.message : undefined;
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <Field
        id="new-portfolio"
        label="Nombre"
        error={error}
        hint="Por ejemplo: Acciones, Cripto, Retiro."
      >
        <Input
          id="new-portfolio"
          name="name"
          {...nameInput}
          defaultValue={state.status === "error" ? state.value : ""}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error ? "new-portfolio-error" : "new-portfolio-hint"
          }
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Creando…" : "Crear portafolio"}
      </Button>
    </form>
  );
}

/** Cambiar el nombre de un portafolio. */
export function RenamePortfolioForm({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const [state, action, pending] = useActionState(renamePortfolio, initial);
  const error = state.status === "error" ? state.message : undefined;
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="id" value={id} />
      <Field id="portfolio-name" label="Nombre" error={error}>
        <Input
          id="portfolio-name"
          name="name"
          {...nameInput}
          defaultValue={
            state.status === "error" && state.value !== undefined
              ? state.value
              : name
          }
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "portfolio-name-error" : undefined}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar nombre"}
      </Button>
    </form>
  );
}

/**
 * Borrar un portafolio, en dos pasos y escribiendo su nombre (sin `confirm()` del navegador): se
 * lleva todas sus operaciones y no se puede deshacer.
 */
export function DeletePortfolioForm({
  id,
  name,
  transactions,
}: {
  id: string;
  name: string;
  /** Cuántas operaciones tiene (se borran con él). */
  transactions: number;
}) {
  const [asking, setAsking] = useState(false);
  const [state, action, pending] = useActionState(deletePortfolio, initial);
  const error = state.status === "error" ? state.message : undefined;

  if (!asking) {
    return (
      <Button
        key="ask"
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => setAsking(true)}
      >
        Borrar portafolio
      </Button>
    );
  }

  return (
    <form
      key="confirm"
      action={action}
      className="flex flex-col gap-3"
      noValidate
    >
      <input type="hidden" name="id" value={id} />
      <Notice tone="warning">
        {transactions > 0
          ? `Se ${plural(transactions, "borra su operación", `borran sus ${transactions} operaciones`)} y no se puede deshacer. Si querés ${plural(transactions, "conservarla, exportala", "conservarlas, exportalas")} antes desde Actividad.`
          : "No tiene operaciones. Borrarlo no se puede deshacer."}
      </Notice>
      <Field
        id="confirm-delete"
        label={`Para confirmar, escribí «${name}»`}
        error={error}
      >
        <Input
          id="confirm-delete"
          name="confirm"
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          defaultValue={state.status === "error" ? state.value : ""}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "confirm-delete-error" : undefined}
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Borrando…" : "Sí, borrar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => setAsking(false)}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
