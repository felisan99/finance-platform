import { ImportForm } from "@/components/app/import-form";
import { PageHeader } from "@/components/app/stat";

export default function ImportPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Importar CSV"
        subtitle="Historial exportado de Delta"
      />
      <p className="text-sm text-muted-foreground">
        Subí el archivo, revisá la vista previa y confirmá. Las operaciones que
        ya importaste antes no se duplican, así que podés volver a subir un
        export más nuevo. Las filas de efectivo automáticas de Delta (
        <code>SYNC-BASE-HOLDINGS</code>) se ignoran a propósito: el efectivo se
        calcula solo a partir de tus compras, ventas y depósitos.
      </p>
      <ImportForm />
    </div>
  );
}
