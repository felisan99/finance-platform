# Importar operaciones (guía)

Cómo cargar tu historial en Portfolio Tracker desde un CSV o desde una planilla. La misma guía está en la pantalla **Más → Importar operaciones (CSV)**; el detalle técnico está en `PROJECT_SPEC.md` §8.4.

## En dos minutos

1. **Descargá la plantilla** (botón en la pantalla de importación) y abrila en Excel o Google Sheets.
2. Borrá las filas de ejemplo y completá las tuyas: **una fila por operación**.
3. Guardala como **CSV** (Excel: _Archivo → Guardar como → CSV UTF-8_; Google Sheets: _Archivo → Descargar → CSV_) y subila. O copiá las celdas y usá **Pegar filas**.
4. Revisá la vista previa (fechas, cantidades, precios) y confirmá.

Si usás Delta, subí su export tal cual. Si exportaste tus operaciones desde acá con **Exportar CSV**, también se pueden volver a subir.

Si tenés más de un portafolio, elegí arriba **a cuál importar**: arranca en el que estás mirando (mirando «Todos los portafolios», hay que elegirlo). **Exportar CSV** baja lo que estás mirando, y su nombre va en el nombre del archivo. Con «Todos los portafolios» sale todo en un solo archivo con una columna `portafolio` al final. Al volver a importarlo esa columna no se lee: todo va al portafolio que elijas.

## Columnas

| Columna    | Cuándo                      | Qué poner                                                               |
| ---------- | --------------------------- | ----------------------------------------------------------------------- |
| `fecha`    | Siempre                     | `2026-03-09` o `09/03/2026` (día/mes/año). Con hora: `2026-03-09 14:30` |
| `tipo`     | Siempre                     | `compra`, `venta`, `depósito`, `retiro` o `dividendo`                   |
| `simbolo`  | Compra, venta, dividendo    | El ticker de EE.UU.: `VOO`, `AAPL`, `BRK-B`                             |
| `cantidad` | Compra, venta               | Cuántas acciones (admite fracciones: `0.5`)                             |
| `precio`   | Compra, venta               | Precio **por acción** en USD (no el total de la operación)              |
| `monto`    | Depósito, retiro, dividendo | El total en USD                                                         |
| `comision` | Opcional                    | Comisión de la operación en USD                                         |
| `notas`    | Opcional                    | Lo que quieras anotar                                                   |

También se aceptan `split` (con la columna `razon_split`: `10` para un split 10:1), `comisión`, `impuesto` e `interés` (con `monto`) y los nombres en inglés (`date`, `type`, `symbol`, `quantity`, `price`, `amount`, `fee`, `notes`; los tipos `BUY`, `SELL`, `DEPOSIT`…). Las columnas que no conocemos se ignoran, así que un archivo exportado desde acá entra tal cual.

### Ejemplo

```csv
fecha,tipo,simbolo,cantidad,precio,monto,comision,notas
2026-03-06,deposito,,,,1000,,
2026-03-09,compra,VOO,2,400.50,,1,
2026-04-15,venta,VOO,1,410,,1,
2026-05-02,dividendo,VOO,,,1.15,,
```

## Reglas que evitan errores

- **Decimales** con punto o con coma (`575.24` o `575,24`), **sin separador de miles**: `1000`, no `1.000` (un `1.000` se lee como uno). La vista previa muestra cómo se leyó cada número: mirala antes de confirmar.
- **Fechas:** primero el día y después el mes (`03/04/2026` es el 3 de abril). Sin hora se toma el mediodía de Montevideo. No se aceptan fechas futuras ni las que no existen (31/02).
- **Separador de columnas:** coma, punto y coma o tabulación; se reconoce solo (el Excel en español guarda con `;`). Si tu número usa coma decimal y el archivo se separa con comas, escribilo entre comillas (`"575,24"`) o con punto.
- **Solo USD** y acciones o ETFs de EE.UU. Los símbolos nuevos se verifican con Yahoo Finance: si escribiste `APPL` en vez de `AAPL`, te lo marcamos y no se importa.
- **Efectivo:** se calcula solo a partir de tus depósitos, retiros, compras y ventas. Agregá una fila `deposito` con lo que pusiste en tu broker; si no, el efectivo da negativo y Inicio te avisa.
- **Hasta 1 MB y 5000 operaciones** por vez.

## Repetidas y duplicadas

- **El mismo archivo dos veces:** las operaciones ya importadas no se duplican; la vista previa dice cuántas eran «ya importadas». Podés volver a subir un archivo más nuevo que incluya lo anterior.
- **Lo que cargaste a mano y también está en el archivo:** el CSV y la carga manual no comparten identificador, así que te lo marcamos como «Parecen repetir operaciones que ya tenés» (mismo día, tipo, símbolo y cantidad) y **no se importa** salvo que tildes «Importar igual».
- **Si borrás o editás una operación importada** y volvés a subir el archivo original, esa operación se crea de nuevo.

## Me equivoqué

Al final de la pantalla, en **Importaciones anteriores**, tocá **Deshacer importación → Sí, deshacer**. Se borran las operaciones de esa importación (lo que cargaste a mano no se toca) y después podés subir el archivo corregido. Si cargaste una venta que depende de esas compras, te avisa y no deja: borrá primero esa venta desde **Actividad**. Las importaciones hechas antes de que existiera esta función no se pueden deshacer.

## Errores frecuentes

| Mensaje                                        | Qué pasó y cómo se arregla                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| «No reconocemos las columnas del archivo…»     | Faltan `fecha` y `tipo` (o el archivo no es un CSV de operaciones). Usá la plantilla.                           |
| «Fecha «…»: no es válida»                      | Usá `AAAA-MM-DD` o `DD/MM/AAAA`, con el día antes que el mes. Revisá que el día exista.                         |
| «Tipo «…»: no lo reconocemos»                  | Usá `compra`, `venta`, `depósito`, `retiro`, `dividendo`, `split`, `comisión`, `impuesto` o `interés`.          |
| «Símbolo «…»: no lo encontramos»               | Error de tipeo o no es un símbolo de EE.UU. Probá con el ticker de Yahoo Finance (`BRK-B`, no `BRK.B`).         |
| «La fila tiene más columnas que el encabezado» | Un número con coma decimal sin comillas en un archivo separado por comas. Escribilo con punto o entre comillas. |
| «Es una fila de ejemplo de la plantilla»       | Quedaron las filas de ejemplo: borralas o reemplazalas por las tuyas.                                           |
| «Subí un archivo .csv…» / «No parece un CSV»   | Subiste una planilla (`.xlsx`). Guardala como CSV o usá **Pegar filas**.                                        |
| «El efectivo queda negativo…»                  | Falta un depósito que cubra tus compras. Agregá una fila `deposito`.                                            |
| «No pudimos verificar … con Yahoo Finance»     | Yahoo no respondió. Probá de nuevo en unos minutos.                                                             |

## Para quien mantiene el código

- Parsers puros: `lib/importers/simple.ts` (formato simple), `lib/importers/delta.ts`, reconocimiento en `detect.ts`, plantilla en `template.ts`. Tests en `lib/importers/__tests__/` y la ida y vuelta con «Exportar CSV» (con fast-check) en `lib/portfolio/__tests__/csv-roundtrip.test.ts`: si cambia una columna del export, del parser o de la plantilla, hay que tocar los tres.
- Vista previa y flujo: `lib/portfolio/import-{flow,preview,similar,symbols,signature}.ts`; acciones y pantalla en `app/(app)/activity/import/`.
- Base de datos: `import_transactions` (guarda `import_id`), `undo_import` y `recent_imports` (migración `20260925161500_csv_import_undo.sql`).
