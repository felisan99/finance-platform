import { loginErrorMessage } from "@/lib/db/login-errors";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <LoginForm initialError={loginErrorMessage(error)} />
    </main>
  );
}
