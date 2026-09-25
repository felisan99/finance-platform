import { ClearSnapshot } from "@/components/app/clear-snapshot";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <ClearSnapshot />
      <LoginForm />
    </main>
  );
}
