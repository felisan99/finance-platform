import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// La explicación del formato, en la propia pantalla de importación: qué columnas lleva el archivo,
// un ejemplo y las reglas que más errores dan. Es texto fijo (sin datos de nadie).

const COLUMNS: ReadonlyArray<readonly [string, string, string]> = [
  [
    "fecha",
    "Siempre",
    "2026-03-09 o 09/03/2026 (día/mes/año). Con hora: 2026-03-09 14:30",
  ],
  ["tipo", "Siempre", "compra, venta, depósito, retiro o dividendo"],
  [
    "simbolo",
    "Compra, venta, dividendo",
    "El ticker de EE.UU.: VOO, AAPL, BRK-B",
  ],
  ["cantidad", "Compra, venta", "Cuántas acciones (admite fracciones: 0.5)"],
  ["precio", "Compra, venta", "Precio POR acción en USD (no el total)"],
  ["monto", "Depósito, retiro, dividendo", "El total en USD"],
  ["comision", "Opcional", "Comisión de la operación en USD"],
  ["notas", "Opcional", "Lo que quieras anotar"],
];

const EXAMPLE = `fecha,tipo,simbolo,cantidad,precio,monto,comision,notas
2026-03-06,deposito,,,,1000,,
2026-03-09,compra,VOO,2,400.50,,1,
2026-04-15,venta,VOO,1,410,,1,
2026-05-02,dividendo,VOO,,,1.15,,`;

export function ImportGuide() {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Cómo cargar tus operaciones</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>
          Una fila por operación. Bajá la plantilla, abrila en Excel o Google
          Sheets, borrá los ejemplos y completá las tuyas. También podés subir
          el CSV de Delta tal cual, o uno que hayas exportado desde acá.
        </p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- descarga de un archivo: <Link> intentaría navegar */}
        <a
          href="/activity/import/plantilla"
          className={cn(buttonVariants({ variant: "outline" }), "w-full")}
        >
          Descargar la plantilla (CSV)
        </a>

        <details open className="rounded-lg border px-3 py-2">
          <summary className="cursor-pointer font-medium">
            Columnas y ejemplo
          </summary>
          <div className="flex flex-col gap-3 pt-2">
            <dl className="flex flex-col divide-y text-xs">
              {COLUMNS.map(([name, when, how]) => (
                <div key={name} className="flex flex-col gap-0.5 py-1.5">
                  <dt>
                    <code className="font-semibold">{name}</code>{" "}
                    <span className="text-muted-foreground">· {when}</span>
                  </dt>
                  <dd className="text-muted-foreground">{how}</dd>
                </div>
              ))}
            </dl>
            <pre
              tabIndex={0}
              aria-label="Ejemplo de archivo"
              className="overflow-x-auto rounded-lg bg-muted p-2 text-xs leading-relaxed"
            >
              {EXAMPLE}
            </pre>
          </div>
        </details>

        <details className="rounded-lg border px-3 py-2">
          <summary className="cursor-pointer font-medium">
            Reglas que evitan errores
          </summary>
          <ul className="flex list-disc flex-col gap-1.5 pt-2 pl-5 text-xs text-muted-foreground">
            <li>
              <strong className="text-foreground">Decimales:</strong> con punto
              o con coma (575.24 o 575,24), sin separador de miles (1000, no
              1.000). Si tu archivo separa las columnas con comas, escribí los
              decimales con punto o entre comillas (&quot;575,24&quot;): una
              coma decimal suelta se lee como otra columna y esa fila se
              rechaza.
            </li>
            <li>
              <strong className="text-foreground">Fechas:</strong> primero el
              día y después el mes. Sin hora se toma el mediodía de Montevideo.
              No se aceptan fechas futuras.
            </li>
            <li>
              <strong className="text-foreground">Solo USD</strong> y símbolos
              de acciones o ETFs de EE.UU. Los símbolos nuevos se verifican: si
              hay un error de tipeo (APPL en vez de AAPL) te lo marcamos.
            </li>
            <li>
              <strong className="text-foreground">Efectivo:</strong> se calcula
              solo. Agregá una fila «depósito» con lo que pusiste en tu broker;
              si no, el efectivo da negativo.
            </li>
            <li>
              <strong className="text-foreground">Repetidas:</strong> podés
              volver a subir un archivo con operaciones ya cargadas y no se
              duplican. Si algo que cargaste a mano también está en el archivo,
              te lo marcamos y no se importa salvo que lo pidas.
            </li>
            <li>
              <strong className="text-foreground">Desde una planilla:</strong>{" "}
              guardala como CSV (Excel: Archivo → Guardar como → CSV; Google
              Sheets: Archivo → Descargar → CSV) o copiá las celdas y usá «Pegar
              filas».
            </li>
            <li>
              <strong className="text-foreground">Si te equivocás:</strong>{" "}
              abajo podés deshacer una importación entera.
            </li>
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
