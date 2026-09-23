"use client";

import { useActionState } from "react";
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
import { requestMagicLink, type LoginState } from "./actions";

const initialState: LoginState = { status: "idle" };

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, formAction, pending] = useActionState(
    requestMagicLink,
    initialState,
  );
  const errorMessage = state.status === "error" ? state.message : initialError;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-lg">Portfolio Tracker</CardTitle>
        <CardDescription>
          Ingresá con tu email y te enviamos un enlace de acceso.
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
              required
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Enviando…" : "Enviar enlace"}
          </Button>
          {state.status === "sent" && (
            <p role="status" className="text-sm">
              Listo. Si tu email tiene acceso, te llegó un enlace. Abrilo en
              este mismo navegador.
            </p>
          )}
          {errorMessage && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
