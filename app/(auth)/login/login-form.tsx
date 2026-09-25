"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  requestCode,
  verifyCode,
  type RequestCodeState,
  type VerifyCodeState,
} from "./actions";

/** Espera antes de poder pedir otro código; coincide con `max_frequency` de supabase/config.toml. */
const RESEND_SECONDS = 60;
const CODE_LENGTH = 6;

const idleRequest: RequestCodeState = { status: "idle" };
const idleVerify: VerifyCodeState = { status: "idle" };

/**
 * Ingreso en dos pasos: email → código de 6 dígitos del correo. Con el código no hay enlace que abrir
 * en otro navegador: sirve igual dentro de la app instalada en el iPhone (sus cookies son aparte).
 * Cambiar de email vuelve a montar todo (la `key`), así no quedan mensajes ni estado del intento anterior.
 */
export function LoginForm() {
  const [attempt, setAttempt] = useState(0);
  return (
    <LoginSteps key={attempt} onChangeEmail={() => setAttempt((n) => n + 1)} />
  );
}

function LoginSteps({ onChangeEmail }: { onChangeEmail: () => void }) {
  /** El último código pedido con éxito: define el paso y cuándo se pudo pedir de nuevo. */
  const [sent, setSent] = useState<{
    email: string;
    at: number;
    wait: number;
  } | null>(null);
  /** Errores de esta pantalla (no de una acción del servidor): "Escribí tu email primero". */
  const [ownError, setOwnError] = useState<string | null>(null);
  const [state, formAction, requesting] = useActionState(
    async (
      previous: RequestCodeState,
      formData: FormData,
    ): Promise<RequestCodeState> => {
      setOwnError(null);
      const result = await requestCode(previous, formData);
      if (result.status === "code") {
        setSent({
          email: result.email,
          at: Date.now(),
          wait: RESEND_SECONDS,
        });
      }
      return result;
    },
    idleRequest,
  );
  const error = ownError ?? (state.status === "error" ? state.message : null);

  if (sent === null) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Portfolio Tracker</CardTitle>
          <CardDescription>
            Ingresá con tu email y te enviamos un código de {CODE_LENGTH}{" "}
            dígitos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                required
              />
            </div>
            <Button type="submit" disabled={requesting}>
              {requesting ? "Enviando…" : "Enviar código"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(event) => {
                // Para volver al segundo paso sin pedir otro código: el iPhone puede recargar la app
                // mientras se mira el correo, o el correo puede no haber llegado y el código venir de otro lado.
                const form = event.currentTarget.form;
                const typed = String(
                  new FormData(form ?? undefined).get("email") ?? "",
                )
                  .trim()
                  .toLowerCase();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)) {
                  setOwnError("Escribí tu email primero.");
                  return;
                }
                setOwnError(null);
                // Sin espera para reenviar: no se acaba de pedir nada.
                setSent({ email: typed, at: Date.now(), wait: 0 });
              }}
            >
              Ya tengo un código
            </Button>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <CodeStep
      // Cada código pedido arranca el paso de cero: campo vacío, sin errores y con la espera de nuevo.
      key={sent.at}
      email={sent.email}
      sentAt={sent.at}
      waitSeconds={sent.wait}
      resendAction={formAction}
      resending={requesting}
      resendError={error}
      onChangeEmail={onChangeEmail}
    />
  );
}

function CodeStep({
  email,
  sentAt,
  waitSeconds,
  resendAction,
  resending,
  resendError,
  onChangeEmail,
}: {
  email: string;
  sentAt: number;
  /** Segundos que hay que esperar (desde `sentAt`) para poder pedir otro código. */
  waitSeconds: number;
  resendAction: (formData: FormData) => void;
  resending: boolean;
  resendError: string | null;
  onChangeEmail: () => void;
}) {
  const [state, formAction, verifying] = useActionState(verifyCode, idleVerify);
  const [now, setNow] = useState(sentAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const secondsLeft = Math.max(
    0,
    waitSeconds - Math.floor((Math.max(now, sentAt) - sentAt) / 1000),
  );
  const error = state.status === "error" ? state.message : resendError;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-lg">Escribí tu código</CardTitle>
        <CardDescription>
          Si <span className="font-medium text-foreground">{email}</span> tiene
          acceso, te llegó un código de {CODE_LENGTH} dígitos. Puede tardar un
          minuto; mirá también en spam. Vence en 10 minutos.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="email" value={email} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="code">Código</Label>
            <Input
              id="code"
              name="token"
              // Teclado numérico y, en el iPhone, sugerencia del código que llegó por correo.
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={CODE_LENGTH * 2}
              autoFocus
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "code-error" : undefined}
              className="h-12 text-center font-mono text-2xl tracking-[0.3em]"
              placeholder="······"
              onChange={(event) => {
                // Con los seis dígitos se envía solo (los espacios de "123 456" no cuentan).
                if (
                  event.target.value.replace(/\D/g, "").length === CODE_LENGTH
                ) {
                  event.target.form?.requestSubmit();
                }
              }}
            />
          </div>
          <Button type="submit" disabled={verifying}>
            {verifying ? "Verificando…" : "Ingresar"}
          </Button>
          {error && (
            <p
              id="code-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </form>

        <div className="flex items-center justify-between gap-2">
          <form action={resendAction}>
            <input type="hidden" name="email" value={email} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={secondsLeft > 0 || resending}
            >
              {resending
                ? "Enviando…"
                : secondsLeft > 0
                  ? `Reenviar en ${secondsLeft} s`
                  : "Reenviar código"}
            </Button>
          </form>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onChangeEmail}
          >
            Usar otro email
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
