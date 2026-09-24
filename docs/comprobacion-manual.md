# Comprobación manual (Fases 4 y 5)

Lo único que no se puede automatizar sin un navegador: ver la app con tus ojos, en el teléfono. Los números de la sección 8.3 del spec ya se comprueban por HTTP con una sesión real (`pnpm build && pnpm test:live`); esta lista es para que los veas vos y para revisar el aspecto.

## Antes de empezar

```bash
pnpm dev          # http://localhost:3000
```

Ingresá con tu email (enlace mágico; abrilo en el **mismo** navegador).

**Para verla a 390 px** usá el modo dispositivo de las herramientas de desarrollo del navegador (Chrome: F12 → ícono de celular → iPhone 12/13/14). Verla en el teléfono real por la IP de tu red no funciona todavía: las redirecciones permitidas de Supabase Auth solo incluyen `http://localhost:3000`, así que el enlace de ingreso no volvería. Eso se resuelve con el deploy (Fase 7) o agregando la IP a las redirecciones (con `pnpm db:config-diff` antes de cualquier `config push`).

## 1. Importar el CSV de Delta

1. **Más → Importar CSV de Delta** (o **Actividad → Importar CSV**).
2. Elegí `delta_PORTAFOLIO PRINCIPAL_230902026_1.csv` y tocá **Ver vista previa**.
3. La vista previa tiene que decir: **operaciones nuevas** (las compras, ventas y depósitos), **filas ignoradas** por ser "patas de efectivo automáticas de Delta" (es a propósito), **0 con error**, y 10 **instrumentos nuevos** (o menos si ya existían) y "Cómo quedaría tu portafolio":

   | Dato                       | Valor esperado |
   | -------------------------- | -------------- |
   | Efectivo                   | 882,745      |
   | Costo base de las abiertas | 8.664,27    |
   | Ganancia realizada         | 247,015       |
   | Posiciones abiertas        | 5              |

4. **Confirmar importación.** Te lleva a **Posiciones** con un aviso de que los precios se descargan en segundo plano.

## 2. Ver los números en pantalla

En **Posiciones**, debajo de cada tarjeta dice "Exacto: …" con el valor sin redondear:

| Posición | Cantidad | Costo base (exacto) |
| -------- | -------- | ------------------- |
| VOO      | 8,95    | 5.724,77         |
| SOXX     | 3        | 2.069,50            |
| FSLY     | 20       | 346,8               |
| ILF      | 10       | 331,6               |
| NFLX     | 3        | 191,6               |

- **Costo base (abiertas):** 8.664,27 · **Efectivo:** 882,745 · **Realizado (todas):** 247,015.
- **Mostrar posiciones cerradas (5):** MELI +180,55 · URTH +42,70 · KOS +11,14 · QCOM +7,52 · TTWO +5,11.
- Si alguna posición dice **Sin precio**: esperá unos segundos y actualizá la página (se descarga en segundo plano); si sigue, tocá **Actualizar precios** en Inicio (se puede una vez cada 5 minutos).

## 3. Alta manual

**Actividad → Agregar**: Compra · símbolo `DDOG` (aparece en la lista mientras escribís) · cantidad `2` · precio `251,41` · comisión `1,00` · fecha `23/09/2026`. Guardar.

Resultado esperado: DDOG con **costo base 503,82** y el **efectivo baja a 378,925**. Un símbolo nuevo puede tardar unos segundos en tener precio: puede aparecer un instante el aviso "Falta el precio de DDOG" y desaparecer al actualizar la página. En el detalle de DDOG tiene que verse el gráfico con el punto verde de la compra.

## 4. Cosas para mirar

- **Editar y borrar:** tocá una operación en Actividad. Probá cambiarle la cantidad y guardar; probá eliminar una compra que sostiene una venta posterior (tiene que rechazarlo con un mensaje claro).
- **Filtros de Actividad:** por tipo, símbolo y fechas.
- **Exportar CSV:** **Actividad → Exportar CSV** descarga todas tus operaciones.
- **Detalle de una posición** (tocá VOO): gráfico de precio con puntos verdes (compras) y rojos (ventas) y una línea punteada con tu costo promedio.
- **A 390 px:** que nada se corte ni haya scroll horizontal, que la navegación de abajo no tape contenido (en el iPhone, que respete la barra inferior) y que los botones se puedan tocar con el pulgar.
- **Colores:** ganancias y pérdidas llevan además signo y flecha (▲ ▼).
- **Composición (Inicio):** la torta con una porción por posición y el efectivo en gris; la lista de abajo con porcentaje y monto. Tocá **Tipo** para agrupar en Acciones / ETF / Efectivo. Los porcentajes tienen que sumar 100 %.

## 5. Rendimiento (Fase 5)

En **Inicio**, la tarjeta **Rendimiento** (aparece unos instantes después del resto, mientras se leen los precios):

- **Períodos** (1S, 1M, 3M, YTD, 1A, Todo): cambian el gráfico y los cuatro datos. Los que son más largos que tu historial (por ejemplo YTD y 1A si empezaste en marzo) muestran lo mismo que Todo y dicen "(todo el historial)".
- **Valor / vs S&P 500:** "Valor" es el valor total en dólares (sube a saltos cuando depositás); "vs S&P 500" son tu portafolio y el S&P 500 (con dividendos) en base 100 desde el inicio del período.
- **Datos:** TWR (rendimiento ponderado por tiempo, no le afectan los depósitos), XIRR (tasa anual ponderada por dinero; en períodos de menos de 30 días dice "Muy corto para una tasa anual"), S&P 500 y la diferencia en puntos porcentuales.
- Referencia: con el CSV de Delta importado y **sin** el DDOG cargado a mano (a los cierres del 24/09/2026, desde el 06/03/2026): TWR +16,48 %, XIRR +28,06 %, S&P 500 +13,48 %, diferencia +3,00 pp. Con el DDOG y con precios más nuevos los números cambian un poco.
- Si no aparece el S&P 500: tocá **Actualizar precios** (baja el historial del benchmark en segundo plano) y recargá.
- El gráfico usa cierres diarios: el valor de la tarjeta de arriba (cotización del momento) puede diferir del último punto hasta que cierre el mercado.

## Límites conocidos

- Una sola cuenta.
- No hay pestaña de Watchlist ni la app instalable (Fase 6).
- Editar o borrar una operación importada: si volvés a subir el archivo original, se crea de nuevo.
- Todavía no hay ingreso con código de 6 dígitos; el enlace del correo abre el navegador, no la app instalada (ver "Tareas pendientes" en `docs/decisions.md`).
