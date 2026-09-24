import { NotFoundView } from "@/components/app/not-found-view";

// Direcciones que no existen en ninguna parte de la app.
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pt-4">
      <NotFoundView />
    </main>
  );
}
