import { Skeleton } from "@/components/ui/skeleton";

/** Esqueleto mientras se cargan los datos de cualquier pantalla de la app. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-28 w-full" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    </div>
  );
}
